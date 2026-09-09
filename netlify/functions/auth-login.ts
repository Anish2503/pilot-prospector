/**
 * Login endpoint.  POST /api/auth-login
 *
 * Three modes:
 *   { mode: 'list-bdms' }                       -> names for the BDM dropdown
 *   { mode: 'admin', username, password }       -> Super Admin sign-in
 *   { mode: 'bdm',   bdmId, pin }               -> BDM sign-in
 *
 * On success it returns a signed pass. The password/PIN itself is checked here
 * and immediately discarded - it is never stored, logged, or sent anywhere.
 */

import {
  assertMethod,
  errorResponse,
  HttpError,
  json,
  logActivity,
  readJson,
  signToken,
  supabaseAdmin,
  verifySecret,
} from './_shared.ts';

/** Admin passes last a working day; BDM passes last a month (they are on foot). */
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
const BDM_SESSION_SECONDS = 30 * 24 * 60 * 60;

/** After this many wrong attempts the account pauses for LOCKOUT_MINUTES. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface LoginBody {
  mode?: 'list-bdms' | 'admin' | 'bdm';
  username?: string;
  password?: string;
  bdmId?: string;
  pin?: string;
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    const body = await readJson<LoginBody>(request);

    switch (body.mode) {
      case 'list-bdms':
        return await listBdms();
      case 'admin':
        return await loginAdmin(body);
      case 'bdm':
        return await loginBdm(body);
      default:
        throw new HttpError(400, 'The request was not valid.');
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// -----------------------------------------------------------------------------
// The dropdown list
//
// This is deliberately public: the BDM has to pick their name before they can
// prove who they are. It exposes nothing but first-and-last names - no phone
// numbers, no leads, no PINs. The PIN is what actually grants access.
// -----------------------------------------------------------------------------
async function listBdms(): Promise<Response> {
  const { data, error } = await supabaseAdmin()
    .from('bdms')
    .select('id, name')
    .eq('active', true)
    .order('name');

  if (error) throw new HttpError(500, 'Could not load the BDM list.');
  return json({ bdms: data ?? [] });
}

// -----------------------------------------------------------------------------
// Lockout helpers
// -----------------------------------------------------------------------------

function lockoutMessage(lockedUntil: string): HttpError {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000),
  );
  return new HttpError(
    429,
    `Too many incorrect attempts. Please try again in ${minutes} minute${
      minutes === 1 ? '' : 's'
    }.`,
  );
}

async function registerFailure(
  table: 'admin_credentials' | 'bdm_credentials',
  idColumn: 'admin_id' | 'bdm_id',
  id: string,
  currentAttempts: number,
): Promise<void> {
  const attempts = currentAttempts + 1;
  const locked =
    attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
      : null;

  await supabaseAdmin()
    .from(table)
    .update({
      failed_attempts: attempts,
      locked_until: locked,
      updated_at: new Date().toISOString(),
    })
    .eq(idColumn, id);
}

async function registerSuccess(
  table: 'admin_credentials' | 'bdm_credentials',
  idColumn: 'admin_id' | 'bdm_id',
  id: string,
): Promise<void> {
  await supabaseAdmin()
    .from(table)
    .update({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq(idColumn, id);
}

// -----------------------------------------------------------------------------
// Admin sign-in
// -----------------------------------------------------------------------------
async function loginAdmin(body: LoginBody): Promise<Response> {
  const username = body.username?.trim().toLowerCase();
  const password = body.password;

  if (!username || !password) {
    throw new HttpError(400, 'Please enter both your username and password.');
  }

  const db = supabaseAdmin();

  const { data: admin, error } = await db
    .from('admins')
    .select('id, name, username, active')
    .ilike('username', username)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not check those details.');

  // Same message whether the username or the password was wrong, so nobody can
  // discover which usernames exist by trying them.
  const invalid = new HttpError(401, 'Incorrect username or password.');
  if (!admin) throw invalid;
  if (!admin.active) {
    throw new HttpError(403, 'This admin account has been disabled.');
  }

  const { data: creds } = await db
    .from('admin_credentials')
    .select('password_hash, failed_attempts, locked_until')
    .eq('admin_id', admin.id)
    .maybeSingle();

  if (!creds) throw invalid;

  if (creds.locked_until && new Date(creds.locked_until) > new Date()) {
    throw lockoutMessage(creds.locked_until);
  }

  const ok = await verifySecret(password, creds.password_hash);
  if (!ok) {
    await registerFailure('admin_credentials', 'admin_id', admin.id, creds.failed_attempts ?? 0);
    throw invalid;
  }

  await registerSuccess('admin_credentials', 'admin_id', admin.id);

  const { token, expiresAt } = signToken(
    {
      sub: admin.id,
      uid: admin.id,
      app_role: 'super_admin',
      name: admin.name,
      username: admin.username,
    },
    ADMIN_SESSION_SECONDS,
  );

  await logActivity({
    actorType: 'admin',
    actorId: admin.id,
    actorName: admin.name,
    action: 'admin.signed_in',
  });

  return json({
    token,
    expiresAt,
    role: 'super_admin',
    id: admin.id,
    name: admin.name,
    username: admin.username,
  });
}

// -----------------------------------------------------------------------------
// BDM sign-in
// -----------------------------------------------------------------------------
async function loginBdm(body: LoginBody): Promise<Response> {
  const bdmId = body.bdmId?.trim();
  const pin = body.pin?.trim();

  if (!bdmId || !pin) {
    throw new HttpError(400, 'Please select your name and enter your PIN.');
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, 'Your PIN is 4 digits.');
  }

  const db = supabaseAdmin();

  const { data: bdm, error } = await db
    .from('bdms')
    .select('id, name, active')
    .eq('id', bdmId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not check those details.');

  const invalid = new HttpError(401, 'Incorrect PIN. Please try again.');
  if (!bdm) throw invalid;
  if (!bdm.active) {
    throw new HttpError(403, 'This account has been disabled. Please contact your admin.');
  }

  const { data: creds } = await db
    .from('bdm_credentials')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('bdm_id', bdm.id)
    .maybeSingle();

  if (!creds) {
    throw new HttpError(
      403,
      'No PIN has been set for your account yet. Please ask your admin to set one.',
    );
  }

  if (creds.locked_until && new Date(creds.locked_until) > new Date()) {
    throw lockoutMessage(creds.locked_until);
  }

  const ok = await verifySecret(pin, creds.pin_hash);
  if (!ok) {
    await registerFailure('bdm_credentials', 'bdm_id', bdm.id, creds.failed_attempts ?? 0);
    const left = MAX_ATTEMPTS - ((creds.failed_attempts ?? 0) + 1);
    throw new HttpError(
      401,
      left > 0
        ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`
        : `Too many incorrect attempts. Please try again in ${LOCKOUT_MINUTES} minutes.`,
    );
  }

  await registerSuccess('bdm_credentials', 'bdm_id', bdm.id);

  const { token, expiresAt } = signToken(
    { sub: bdm.id, uid: bdm.id, app_role: 'bdm', name: bdm.name },
    BDM_SESSION_SECONDS,
  );

  await logActivity({
    actorType: 'bdm',
    actorId: bdm.id,
    actorName: bdm.name,
    bdmId: bdm.id,
    action: 'bdm.signed_in',
  });

  return json({ token, expiresAt, role: 'bdm', id: bdm.id, name: bdm.name });
}
