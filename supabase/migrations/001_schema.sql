-- =============================================================================
-- Pilot Prospector - BDM Lead Management
-- Migration 001: Extensions, enums, tables, indexes, triggers
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run; every statement is idempotent.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy search + duplicate detection
create extension if not exists unaccent;   -- accent-insensitive normalisation

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
do $enum$ begin
  create type lead_status as enum ('unassigned','assigned','visited','follow_up','completed');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type location_source as enum ('uploaded','geocoded','manual','unknown');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type data_confidence as enum ('high','medium','low','unverified');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type assignment_status as enum ('active','reassigned','revoked');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type import_status as enum ('uploaded','previewing','importing','completed','failed','cancelled');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type actor_type as enum ('admin','bdm','system');
exception when duplicate_object then null; end $enum$;

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

-- Strips punctuation/spacing/case so "Prestige Lakeside Habitat" and
-- "prestige-lakeside habitat" collapse to the same key for duplicate detection.
create or replace function normalize_society_name(txt text)
returns text language sql immutable as $fn$
  select regexp_replace(lower(unaccent(coalesce(txt,''))), '[^a-z0-9]+', '', 'g')
$fn$;

-- =============================================================================
-- ADMINS - Super Admins. All have identical permissions (no hierarchy).
-- =============================================================================
create table if not exists admins (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  username    text not null,
  active      boolean not null default true,
  created_by  uuid references admins(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists admins_username_key on admins (lower(username));

drop trigger if exists trg_admins_updated on admins;
create trigger trg_admins_updated before update on admins
  for each row execute function set_updated_at();

-- Password hashes live in a SEPARATE table that the browser can never read,
-- even if a Row Level Security policy were ever misconfigured on `admins`.
create table if not exists admin_credentials (
  admin_id        uuid primary key references admins(id) on delete cascade,
  password_hash   text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  updated_at      timestamptz not null default now()
);

-- =============================================================================
-- BDMS - Business Development Managers
-- =============================================================================
create table if not exists bdms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  employee_code text,
  active        boolean not null default true,
  created_by    uuid references admins(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two BDMs cannot share a name - the login dropdown must be unambiguous.
create unique index if not exists bdms_name_key on bdms (lower(name));

drop trigger if exists trg_bdms_updated on bdms;
create trigger trg_bdms_updated before update on bdms
  for each row execute function set_updated_at();

-- 4-digit PIN hashes - never readable by the browser.
create table if not exists bdm_credentials (
  bdm_id          uuid primary key references bdms(id) on delete cascade,
  pin_hash        text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  updated_at      timestamptz not null default now()
);

-- =============================================================================
-- IMPORT JOBS - one row per spreadsheet upload
-- =============================================================================
create table if not exists import_jobs (
  id              uuid primary key default gen_random_uuid(),
  filename        text not null,
  uploaded_by     uuid references admins(id) on delete set null,
  status          import_status not null default 'uploaded',
  total_rows      integer not null default 0,
  successful_rows integer not null default 0,
  failed_rows     integer not null default 0,
  duplicate_rows  integer not null default 0,
  updated_rows    integer not null default 0,
  column_mapping  jsonb,
  error_summary   jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists import_jobs_created_idx on import_jobs (created_at desc);

-- =============================================================================
-- LEADS / SOCIETIES
-- =============================================================================
create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),

  society_name         text not null,
  normalized_name      text generated always as (normalize_society_name(society_name)) stored,

  -- Unit information
  total_units          integer check (total_units is null or total_units >= 0),
  units_source         text not null default 'unknown',  -- uploaded|manual|bdm_visit|unknown
  units_confidence     data_confidence not null default 'unverified',
  units_updated_at     timestamptz,

  -- Location
  latitude             double precision check (latitude is null or (latitude between -90 and 90)),
  longitude            double precision check (longitude is null or (longitude between -180 and 180)),
  location_source      location_source not null default 'unknown',
  location_confidence  data_confidence not null default 'unverified',
  geocoded_at          timestamptz,
  geocode_query        text,
  geocode_display_name text,

  -- Address
  address              text,
  area                 text,
  city                 text,
  state                text,
  pincode              text,

  -- Provenance
  source               text,
  source_file          text,
  source_row           integer,
  import_job_id        uuid references import_jobs(id) on delete set null,

  -- Workflow
  status               lead_status not null default 'unassigned',
  current_bdm_id       uuid references bdms(id) on delete set null,
  assigned_at          timestamptz,

  -- Latest-known values, kept in sync from lead_visits by trigger.
  -- The FULL history always remains in lead_visits - nothing is ever lost.
  competitor_name      text,
  current_vendor       text,
  poc_name             text,
  poc_designation      text,
  poc_phone            text,
  follow_up_date       date,
  last_visit_at        timestamptz,
  last_remark          text,
  visit_count          integer not null default 0,

  -- Review queue
  needs_review         boolean not null default false,
  review_reason        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_leads_updated on leads;
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();

-- Indexes sized for 10,000+ leads with server-side filtering.
create index if not exists leads_current_bdm_idx  on leads (current_bdm_id);
create index if not exists leads_status_idx       on leads (status);
create index if not exists leads_city_idx         on leads (lower(city));
create index if not exists leads_area_idx         on leads (lower(area));
create index if not exists leads_needs_review_idx on leads (needs_review) where needs_review;
create index if not exists leads_normalized_idx   on leads (normalized_name);
create index if not exists leads_name_trgm_idx    on leads using gin (society_name gin_trgm_ops);
create index if not exists leads_import_job_idx   on leads (import_job_id);
create index if not exists leads_created_idx      on leads (created_at desc);
create index if not exists leads_coords_idx       on leads (latitude, longitude)
  where latitude is not null and longitude is not null;

-- =============================================================================
-- LEAD ASSIGNMENTS - history is preserved; rows are never deleted
-- =============================================================================
create table if not exists lead_assignments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  bdm_id        uuid not null references bdms(id) on delete restrict,
  assigned_by   uuid references admins(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  unassigned_by uuid references admins(id) on delete set null,
  status        assignment_status not null default 'active',
  note          text
);

-- ***************************************************************************
-- BUSINESS RULE 1, ENFORCED BY THE DATABASE ITSELF:
-- A lead can have AT MOST ONE active assignment at any moment.
-- No frontend bug or API misuse can ever violate this.
-- ***************************************************************************
create unique index if not exists lead_assignments_one_active_idx
  on lead_assignments (lead_id) where status = 'active';

create index if not exists lead_assignments_bdm_idx  on lead_assignments (bdm_id, status);
create index if not exists lead_assignments_lead_idx on lead_assignments (lead_id, assigned_at desc);

-- =============================================================================
-- LEAD VISITS - append-only history of BDM updates
-- =============================================================================
create table if not exists lead_visits (
  id                      uuid primary key default gen_random_uuid(),
  lead_id                 uuid not null references leads(id) on delete cascade,
  bdm_id                  uuid not null references bdms(id) on delete restrict,
  assignment_id           uuid references lead_assignments(id) on delete set null,

  visit_date              date not null default current_date,

  total_units             integer check (total_units is null or total_units >= 0),
  competitor_name         text,
  current_vendor          text,
  remarks                 text,

  poc_name                text,
  poc_designation         text,
  poc_phone               text,

  status_after            lead_status,
  follow_up_date          date,

  latitude_at_visit       double precision,
  longitude_at_visit      double precision,
  distance_from_society_m double precision,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists trg_lead_visits_updated on lead_visits;
create trigger trg_lead_visits_updated before update on lead_visits
  for each row execute function set_updated_at();

create index if not exists lead_visits_lead_idx on lead_visits (lead_id, created_at desc);
create index if not exists lead_visits_bdm_idx  on lead_visits (bdm_id, created_at desc);
create index if not exists lead_visits_date_idx on lead_visits (visit_date desc);

-- =============================================================================
-- ACTIVITY LOG - audit trail
-- =============================================================================
create table if not exists activity_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_type actor_type not null,
  actor_id   uuid,
  actor_name text,
  action     text not null,
  lead_id    uuid references leads(id) on delete set null,
  bdm_id     uuid references bdms(id) on delete set null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_idx on activity_logs (created_at desc);
create index if not exists activity_logs_lead_idx    on activity_logs (lead_id, created_at desc);
create index if not exists activity_logs_actor_idx   on activity_logs (actor_type, actor_id, created_at desc);

-- =============================================================================
-- APP SETTINGS - small key/value store for configurable behaviour
-- =============================================================================
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

-- =============================================================================
-- TRIGGER: keep leads.current_bdm_id / status in sync with lead_assignments
-- =============================================================================
create or replace function sync_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  active_bdm  uuid;
  active_at   timestamptz;
  target_lead uuid;
begin
  target_lead := coalesce(new.lead_id, old.lead_id);

  select la.bdm_id, la.assigned_at into active_bdm, active_at
  from lead_assignments la
  where la.lead_id = target_lead and la.status = 'active'
  limit 1;

  update leads l set
    current_bdm_id = active_bdm,
    assigned_at    = active_at,
    status = case
      -- Losing the assignment sends an untouched lead back to 'unassigned'.
      when active_bdm is null and l.visit_count = 0 then 'unassigned'::lead_status
      -- Gaining an assignment on an untouched lead moves it to 'assigned'.
      when active_bdm is not null and l.status = 'unassigned' then 'assigned'::lead_status
      else l.status
    end
  where l.id = target_lead;

  return null;
end $fn$;

drop trigger if exists trg_sync_lead_assignment on lead_assignments;
create trigger trg_sync_lead_assignment
  after insert or update or delete on lead_assignments
  for each row execute function sync_lead_assignment();

-- =============================================================================
-- TRIGGER: roll the latest visit's values up onto the lead row.
-- The lead row is a fast summary; lead_visits remains the full record.
-- A NULL in a newer visit does NOT erase a value captured in an older one.
-- =============================================================================
create or replace function sync_lead_from_visits()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target_lead uuid;
  v           record;
  n_visits    integer;
begin
  target_lead := coalesce(new.lead_id, old.lead_id);

  select count(*) into n_visits from lead_visits where lead_id = target_lead;

  select
    (array_remove(array_agg(lv.competitor_name order by lv.created_at desc), null))[1] as competitor_name,
    (array_remove(array_agg(lv.current_vendor  order by lv.created_at desc), null))[1] as current_vendor,
    (array_remove(array_agg(lv.poc_name        order by lv.created_at desc), null))[1] as poc_name,
    (array_remove(array_agg(lv.poc_designation order by lv.created_at desc), null))[1] as poc_designation,
    (array_remove(array_agg(lv.poc_phone       order by lv.created_at desc), null))[1] as poc_phone,
    (array_remove(array_agg(lv.total_units     order by lv.created_at desc), null))[1] as total_units,
    (array_remove(array_agg(lv.follow_up_date  order by lv.created_at desc), null))[1] as follow_up_date,
    (array_remove(array_agg(lv.remarks         order by lv.created_at desc), null))[1] as last_remark,
    (array_remove(array_agg(lv.status_after    order by lv.created_at desc), null))[1] as status_after,
    max(lv.created_at) as last_visit_at
  into v
  from lead_visits lv where lv.lead_id = target_lead;

  update leads l set
    visit_count      = n_visits,
    competitor_name  = v.competitor_name,
    current_vendor   = v.current_vendor,
    poc_name         = v.poc_name,
    poc_designation  = v.poc_designation,
    poc_phone        = v.poc_phone,
    follow_up_date   = v.follow_up_date,
    last_remark      = v.last_remark,
    last_visit_at    = v.last_visit_at,
    -- A BDM standing at the gate beats a number typed into a spreadsheet.
    total_units      = coalesce(v.total_units, l.total_units),
    units_source     = case when v.total_units is not null then 'bdm_visit' else l.units_source end,
    units_confidence = case when v.total_units is not null then 'high'::data_confidence else l.units_confidence end,
    units_updated_at = case when v.total_units is not null then now() else l.units_updated_at end,
    status = case
      when v.status_after is not null then v.status_after
      when n_visits > 0 and l.status in ('unassigned','assigned') then 'visited'::lead_status
      when n_visits = 0 and l.current_bdm_id is not null then 'assigned'::lead_status
      when n_visits = 0 then 'unassigned'::lead_status
      else l.status
    end
  where l.id = target_lead;

  return null;
end $fn$;

drop trigger if exists trg_sync_lead_from_visits on lead_visits;
create trigger trg_sync_lead_from_visits
  after insert or update or delete on lead_visits
  for each row execute function sync_lead_from_visits();

-- =============================================================================
-- GUARD: a BDM may only log a visit for a lead currently assigned to them.
-- Enforced in the database, not just the UI.
-- =============================================================================
create or replace function enforce_visit_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (
    select 1 from lead_assignments
    where lead_id = new.lead_id and bdm_id = new.bdm_id and status = 'active'
  ) then
    raise exception 'NOT_ASSIGNED: this lead is not currently assigned to that BDM'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_enforce_visit_assignment on lead_visits;
create trigger trg_enforce_visit_assignment
  before insert on lead_visits
  for each row execute function enforce_visit_assignment();
