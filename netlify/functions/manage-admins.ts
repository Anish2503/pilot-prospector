/**
 * Super Admin management.  POST /api/manage-admins
 *
 * All Super Admins are equal - there is no hierarchy. Any of them may create
 * another, disable one, or reset a password.
 *
 * Actions:
 *   { action: 'create',          name, username, password }
 *   { action: 'set-active',      id, active }
 *   { action: 'reset-password',  id, password }
 *   { action: 'change-my-password', currentPassword, newPassword }
 */

import {
  assertMethod,
  errorResponse,
  hashSecret,
  HttpError,
  json,
  logActivity,
  readJson,
  requireAdmin,
  supabaseAdmin,
  verifySecret,
} from './_shared.ts';

interface Body {
  action?: 'create' | 'set-active' | 'reset-password' | 'change-my-password';
  id?: string;
  name?: string;
  username?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
  active?: boolean;
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function validatePassword(password: string | undefined): string {
  const value = password ?? '';
  if (value.length < 8) {
    throw new HttpError(400, 'The password must be at least 8 characters.');
  }
  if (value.length > 200) {
    throw new HttpError(400, 'That password is too long.');
  }
  // Catches the most obvious choices without being annoying about it.
  if (/^(password|12345678|qwerty|admin123)/i.test(value)) {
    throw new HttpError(400, 'That password is too easy to guess. Please choose another.');
  }
  return value;
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    const admin = await requireAdmin(request);
    const body = await readJson<Body>(request);
    const db = supabaseAdmin();

    // ------------------------------------------------------------- CREATE
    if (body.action === 'create') {
      const name = body.name?.trim().replace(/\s+/g, ' ');
      const username = body.username?.trim().toLowerCase();
      const password = validatePassword(body.password);

      if (!name || name.length < 2) throw new HttpError(400, 'Please enter their full name.');
      if (!username || !USERNAME_PATTERN.test(username)) {
        throw new HttpError(
          400,
          'Username must be 3-32 characters: lowercase letters, numbers, dot, dash or underscore.',
        );
      }

      const { data: created, error } = await db
        .from('admins')
        .insert({ name, username, active: true, created_by: admin.uid })
        .select('id, name, username, active, created_at, updated_at, created_by')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new HttpError(409, 'That username is already taken.');
        }
        throw new HttpError(500, 'Could not create the admin account.');
      }

      const { error: credError } = await db
        .from('admin_credentials')
        .insert({ admin_id: created.id, password_hash: await hashSecret(password) });

      if (credError) {
        await db.from('admins').delete().eq('id', created.id);
        throw new HttpError(500, 'Could not save the password. Please try again.');
      }

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'admin.created',
        metadata: { username, name },
      });

      return json({ admin: created });
    }

    // --------------------------------------------------------- SET ACTIVE
    if (body.action === 'set-active') {
      if (!body.id) throw new HttpError(400, 'Which admin?');
      const active = Boolean(body.active);

      if (body.id === admin.uid && !active) {
        throw new HttpError(
          400,
          'You cannot disable your own account. Ask another Super Admin to do it.',
        );
      }

      // Never allow the last way in to be closed off.
      if (!active) {
        const { count } = await db
          .from('admins')
          .select('id', { count: 'exact', head: true })
          .eq('active', true);

        if ((count ?? 0) <= 1) {
          throw new HttpError(
            400,
            'This is the only active Super Admin. Create another one before disabling this account.',
          );
        }
      }

      const { data: updated, error } = await db
        .from('admins')
        .update({ active })
        .eq('id', body.id)
        .select('id, name, username, active, created_at, updated_at, created_by')
        .single();

      if (error || !updated) throw new HttpError(500, 'Could not update that admin.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: active ? 'admin.enabled' : 'admin.disabled',
        metadata: { username: updated.username, name: updated.name },
      });

      return json({ admin: updated });
    }

    // ----------------------------------------------------- RESET PASSWORD
    if (body.action === 'reset-password') {
      if (!body.id) throw new HttpError(400, 'Which admin?');
      const password = validatePassword(body.password);

      const { data: target } = await db
        .from('admins')
        .select('id, name, username')
        .eq('id', body.id)
        .maybeSingle();

      if (!target) throw new HttpError(404, 'That admin no longer exists.');

      const { error } = await db.from('admin_credentials').upsert(
        {
          admin_id: target.id,
          password_hash: await hashSecret(password),
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'admin_id' },
      );

      if (error) throw new HttpError(500, 'Could not reset the password.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'admin.password_reset',
        metadata: { username: target.username, name: target.name },
      });

      return json({ ok: true, name: target.name });
    }

    // -------------------------------------------------- CHANGE MY OWN PASSWORD
    if (body.action === 'change-my-password') {
      const newPassword = validatePassword(body.newPassword);

      const { data: creds } = await db
        .from('admin_credentials')
        .select('password_hash')
        .eq('admin_id', admin.uid)
        .maybeSingle();

      if (!creds) throw new HttpError(404, 'Your account could not be found.');

      // Knowing the old password is required, so a borrowed unlocked laptop
      // cannot be used to lock the real owner out.
      const ok = await verifySecret(body.currentPassword ?? '', creds.password_hash);
      if (!ok) throw new HttpError(401, 'Your current password is not correct.');

      const { error } = await db
        .from('admin_credentials')
        .update({
          password_hash: await hashSecret(newPassword),
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('admin_id', admin.uid);

      if (error) throw new HttpError(500, 'Could not change your password.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'admin.password_changed',
      });

      return json({ ok: true });
    }

    throw new HttpError(400, 'The request was not valid.');
  } catch (error) {
    return errorResponse(error);
  }
}
