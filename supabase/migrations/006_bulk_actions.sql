-- =============================================================================
-- Pilot Prospector - Migration 006: bulk pull and bulk delete
--
-- DESIGN
-- ------
-- Both functions loop over the ids and delegate to the SINGLE-lead functions
-- that already exist - unassign_lead() and delete_lead(). That is deliberate:
--
--   * bulk delete archives every lead exactly as a single delete does, because
--     it IS a single delete, run repeatedly. There is no second code path that
--     could drift and start skipping the archive.
--   * assignment history is closed the same way, so a lead pulled in bulk is
--     indistinguishable from one pulled on its own.
--   * per-lead audit entries are written by those functions, so the activity
--     log stays at the same granularity as before.
--
-- On top of the per-lead entries, one summary entry records the operation as a
-- whole, so "an admin pulled 35 leads at 14:02" is a single readable line.
--
-- A failure on one lead does not abandon the rest: each is wrapped so the run
-- continues and the caller is told exactly how many succeeded, how many were
-- already unassigned, and how many failed.
--
-- It mirrors the existing bulk_assign_leads() from migration 003.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- =============================================================================

/**
 * Ceiling per call. The browser sends selections in chunks of this size or
 * smaller, which keeps any one statement well inside Supabase's timeout and
 * lets the UI show real progress. It is not a limit on how many leads an admin
 * may act on - only on how many travel in one request.
 */
create or replace function bulk_action_max_batch()
returns integer language sql immutable as $fn$ select 200 $fn$;

-- =============================================================================
-- BULK PULL - take many leads back from their BDMs.
-- The leads themselves are untouched.
-- =============================================================================
create or replace function bulk_pull_leads(p_lead_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id            uuid;
  v_result        jsonb;
  v_selected      integer := coalesce(array_length(p_lead_ids, 1), 0);
  v_pulled        integer := 0;
  v_already       integer := 0;
  v_failed        integer := 0;
  v_bdm_names     text[] := '{}';
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can change assignments';
  end if;

  if v_selected = 0 then
    return jsonb_build_object('selected', 0, 'pulled', 0, 'already_unassigned', 0, 'failed', 0);
  end if;

  if v_selected > bulk_action_max_batch() then
    raise exception 'TOO_MANY: at most % leads can be sent in one request', bulk_action_max_batch();
  end if;

  foreach v_id in array p_lead_ids loop
    begin
      v_result := unassign_lead(v_id);

      if (v_result ->> 'changed')::boolean then
        v_pulled := v_pulled + 1;
        -- Collect the affected BDMs for the summary entry, without duplicates.
        if (v_result ->> 'previous_bdm_name') is not null
           and not ((v_result ->> 'previous_bdm_name') = any (v_bdm_names)) then
          v_bdm_names := v_bdm_names || (v_result ->> 'previous_bdm_name');
        end if;
      else
        -- Selecting a lead nobody owns is not a mistake; it is simply a no-op.
        v_already := v_already + 1;
      end if;

    exception when others then
      -- One bad lead must not abandon the other 199.
      v_failed := v_failed + 1;
    end;
  end loop;

  -- One readable line for the whole operation, alongside the per-lead entries
  -- that unassign_lead() already wrote.
  if v_pulled > 0 or v_failed > 0 then
    perform log_activity(
      'leads.bulk_pulled',
      null,
      null,
      jsonb_build_object(
        'selected', v_selected,
        'pulled', v_pulled,
        'already_unassigned', v_already,
        'failed', v_failed,
        'bdms_affected', to_jsonb(v_bdm_names)
      )
    );
  end if;

  return jsonb_build_object(
    'selected', v_selected,
    'pulled', v_pulled,
    'already_unassigned', v_already,
    'failed', v_failed,
    'bdms_affected', to_jsonb(v_bdm_names)
  );
end $fn$;

-- =============================================================================
-- BULK DELETE - permanently remove many leads.
-- Each one is archived first, exactly as a single delete is.
-- =============================================================================
create or replace function bulk_delete_leads(
  p_lead_ids uuid[],
  p_reason   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id        uuid;
  v_result    jsonb;
  v_selected  integer := coalesce(array_length(p_lead_ids, 1), 0);
  v_deleted   integer := 0;
  v_failed    integer := 0;
  v_visits    integer := 0;
  v_names     text[] := '{}';
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can delete leads';
  end if;

  if v_selected = 0 then
    return jsonb_build_object('selected', 0, 'deleted', 0, 'failed', 0);
  end if;

  if v_selected > bulk_action_max_batch() then
    raise exception 'TOO_MANY: at most % leads can be sent in one request', bulk_action_max_batch();
  end if;

  foreach v_id in array p_lead_ids loop
    begin
      -- delete_lead() archives the lead, its assignments and its visits before
      -- removing it, and writes its own audit entry.
      v_result := delete_lead(v_id, p_reason);
      v_deleted := v_deleted + 1;
      v_visits := v_visits + coalesce((v_result ->> 'visits_archived')::integer, 0);

      -- A handful of names is enough to make the summary meaningful.
      if array_length(v_names, 1) is null or array_length(v_names, 1) < 5 then
        v_names := v_names || (v_result ->> 'society_name');
      end if;

    exception when others then
      -- Most likely someone else deleted it a moment ago.
      v_failed := v_failed + 1;
    end;
  end loop;

  if v_deleted > 0 or v_failed > 0 then
    perform log_activity(
      'leads.bulk_deleted',
      null,
      null,
      jsonb_build_object(
        'selected', v_selected,
        'deleted', v_deleted,
        'failed', v_failed,
        'visits_archived', v_visits,
        'sample_names', to_jsonb(v_names),
        'reason', p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'selected', v_selected,
    'deleted', v_deleted,
    'failed', v_failed,
    'visits_archived', v_visits
  );
end $fn$;

-- =============================================================================
-- SELECTION SUMMARY
--
-- Powers the "you are about to delete N leads" dialog: how many of the chosen
-- leads are assigned, how many have visit history, and a few names to show.
-- One small request instead of pulling every selected row into the browser.
-- =============================================================================
create or replace function lead_selection_summary(p_lead_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v jsonb;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'found',       count(*),
    'assigned',    count(*) filter (where current_bdm_id is not null),
    'unassigned',  count(*) filter (where current_bdm_id is null),
    'with_visits', count(*) filter (where visit_count > 0),
    'total_visits', coalesce(sum(visit_count), 0),
    'sample_names', coalesce(
      (select jsonb_agg(s.society_name order by s.society_name)
         from (select l2.society_name
                 from leads l2
                where l2.id = any (p_lead_ids)
                order by l2.society_name
                limit 5) s),
      '[]'::jsonb
    ),
    'bdms', coalesce(
      (select jsonb_agg(distinct b.name)
         from leads l3
         join bdms b on b.id = l3.current_bdm_id
        where l3.id = any (p_lead_ids)),
      '[]'::jsonb
    )
  ) into v
  from leads
  where id = any (p_lead_ids);

  return v;
end $fn$;

-- =============================================================================
-- GRANTS
-- Admin-only is enforced inside each function, not by who may call it.
-- =============================================================================
grant execute on function bulk_action_max_batch() to authenticated;
grant execute on function bulk_pull_leads(uuid[]) to authenticated;
grant execute on function bulk_delete_leads(uuid[], text) to authenticated;
grant execute on function lead_selection_summary(uuid[]) to authenticated;
