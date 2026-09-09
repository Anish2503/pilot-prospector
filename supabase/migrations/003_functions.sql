-- =============================================================================
-- Pilot Prospector - Migration 003: Assignment logic + analytics
--
-- Two jobs:
--  1. Assign / reassign leads SAFELY. Closing the old assignment and opening
--     the new one happens as one indivisible step, so a lead can never end up
--     with two owners or none.
--  2. Compute dashboard numbers INSIDE the database. Counting 10,000 leads in
--     Postgres takes milliseconds; downloading them to a phone to count them
--     would take megabytes. All aggregation happens server-side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Write an audit entry. Called by the functions below.
-- -----------------------------------------------------------------------------
create or replace function log_activity(
  p_action   text,
  p_lead_id  uuid default null,
  p_bdm_id   uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_type actor_type;
  v_name text;
begin
  if is_admin() then
    v_type := 'admin';
    select name into v_name from admins where id = app_uid();
  elsif current_bdm() is not null then
    v_type := 'bdm';
    select name into v_name from bdms where id = app_uid();
  else
    v_type := 'system';
  end if;

  insert into activity_logs (actor_type, actor_id, actor_name, action, lead_id, bdm_id, metadata)
  values (v_type, app_uid(), v_name, p_action, p_lead_id, p_bdm_id, p_metadata);
end $fn$;

-- =============================================================================
-- ASSIGN ONE LEAD
-- If the lead already has an owner, that assignment is CLOSED (not deleted)
-- and preserved in history with who changed it and when.
-- =============================================================================
create or replace function assign_lead(
  p_lead_id uuid,
  p_bdm_id  uuid,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev_bdm   uuid;
  v_prev_name  text;
  v_new_name   text;
  v_lead_name  text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can assign leads';
  end if;

  select society_name into v_lead_name from leads where id = p_lead_id;
  if v_lead_name is null then
    raise exception 'NOT_FOUND: that lead no longer exists';
  end if;

  select name into v_new_name from bdms where id = p_bdm_id and active;
  if v_new_name is null then
    raise exception 'INVALID_BDM: that BDM does not exist or is inactive';
  end if;

  -- Who owns it right now?
  select la.bdm_id into v_prev_bdm
  from lead_assignments la
  where la.lead_id = p_lead_id and la.status = 'active';

  if v_prev_bdm = p_bdm_id then
    return jsonb_build_object('changed', false, 'reason', 'already_assigned_to_this_bdm');
  end if;

  -- Close the previous assignment. The row stays forever as history.
  if v_prev_bdm is not null then
    select name into v_prev_name from bdms where id = v_prev_bdm;
    update lead_assignments
       set status = 'reassigned',
           unassigned_at = now(),
           unassigned_by = app_uid()
     where lead_id = p_lead_id and status = 'active';
  end if;

  insert into lead_assignments (lead_id, bdm_id, assigned_by, note)
  values (p_lead_id, p_bdm_id, app_uid(), p_note);

  perform log_activity(
    case when v_prev_bdm is null then 'lead.assigned' else 'lead.reassigned' end,
    p_lead_id, p_bdm_id,
    jsonb_build_object(
      'society_name', v_lead_name,
      'previous_bdm_id', v_prev_bdm,
      'previous_bdm_name', v_prev_name,
      'new_bdm_name', v_new_name,
      'note', p_note
    )
  );

  return jsonb_build_object(
    'changed', true,
    'previous_bdm_name', v_prev_name,
    'new_bdm_name', v_new_name
  );
end $fn$;

-- =============================================================================
-- ASSIGN MANY LEADS AT ONCE
-- Returns a per-lead summary so the UI can report exactly what happened.
-- =============================================================================
create or replace function bulk_assign_leads(
  p_lead_ids uuid[],
  p_bdm_id   uuid,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_id        uuid;
  v_assigned  integer := 0;
  v_reassigned integer := 0;
  v_skipped   integer := 0;
  v_result    jsonb;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can assign leads';
  end if;

  foreach v_id in array p_lead_ids loop
    begin
      v_result := assign_lead(v_id, p_bdm_id, p_note);
      if (v_result ->> 'changed')::boolean then
        if v_result ->> 'previous_bdm_name' is null then
          v_assigned := v_assigned + 1;
        else
          v_reassigned := v_reassigned + 1;
        end if;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'assigned', v_assigned,
    'reassigned', v_reassigned,
    'skipped', v_skipped,
    'total', array_length(p_lead_ids, 1)
  );
end $fn$;

-- =============================================================================
-- REMOVE AN ASSIGNMENT (history is retained)
-- =============================================================================
create or replace function unassign_lead(p_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_bdm uuid; v_name text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN: only a Super Admin can change assignments';
  end if;

  select la.bdm_id into v_bdm from lead_assignments la
   where la.lead_id = p_lead_id and la.status = 'active';

  if v_bdm is null then
    return jsonb_build_object('changed', false, 'reason', 'not_assigned');
  end if;

  select name into v_name from bdms where id = v_bdm;

  update lead_assignments
     set status = 'revoked', unassigned_at = now(), unassigned_by = app_uid()
   where lead_id = p_lead_id and status = 'active';

  perform log_activity('lead.unassigned', p_lead_id, v_bdm,
    jsonb_build_object('previous_bdm_name', v_name));

  return jsonb_build_object('changed', true, 'previous_bdm_name', v_name);
end $fn$;

-- =============================================================================
-- ADMIN GLOBAL DASHBOARD NUMBERS
-- =============================================================================
create or replace function admin_dashboard_stats(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v jsonb;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'total_leads',        count(*),
    'assigned_leads',     count(*) filter (where current_bdm_id is not null),
    'unassigned_leads',   count(*) filter (where current_bdm_id is null),
    'visited_leads',      count(*) filter (where visit_count > 0),
    'pending_leads',      count(*) filter (where visit_count = 0),
    'follow_up_leads',    count(*) filter (where status = 'follow_up'),
    'completed_leads',    count(*) filter (where status = 'completed'),
    'total_units',        coalesce(sum(total_units), 0),
    'leads_with_units',   count(*) filter (where total_units is not null),
    'leads_with_poc',     count(*) filter (where poc_phone is not null or poc_name is not null),
    'leads_with_competitor', count(*) filter (where competitor_name is not null),
    'leads_with_location',count(*) filter (where latitude is not null),
    'leads_need_review',  count(*) filter (where needs_review),
    'geocoded_leads',     count(*) filter (where location_source = 'geocoded')
  ) into v
  from leads
  where (p_from is null or created_at >= p_from)
    and (p_to   is null or created_at <  (p_to + 1));

  return v || (
    select jsonb_build_object(
      'total_bdms',  count(*),
      'active_bdms', count(*) filter (where active)
    ) from bdms
  ) || (
    select jsonb_build_object(
      'total_admins',  count(*),
      'active_admins', count(*) filter (where active)
    ) from admins
  ) || (
    select jsonb_build_object(
      'visits_total', count(*),
      'visits_today', count(*) filter (where visit_date = current_date),
      'visits_7d',    count(*) filter (where visit_date >= current_date - 6)
    ) from lead_visits
  );
end $fn$;

-- =============================================================================
-- PER-BDM PERFORMANCE TABLE (powers "Leads by BDM" and BDM analytics)
-- =============================================================================
create or replace function bdm_performance(
  p_from date default null,
  p_to   date default null
) returns table (
  bdm_id uuid,
  bdm_name text,
  active boolean,
  assigned_leads bigint,
  visited_leads bigint,
  pending_leads bigint,
  follow_up_leads bigint,
  completed_leads bigint,
  total_units bigint,
  pocs_collected bigint,
  poc_designations bigint,
  competitors_identified bigint,
  total_visits bigint,
  last_activity timestamptz
)
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    b.id, b.name, b.active,
    count(l.id)                                                       as assigned_leads,
    count(l.id) filter (where l.visit_count > 0)                      as visited_leads,
    count(l.id) filter (where l.visit_count = 0)                      as pending_leads,
    count(l.id) filter (where l.status = 'follow_up')                 as follow_up_leads,
    count(l.id) filter (where l.status = 'completed')                 as completed_leads,
    coalesce(sum(l.total_units), 0)::bigint                           as total_units,
    count(l.id) filter (where l.poc_phone is not null
                           or l.poc_name is not null)                 as pocs_collected,
    count(l.id) filter (where l.poc_designation is not null)          as poc_designations,
    count(l.id) filter (where l.competitor_name is not null)          as competitors_identified,
    (select count(*) from lead_visits lv
      where lv.bdm_id = b.id
        and (p_from is null or lv.visit_date >= p_from)
        and (p_to   is null or lv.visit_date <= p_to))                as total_visits,
    (select max(lv.created_at) from lead_visits lv where lv.bdm_id = b.id) as last_activity
  from bdms b
  left join leads l on l.current_bdm_id = b.id
  group by b.id, b.name, b.active
  order by b.name;
end $fn$;

-- =============================================================================
-- BREAKDOWNS for charts. p_field is whitelisted - no SQL injection possible.
-- =============================================================================
create or replace function leads_breakdown(
  p_field text,
  p_limit integer default 12
) returns table (label text, lead_count bigint, unit_total bigint)
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_field not in ('area','city','state','competitor_name','status','current_vendor') then
    raise exception 'INVALID_FIELD: %', p_field;
  end if;

  return query execute format(
    'select coalesce(nullif(trim(%I::text), %L), %L) as label,
            count(*)::bigint,
            coalesce(sum(total_units),0)::bigint
       from leads
      group by 1
      order by 2 desc
      limit %s',
    p_field, '', 'Not specified', p_limit
  );
end $fn$;

-- =============================================================================
-- DAILY VISIT ACTIVITY (powers the activity trend chart)
-- =============================================================================
create or replace function visit_activity(p_days integer default 30)
returns table (day date, visits bigint, bdms_active bigint)
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select d::date,
         count(lv.id)                     as visits,
         count(distinct lv.bdm_id)        as bdms_active
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
  left join lead_visits lv on lv.visit_date = d::date
  group by d
  order by d;
end $fn$;

-- =============================================================================
-- THE BDM'S OWN NUMBERS (a BDM may only ever see their own)
-- =============================================================================
create or replace function my_bdm_stats()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_bdm uuid; v jsonb;
begin
  v_bdm := current_bdm();
  if v_bdm is null then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'assigned_leads', count(*),
    'visited_leads',  count(*) filter (where visit_count > 0),
    'pending_leads',  count(*) filter (where visit_count = 0),
    'follow_up_leads',count(*) filter (where status = 'follow_up'),
    'completed_leads',count(*) filter (where status = 'completed'),
    'total_units',    coalesce(sum(total_units), 0),
    'pocs_collected', count(*) filter (where poc_phone is not null or poc_name is not null)
  ) into v
  from leads where current_bdm_id = v_bdm;

  return v || (
    select jsonb_build_object(
      'visits_today', count(*) filter (where visit_date = current_date),
      'visits_7d',    count(*) filter (where visit_date >= current_date - 6)
    ) from lead_visits where bdm_id = v_bdm
  );
end $fn$;

-- =============================================================================
-- DISTINCT FILTER VALUES (populates dropdowns without scanning in the browser)
-- =============================================================================
create or replace function lead_filter_options()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_bdm uuid;
begin
  v_bdm := current_bdm();
  if not is_admin() and v_bdm is null then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'cities', (select coalesce(jsonb_agg(c order by c), '[]'::jsonb) from (
                 select distinct trim(city) c from leads
                 where city is not null and trim(city) <> ''
                   and (is_admin() or current_bdm_id = v_bdm)) t),
    'areas',  (select coalesce(jsonb_agg(a order by a), '[]'::jsonb) from (
                 select distinct trim(area) a from leads
                 where area is not null and trim(area) <> ''
                   and (is_admin() or current_bdm_id = v_bdm)) t),
    'competitors', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (
                 select distinct trim(competitor_name) x from leads
                 where competitor_name is not null and trim(competitor_name) <> ''
                   and (is_admin() or current_bdm_id = v_bdm)) t)
  );
end $fn$;

-- =============================================================================
-- DUPLICATE CANDIDATES - fuzzy name match used by the import preview.
-- Returns likely matches for review. Nothing is ever auto-merged.
-- =============================================================================
create or replace function find_duplicate_candidates(
  p_name       text,
  p_city       text default null,
  p_threshold  real default 0.55,
  p_limit      integer default 5
) returns table (id uuid, society_name text, city text, area text, similarity real)
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select l.id, l.society_name, l.city, l.area,
         similarity(l.society_name, p_name) as sim
  from leads l
  where l.society_name % p_name
    and (p_city is null or lower(coalesce(l.city,'')) = lower(p_city))
  order by sim desc
  limit p_limit;
end $fn$;

-- =============================================================================
-- GRANTS
-- =============================================================================
grant execute on function
  log_activity(text, uuid, uuid, jsonb),
  assign_lead(uuid, uuid, text),
  bulk_assign_leads(uuid[], uuid, text),
  unassign_lead(uuid),
  admin_dashboard_stats(date, date),
  bdm_performance(date, date),
  leads_breakdown(text, integer),
  visit_activity(integer),
  my_bdm_stats(),
  lead_filter_options(),
  find_duplicate_candidates(text, text, real, integer)
to authenticated;
