/**
 * BDM management.  POST /api/manage-bdms
 *
 * Creating a BDM and resetting a PIN happen here rather than in the browser,
 * because the PIN must be hashed with a secret before it is stored. The browser
 * is never trusted with that.
 *
 * Actions:
 *   { action: 'create',    name, phone?, employeeCode?, pin }
 *   { action: 'update',    id, name?, phone?, employeeCode?, active? }
 *   { action: 'reset-pin', id, pin }
 *   { action: 'delete',    id }        - only allowed if never used
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
} from './_shared.ts';

interface Body {
  action?: 'create' | 'update' | 'reset-pin' | 'delete';
  id?: string;
  name?: string;
  phone?: string;
  employeeCode?: string;
  pin?: string;
  active?: boolean;
}

/** PINs anyone would guess in three tries. */
const WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1212', '2580', '0123', '9876',
]);

function validatePin(pin: string | undefined): string {
  const value = (pin ?? '').trim();
  if (!/^\d{4}$/.test(value)) {
    throw new HttpError(400, 'The PIN must be exactly 4 digits.');
  }
  if (WEAK_PINS.has(value)) {
    throw new HttpError(
      400,
      'That PIN is too easy to guess. Please choose a less obvious 4-digit number.',
    );
  }
  return value;
}

function validateName(name: string | undefined): string {
  const value = (name ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 80) {
    throw new HttpError(400, 'Please enter the BDM’s full name.');
  }
  return value;
}

function validatePhone(phone: string | undefined): string | null {
  const value = (phone ?? '').trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) {
    throw new HttpError(400, 'Please enter a valid phone number, or leave it blank.');
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
      const name = validateName(body.name);
      const pin = validatePin(body.pin);
      const phone = validatePhone(body.phone);
      const employeeCode = body.employeeCode?.trim() || null;

      const { data: bdm, error } = await db
        .from('bdms')
        .insert({
          name,
          phone,
          employee_code: employeeCode,
          active: true,
          created_by: admin.uid,
        })
        .select('id, name, phone, employee_code, active, created_at, updated_at, created_by')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new HttpError(409, 'A BDM with that name already exists.');
        }
        throw new HttpError(500, 'Could not create the BDM.');
      }

      const { error: pinError } = await db
        .from('bdm_credentials')
        .insert({ bdm_id: bdm.id, pin_hash: await hashSecret(pin) });

      if (pinError) {
        // Never leave behind an account that cannot be signed in to.
        await db.from('bdms').delete().eq('id', bdm.id);
        throw new HttpError(500, 'Could not save the PIN. Please try again.');
      }

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'bdm.created',
        bdmId: bdm.id,
        metadata: { name },
      });

      return json({ bdm });
    }

    // ------------------------------------------------------------- UPDATE
    if (body.action === 'update') {
      if (!body.id) throw new HttpError(400, 'Which BDM should be updated?');

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = validateName(body.name);
      if (body.phone !== undefined) patch.phone = validatePhone(body.phone);
      if (body.employeeCode !== undefined) {
        patch.employee_code = body.employeeCode.trim() || null;
      }
      if (body.active !== undefined) patch.active = Boolean(body.active);

      if (Object.keys(patch).length === 0) {
        throw new HttpError(400, 'There was nothing to change.');
      }

      const { data: bdm, error } = await db
        .from('bdms')
        .update(patch)
        .eq('id', body.id)
        .select('id, name, phone, employee_code, active, created_at, updated_at, created_by')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new HttpError(409, 'A BDM with that name already exists.');
        }
        throw new HttpError(500, 'Could not update the BDM.');
      }
      if (!bdm) throw new HttpError(404, 'That BDM no longer exists.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: body.active === false ? 'bdm.disabled' : 'bdm.updated',
        bdmId: bdm.id,
        metadata: { name: bdm.name, changes: Object.keys(patch) },
      });

      return json({ bdm });
    }

    // ---------------------------------------------------------- RESET PIN
    if (body.action === 'reset-pin') {
      if (!body.id) throw new HttpError(400, 'Which BDM’s PIN should be reset?');
      const pin = validatePin(body.pin);

      const { data: bdm } = await db
        .from('bdms')
        .select('id, name')
        .eq('id', body.id)
        .maybeSingle();

      if (!bdm) throw new HttpError(404, 'That BDM no longer exists.');

      const { error } = await db.from('bdm_credentials').upsert(
        {
          bdm_id: bdm.id,
          pin_hash: await hashSecret(pin),
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'bdm_id' },
      );

      if (error) throw new HttpError(500, 'Could not reset the PIN.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'bdm.pin_reset',
        bdmId: bdm.id,
        metadata: { name: bdm.name },
      });

      return json({ ok: true, name: bdm.name });
    }

    // ------------------------------------------------------------- DELETE
    if (body.action === 'delete') {
      if (!body.id) throw new HttpError(400, 'Which BDM should be removed?');

      // Refuse if there is any history at all - that history is business
      // record, and deleting the BDM would orphan it. Disable instead.
      const [{ count: assignmentCount }, { count: visitCount }] = await Promise.all([
        db
          .from('lead_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('bdm_id', body.id),
        db.from('lead_visits').select('id', { count: 'exact', head: true }).eq('bdm_id', body.id),
      ]);

      if ((assignmentCount ?? 0) > 0 || (visitCount ?? 0) > 0) {
        throw new HttpError(
          409,
          'This BDM has lead history, so they cannot be deleted. Disable them instead - ' +
            'their past work stays in your records and they can no longer sign in.',
        );
      }

      const { data: bdm } = await db
        .from('bdms')
        .select('id, name')
        .eq('id', body.id)
        .maybeSingle();

      if (!bdm) throw new HttpError(404, 'That BDM no longer exists.');

      const { error } = await db.from('bdms').delete().eq('id', body.id);
      if (error) throw new HttpError(500, 'Could not remove the BDM.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'bdm.deleted',
        metadata: { name: bdm.name },
      });

      return json({ ok: true });
    }

    throw new HttpError(400, 'The request was not valid.');
  } catch (error) {
    return errorResponse(error);
  }
}
