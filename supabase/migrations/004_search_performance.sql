-- =============================================================================
-- Pilot Prospector - Migration 004: faster search at scale
--
-- WHY THIS EXISTS
-- A load test with 10,000 leads showed the admin search box taking about one
-- second. The cause: it searched seven columns with a separate "contains"
-- condition on each, and only one of those columns had an index, so PostgreSQL
-- read every row for the other six.
--
-- THE FIX
-- One extra column holding all seven values joined together, kept up to date by
-- PostgreSQL itself, with a single trigram index over it. The search box now
-- asks one indexed question instead of seven unindexed ones.
--
-- COST: a little disk, and a fractionally slower write. Worth it many times
-- over for a table that is read constantly and written to rarely.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- =============================================================================

alter table leads
  add column if not exists search_text text
  generated always as (
    lower(
      coalesce(society_name, '') || ' ' ||
      coalesce(area, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(poc_name, '') || ' ' ||
      coalesce(poc_phone, '') || ' ' ||
      coalesce(competitor_name, '')
    )
  ) stored;

create index if not exists leads_search_trgm_idx
  on leads using gin (search_text gin_trgm_ops);

-- Supporting indexes for the filters that turned out to be common.
create index if not exists leads_unassigned_idx
  on leads (city, society_name) where current_bdm_id is null;

create index if not exists leads_competitor_idx
  on leads (competitor_name) where competitor_name is not null;

create index if not exists leads_poc_idx
  on leads (poc_phone) where poc_phone is not null;

-- Sorting by name is the default view, so give it a dedicated index that
-- matches the exact ordering the app asks for (name, then id as tie-breaker).
create index if not exists leads_name_id_idx on leads (society_name, id);

-- Tell the planner about the new column straight away rather than waiting for
-- the next automatic analyse.
analyze leads;
