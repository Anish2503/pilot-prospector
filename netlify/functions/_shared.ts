/**
 * Shared server-side helpers.
 *
 * Everything in this folder runs on Netlify's servers, NOT in the user's
 * browser. This is the only place secret keys are allowed to exist.
 */

import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// -----------------------------------------------------------------------------
// ENVIRONMENT
// -----------------------------------------------------------------------------

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Server is not configured: missing ${name}. ` +
        `Add it in Netlify under Site configuration -> Environment variables.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * A database client with the service-role key, which bypasses all Row Level
 * Security. Only ever created inside these server functions.
 */
let cachedAdmin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!cachedAdmin) {
    cachedAdmin = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cachedAdmin;
}

// -----------------------------------------------------------------------------
// PASSWORD / PIN HASHING
//
// We use scrypt, which is built into Node and deliberately slow. Even if the
// database were stolen, turning these hashes back into passwords is infeasible.
// Nothing is ever stored in plain text.
// -----------------------------------------------------------------------------

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, keyB64] = parts;
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(keyB64!, 'base64');

    const actual = await scrypt(secret.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });

    // Constant-time compare, so an attacker cannot learn the hash by timing.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// SIGNED LOGIN PASSES (JWT, HS256)
//
// Signed with the project's JWT secret, which is the same secret Supabase uses
// to check incoming tokens. That is what lets the database trust our claims and
// apply the Row Level Security rules to them.
// -----------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface TokenClaims {
  sub: string;
  uid: string;
  app_role: 'super_admin' | 'bdm';
  name: string;
  username?: string;
  role: 'authenticated';
  aud: 'authenticated';
  iat: number;
  exp: number;
}

export function signToken(
  payload: Omit<TokenClaims, 'iat' | 'exp' | 'role' | 'aud'>,
  expiresInSeconds: number,
): { token: string; expiresAt: number } {
  const secret = requireEnv('SUPABASE_JWT_SECRET');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;

  const claims: TokenClaims = {
    ...payload,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const signature = base64url(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );

  return { token: `${header}.${body}.${signature}`, expiresAt: exp };
}

export function verifyToken(token: string): TokenClaims | null {
  try {
    const secret = requireEnv('SUPABASE_JWT_SECRET');
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expected = base64url(
      createHmac('sha256', secret).update(`${header}.${body}`).digest(),
    );

    const a = Buffer.from(signature!);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const claims = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    ) as TokenClaims;

    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// REQUEST GUARDS
// -----------------------------------------------------------------------------

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getClaims(request: Request): TokenClaims | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

/** Throws unless the caller holds a valid, still-active Super Admin pass. */
export async function requireAdmin(request: Request): Promise<TokenClaims> {
  const claims = getClaims(request);
  if (!claims || claims.app_role !== 'super_admin') {
    throw new HttpError(401, 'Please sign in as an admin to do that.');
  }

  // Re-check against the database so a disabled admin loses access immediately,
  // even if their pass has not expired yet.
  const { data, error } = await supabaseAdmin()
    .from('admins')
    .select('id, active')
    .eq('id', claims.uid)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not verify your account.');
  if (!data?.active) {
    throw new HttpError(403, 'This admin account has been disabled.');
  }
  return claims;
}

/** Throws unless the caller holds a valid, still-active BDM pass. */
export async function requireBdm(request: Request): Promise<TokenClaims> {
  const claims = getClaims(request);
  if (!claims || claims.app_role !== 'bdm') {
    throw new HttpError(401, 'Please sign in to do that.');
  }

  const { data, error } = await supabaseAdmin()
    .from('bdms')
    .select('id, active')
    .eq('id', claims.uid)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not verify your account.');
  if (!data?.active) throw new HttpError(403, 'This BDM account has been disabled.');
  return claims;
}

// -----------------------------------------------------------------------------
// RESPONSES
// -----------------------------------------------------------------------------

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status);
  }
  console.error('[function error]', error);
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  // Configuration problems are safe (and useful) to surface verbatim.
  if (message.startsWith('Server is not configured')) {
    return json({ error: message }, 500);
  }
  return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
}

/** Rejects anything that is not the expected HTTP method. */
export function assertMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, `Use ${method} for this endpoint.`);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'The request was not valid.');
  }
}

// -----------------------------------------------------------------------------
// AUDIT LOGGING (server side)
// -----------------------------------------------------------------------------

export async function logActivity(entry: {
  actorType: 'admin' | 'bdm' | 'system';
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  leadId?: string | null;
  bdmId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin().from('activity_logs').insert({
      actor_type: entry.actorType,
      actor_id: entry.actorId ?? null,
      actor_name: entry.actorName ?? null,
      action: entry.action,
      lead_id: entry.leadId ?? null,
      bdm_id: entry.bdmId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    // An audit write must never break the action the user asked for.
    console.error('[audit log failed]', error);
  }
}
