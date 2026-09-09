-- =============================================================================
-- Pilot Prospector - Migration 005: deleting a lead, and pulling one back
--
-- WHY THIS EXISTS
-- ---------------
-- Admins need to permanently remove a society that was uploaded by mistake, is
-- a duplicate, or has closed down. But the foreign keys in migration 001 mean a
-- plain DELETE quietly destroys history:
--
--     lead_assignments.lead_id  ON DELETE CASCADE  -> who owned it, and when
--     lead_visits.lead_id       ON DELETE CASCADE  -> every visit, remark, POC
--     activity_logs.lead_id     ON DELETE SET NULL -> audit survives, but
--                                                     loses which lead it meant
--
-- Losing a BDM's visit record because an admin tidied up a lead would be a real
-- loss - that is the team's field work, and it feeds the analytics.
--
-- THE STRATEGY: archive, then delete.
-- Deleting takes a full snapshot of the lead and everything hanging off it into
-- `deleted_leads` first. The operational tables end up genuinely clean - the
-- lead is gone from the dashboard, map, search, counts and every BDM's list -
-- while the record of what was removed, by whom, and what it contained is kept
-- permanently.
--
-- To make that guarantee real, direct DELETE on `leads` is REVOKED. The only
-- way to remove a lead is delete_lead(), which always archives first. An admin
-- cannot skip the archive even by calling the API directly.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- THE ARCHIVE
-- Deliberately no foreign key to leads: the whole point is that the lead is
-- gone. lead_id is kept as a plain uuid so an old activity log or export can
-- still be traced back.
-- -----------------------------------------------------------------------------
create table if not exists deleted_leads (
  id                   uuid primary key default gen_random_uuid(),

  lead_id              uuid not null,
  society_name         text not null,
  city                 text,
  area                 text,

  -- Complete copies, so nothing is lost.
  lead_snapshot        jsonb not null,
  assignments_snapshot jsonb not null default '[]'::jsonb,
  visits_snapshot      jsonb not null default '[]'::jsonb,

  -- Denormalised for quick reading without unpacking the JSON.
  visit_count          integer not null default 0,
  assignment_count     integer not null default 0,
  last_bdm_id          uuid,
  last_bdm_name        text,

  deleted_by           uuid references admins(id) on delete set null,
  deleted_by_name      text,
  deleted_at           timestamptz not null default now(),
  reason               text
);

create index if not exists deleted_leads_deleted_at_idx on deleted_leads (deleted_at desc);
create index if not exists deleted_leads_lead_id_idx    on deleted_leads (lead_id);
create index if not exists deleted_leads_name_idx       on deleted_leads (lower(society_name));

alter table deleted_leads enable row level security;

-- Admins may read the archive. Nobody may write to it by hand - only
-- delete_lead() does, and it runs as the table owner.
drop policy if exists deleted_leads_select on deleted_leads;
create policy deleted_leads_select on deleted_leads for select using (is_admin());

grant select on deleted_leads to authenticated;

-- =============================================================================
-- DELETE A LEAD
--
-- Archives everything, removes the lead, writes an audit entry, and reports
-- what was removed so the UI can say something meaningful.
-- =============================================================================
create or replace function delete_lead(
  p_lead_id uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_lead        leads%rowtype;
  v_assignments jsonb;
  v_visits      jsonb;
  v_visit_count integer;
  v_assign_count integer;
  v_bdm_id      uuid;
  v_bdm_name    text;
  v_admin_name  text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can delete a lead';
  end if;

  select * into v_lead from leads where id = p_lead_id;
  if not found then
    raise exception 'NOT_FOUND: that lead has already been deleted';
  end if;

  -- Who has it right now, if anyone - worth recording prominently.
  select la.bdm_id, b.name into v_bdm_id, v_bdm_name
  from lead_assignments la
  join bdms b on b.id = la.bdm_id
  where la.lead_id = p_lead_id and la.status = 'active'
  limit 1;

  -- ---- Snapshot everything that is about to be cascaded away.
  select coalesce(jsonb_agg(to_jsonb(la) order by la.assigned_at), '[]'::jsonb), count(*)
    into v_assignments, v_assign_count
  from lead_assignments la where la.lead_id = p_lead_id;

  select coalesce(jsonb_agg(to_jsonb(lv) order by lv.created_at), '[]'::jsonb), count(*)
    into v_visits, v_visit_count
  from lead_visits lv where lv.lead_id = p_lead_id;

  select name into v_admin_name from admins where id = app_uid();

  insert into deleted_leads (
    lead_id, society_name, city, area,
    lead_snapshot, assignments_snapshot, visits_snapshot,
    visit_count, assignment_count, last_bdm_id, last_bdm_name,
    deleted_by, deleted_by_name, reason
  ) values (
    v_lead.id, v_lead.society_name, v_lead.city, v_lead.area,
    to_jsonb(v_lead), v_assignments, v_visits,
    v_visit_count, v_assign_count, v_bdm_id, v_bdm_name,
    app_uid(), v_admin_name, nullif(trim(coalesce(p_reason, '')), '')
  );

  -- ---- Audit BEFORE the row disappears.
  -- lead_id is passed as NULL because the foreign key would null it a moment
  -- later anyway; the identity is carried in the metadata instead, so the entry
  -- stays meaningful forever.
  perform log_activity(
    'lead.deleted',
    null,
    v_bdm_id,
    jsonb_build_object(
      'lead_id',          v_lead.id::text,
      'society_name',     v_lead.society_name,
      'city',             v_lead.city,
      'area',             v_lead.area,
      'total_units',      v_lead.total_units,
      'previous_bdm_name', v_bdm_name,
      'visits_archived',  v_visit_count,
      'assignments_archived', v_assign_count,
      'reason',           p_reason
    )
  );

  -- ---- Remove it. Assignments and visits cascade; they are safe in the archive.
  delete from leads where id = p_lead_id;

  return jsonb_build_object(
    'deleted', true,
    'society_name', v_lead.society_name,
    'previous_bdm_name', v_bdm_name,
    'visits_archived', v_visit_count,
    'assignments_archived', v_assign_count
  );
end $fn$;

-- =============================================================================
-- REMOVE DIRECT DELETE
--
-- With the policy gone, a DELETE straight to the API affects zero rows for
-- everyone, admins included. delete_lead() still works because it is SECURITY
-- DEFINER and runs as the table owner - so the archive can never be bypassed.
-- =============================================================================
drop policy if exists leads_delete on leads;
revoke delete on leads from authenticated;

-- =============================================================================
-- PULL A LEAD BACK FROM A BDM
--
-- This already existed as unassign_lead(). It is replaced here only to record
-- the society name alongside the BDM name, so the activity log reads properly
-- on its own without having to look the lead up.
--
-- What it does NOT do, and must never do: delete anything. The assignment row
-- is marked 'revoked' and kept, the lead stays exactly where it is, and every
-- visit the BDM logged remains theirs.
-- =============================================================================
create or replace function unassign_lead(p_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_bdm       uuid;
  v_bdm_name  text;
  v_lead_name text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can change assignments';
  end if;

  select society_name into v_lead_name from leads where id = p_lead_id;
  if v_lead_name is null then
    raise exception 'NOT_FOUND: that lead no longer exists';
  end if;

  select la.bdm_id into v_bdm
  from lead_assignments la
  where la.lead_id = p_lead_id and la.status = 'active';

  if v_bdm is null then
    return jsonb_build_object('changed', false, 'reason', 'not_assigned');
  end if;

  select name into v_bdm_name from bdms where id = v_bdm;

  -- Kept, not deleted: status changes and the closing details are filled in.
  update lead_assignments
     set status        = 'revoked',
         unassigned_at = now(),
         unassigned_by = app_uid()
   where lead_id = p_lead_id and status = 'active';

  -- The trigger from migration 001 now clears leads.current_bdm_id and, for a
  -- lead nobody has visited yet, sets the status back to 'unassigned'.

  perform log_activity(
    'lead.unassigned',
    p_lead_id,
    v_bdm,
    jsonb_build_object(
      'society_name',      v_lead_name,
      'previous_bdm_id',   v_bdm::text,
      'previous_bdm_name', v_bdm_name
    )
  );

  return jsonb_build_object(
    'changed', true,
    'society_name', v_lead_name,
    'previous_bdm_name', v_bdm_name
  );
end $fn$;

-- =============================================================================
-- GRANTS
-- =============================================================================
grant execute on function delete_lead(uuid, text) to authenticated;
grant execute on function unassign_lead(uuid) to authenticated;
