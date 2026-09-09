/**
 * One-time bootstrap.  POST /api/setup
 *
 * Creates the very first Super Admin account. Every later admin is created from
 * inside the app by an existing admin.
 *
 * Two locks protect it:
 *   1. It refuses to run if ANY active admin already exists.
 *   2. It requires the SETUP_SECRET you set in Netlify.
 *
 * Once your first account exists, delete SETUP_SECRET from Netlify.
 */

import {
  assertMethod,
  errorResponse,
  hashSecret,
  HttpError,
  json,
  logActivity,
  readJson,
  requireEnv,
  supabaseAdmin,
} from './_shared.ts';
import { timingSafeEqual } from 'node:crypto';

interface SetupBody {
  setupSecret?: string;
  name?: string;
  username?: string;
  password?: string;
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request: Request): Promise<Response> {
  try {
    // A GET simply reports whether setup is still needed, so the UI can show
    // the right screen without revealing anything sensitive.
    if (request.method === 'GET') {
      const { count } = await supabaseAdmin()
        .from('admins')
        .select('id', { count: 'exact', head: true })
        .eq('active', true);
      return json({ needsSetup: (count ?? 0) === 0 });
    }

    assertMethod(request, 'POST');
    const body = await readJson<SetupBody>(request);

    const expected = requireEnv('SETUP_SECRET');
    if (!body.setupSecret || !secretsMatch(body.setupSecret, expected)) {
      throw new HttpError(401, 'That setup code is not correct.');
    }

    const db = supabaseAdmin();

    const { count } = await db
      .from('admins')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);

    if ((count ?? 0) > 0) {
      throw new HttpError(
        409,
        'Setup has already been completed. Sign in, then create further admins from Admin Management.',
      );
    }

    const name = body.name?.trim();
    const username = body.username?.trim().toLowerCase();
    const password = body.password ?? '';

    if (!name || name.length < 2) throw new HttpError(400, 'Please enter your full name.');
    if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new HttpError(
        400,
        'Username must be 3-32 characters: lowercase letters, numbers, dot, dash or underscore.',
      );
    }
    if (password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters.');
    }

    const { data: admin, error } = await db
      .from('admins')
      .insert({ name, username, active: true })
      .select('id, name, username')
      .single();

    if (error || !admin) {
      throw new HttpError(500, 'Could not create the account. Please try again.');
    }

    const { error: credError } = await db.from('admin_credentials').insert({
      admin_id: admin.id,
      password_hash: await hashSecret(password),
    });

    if (credError) {
      // Do not leave an account behind that nobody can sign in to.
      await db.from('admins').delete().eq('id', admin.id);
      throw new HttpError(500, 'Could not save the password. Please try again.');
    }

    await logActivity({
      actorType: 'system',
      actorName: admin.name,
      action: 'admin.created',
      metadata: { username: admin.username, via: 'initial_setup' },
    });

    return json({
      ok: true,
      message: 'Your Super Admin account is ready. You can now sign in.',
      username: admin.username,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
