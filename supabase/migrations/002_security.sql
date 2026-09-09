-- =============================================================================
-- Pilot Prospector - Migration 002: Authentication helpers + Row Level Security
--
-- HOW IT WORKS IN PLAIN ENGLISH
-- -----------------------------
-- When someone logs in, our server (a Netlify Function) checks their password
-- or PIN and hands the browser a signed "pass" (a JWT). That pass says:
--     app_role = 'super_admin'  or  'bdm'
--     uid      = the person's id
-- The pass is signed with a secret only our server knows, so a user cannot
-- forge one or edit their own.
--
-- Every query the browser sends carries that pass. PostgreSQL reads it and
-- applies the rules below BEFORE returning any row. So if BDM A asks for BDM
-- B's leads - by editing a URL, by using the browser console, by any means -
-- the database returns zero rows. Security does not depend on our UI code.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reading the signed pass
-- -----------------------------------------------------------------------------
create or replace function jwt_claim(claim text)
returns text language sql stable as $fn$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> claim
$fn$;

create or replace function app_role()
returns text language sql stable as $fn$
  select coalesce(jwt_claim('app_role'), '')
$fn$;

-- Defensive: a malformed uid must yield NULL, never an error that leaks detail.
create or replace function app_uid()
returns uuid language plpgsql stable as $fn$
declare raw text;
begin
  raw := jwt_claim('uid');
  if raw is null or raw = '' then return null; end if;
  return raw::uuid;
exception when others then
  return null;
end $fn$;

-- TRUE only for a pass that says super_admin AND a matching, still-active row.
-- Deactivating an admin therefore takes effect immediately, even mid-session.
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select app_role() = 'super_admin'
     and exists (select 1 from admins a where a.id = app_uid() and a.active)
$fn$;

-- Returns the logged-in BDM's id, or NULL for anyone else.
-- Deactivating a BDM instantly revokes their access.
create or replace function current_bdm()
returns uuid language sql stable security definer set search_path = public as $fn$
  select b.id from bdms b
  where app_role() = 'bdm' and b.id = app_uid() and b.active
$fn$;

-- =============================================================================
-- TURN ON ROW LEVEL SECURITY EVERYWHERE
-- With RLS on and no matching policy, the answer is always "no rows".
-- =============================================================================
alter table admins             enable row level security;
alter table admin_credentials  enable row level security;
alter table bdms               enable row level security;
alter table bdm_credentials    enable row level security;
alter table leads              enable row level security;
alter table lead_assignments   enable row level security;
alter table lead_visits        enable row level security;
alter table import_jobs        enable row level security;
alter table activity_logs      enable row level security;
alter table app_settings       enable row level security;

-- -----------------------------------------------------------------------------
-- CREDENTIALS: no policies at all, on purpose.
-- Password and PIN hashes are reachable ONLY by our server (service role,
-- which bypasses RLS). The browser cannot read them under any circumstance.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- ADMINS
-- -----------------------------------------------------------------------------
drop policy if exists admins_select on admins;
create policy admins_select on admins for select using (is_admin());
-- Creating/disabling admins happens through a server function (it must hash a
-- password), so there are deliberately no insert/update/delete policies here.

-- -----------------------------------------------------------------------------
-- BDMS
-- -----------------------------------------------------------------------------
drop policy if exists bdms_select on bdms;
create policy bdms_select on bdms for select
  using (is_admin() or id = current_bdm());

drop policy if exists bdms_update on bdms;
create policy bdms_update on bdms for update
  using (is_admin()) with check (is_admin());
-- Inserting a BDM goes through a server function (it must hash the PIN).

-- -----------------------------------------------------------------------------
-- LEADS  <- BUSINESS RULE 2 and 3 live here
-- -----------------------------------------------------------------------------
drop policy if exists leads_select on leads;
create policy leads_select on leads for select
  using (
    is_admin()                        -- Rule 3: admins see everything
    or current_bdm_id = current_bdm() -- Rule 2: a BDM sees only their own leads
  );

drop policy if exists leads_insert on leads;
create policy leads_insert on leads for insert with check (is_admin());

drop policy if exists leads_update on leads;
create policy leads_update on leads for update
  using (is_admin()) with check (is_admin());

drop policy if exists leads_delete on leads;
create policy leads_delete on leads for delete using (is_admin());

-- -----------------------------------------------------------------------------
-- LEAD ASSIGNMENTS
-- -----------------------------------------------------------------------------
drop policy if exists lead_assignments_select on lead_assignments;
create policy lead_assignments_select on lead_assignments for select
  using (is_admin() or bdm_id = current_bdm());

drop policy if exists lead_assignments_write on lead_assignments;
create policy lead_assignments_write on lead_assignments for all
  using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- LEAD VISITS
-- A BDM may read and write only their own visit records. The trigger in
-- migration 001 additionally refuses any visit for a lead not assigned to them.
-- -----------------------------------------------------------------------------
drop policy if exists lead_visits_select on lead_visits;
create policy lead_visits_select on lead_visits for select
  using (is_admin() or bdm_id = current_bdm());

drop policy if exists lead_visits_insert on lead_visits;
create policy lead_visits_insert on lead_visits for insert
  with check (bdm_id = current_bdm() or is_admin());

drop policy if exists lead_visits_update on lead_visits;
create policy lead_visits_update on lead_visits for update
  using (is_admin() or bdm_id = current_bdm())
  with check (is_admin() or bdm_id = current_bdm());

drop policy if exists lead_visits_delete on lead_visits;
create policy lead_visits_delete on lead_visits for delete using (is_admin());

-- -----------------------------------------------------------------------------
-- IMPORT JOBS - admin only
-- -----------------------------------------------------------------------------
drop policy if exists import_jobs_all on import_jobs;
create policy import_jobs_all on import_jobs for all
  using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- ACTIVITY LOGS - admins read everything; both roles can append.
-- Nobody can edit or delete an audit entry. Ever.
-- -----------------------------------------------------------------------------
drop policy if exists activity_logs_select on activity_logs;
create policy activity_logs_select on activity_logs for select using (is_admin());

drop policy if exists activity_logs_insert on activity_logs;
create policy activity_logs_insert on activity_logs for insert
  with check (is_admin() or current_bdm() is not null);

-- -----------------------------------------------------------------------------
-- APP SETTINGS - everyone signed in may read; only admins may change.
-- -----------------------------------------------------------------------------
drop policy if exists app_settings_select on app_settings;
create policy app_settings_select on app_settings for select
  using (is_admin() or current_bdm() is not null);

drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings for all
  using (is_admin()) with check (is_admin());

-- =============================================================================
-- GRANTS
-- `anon` is the not-logged-in public. It gets nothing at all.
-- `authenticated` gets table access, but every row still passes RLS first.
-- =============================================================================
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant select, insert, update, delete on
  admins, bdms, leads, lead_assignments, lead_visits,
  import_jobs, activity_logs, app_settings
to authenticated;

-- Credential tables are never granted to anyone but the service role.
revoke all on admin_credentials, bdm_credentials from anon, authenticated;

grant execute on function jwt_claim(text), app_role(), app_uid(), is_admin(), current_bdm()
  to authenticated;

-- =============================================================================
-- SEED: default configurable lead statuses
-- =============================================================================
insert into app_settings (key, value) values
  ('lead_statuses', '[
     {"value":"unassigned","label":"Unassigned","color":"slate"},
     {"value":"assigned","label":"Assigned","color":"blue"},
     {"value":"visited","label":"Visited","color":"emerald"},
     {"value":"follow_up","label":"Follow-up","color":"amber"},
     {"value":"completed","label":"Completed","color":"violet"}
   ]'::jsonb)
on conflict (key) do nothing;
