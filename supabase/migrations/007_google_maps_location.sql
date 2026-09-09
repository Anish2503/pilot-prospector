-- =============================================================================
-- Pilot Prospector - Migration 007: Google Maps links as a location source
--
-- WHY
-- Uploaded spreadsheets carry a Google Maps link per society, and that link is
-- the best location signal available - better than geocoding a society name.
-- The importer had no concept of such a column, so those links were dropped and
-- the rows arrived with no coordinates.
--
-- WHAT CHANGES
--  1. location_source gains two new values. It was a Postgres ENUM, which is
--     awkward to extend safely (ALTER TYPE ... ADD VALUE has transaction rules
--     that vary by version). It becomes a text column with a CHECK constraint
--     instead: same values, same validation, but trivially extensible next time.
--  2. Two new columns keep the link itself, so an admin reviewing a lead can
--     open exactly what the spreadsheet pointed at.
--
-- Existing rows keep their values untouched - 'uploaded', 'geocoded', 'manual'
-- and 'unknown' all remain valid.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. location_source: enum -> text + CHECK
-- -----------------------------------------------------------------------------
alter table leads alter column location_source drop default;

alter table leads
  alter column location_source type text
  using location_source::text;

alter table leads alter column location_source set default 'unknown';
alter table leads alter column location_source set not null;

alter table leads drop constraint if exists leads_location_source_check;
alter table leads add constraint leads_location_source_check check (
  location_source in (
    'uploaded',              -- latitude/longitude columns in the spreadsheet
    'google_maps_url',       -- read straight out of the Maps link
    'google_maps_redirect',  -- read after following a shortened Maps link
    'geocoded',              -- looked up from the address
    'manual',                -- typed or confirmed by an admin
    'unknown'                -- nothing reliable yet
  )
);

-- -----------------------------------------------------------------------------
-- 2. Keep the link itself
-- -----------------------------------------------------------------------------
alter table leads add column if not exists google_maps_url text;
alter table leads add column if not exists resolved_maps_url text;

comment on column leads.google_maps_url is
  'The Google Maps link exactly as it appeared in the uploaded file. Kept so an admin reviewing a lead can open what the spreadsheet actually pointed at.';
comment on column leads.resolved_maps_url is
  'Where a shortened link ended up after its redirects were followed.';

-- Finding the leads whose link never produced coordinates.
create index if not exists leads_maps_url_unresolved_idx
  on leads (id)
  where google_maps_url is not null and latitude is null;

-- -----------------------------------------------------------------------------
-- 3. Location quality, for the dashboard and the import summary
-- -----------------------------------------------------------------------------
create or replace function location_quality()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return (
    select jsonb_build_object(
      'total',            count(*),
      'located',          count(*) filter (where latitude is not null),
      'missing',          count(*) filter (where latitude is null),
      'from_upload',      count(*) filter (where location_source = 'uploaded'),
      'from_maps_url',    count(*) filter (where location_source = 'google_maps_url'),
      'from_maps_redirect', count(*) filter (where location_source = 'google_maps_redirect'),
      'from_geocoding',   count(*) filter (where location_source = 'geocoded'),
      'manual',           count(*) filter (where location_source = 'manual'),
      'needs_review',     count(*) filter (where needs_review),
      'with_maps_link',   count(*) filter (where google_maps_url is not null),
      'link_unresolved',  count(*) filter (where google_maps_url is not null and latitude is null)
    )
    from leads
  );
end $fn$;

grant execute on function location_quality() to authenticated;
