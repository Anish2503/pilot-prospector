/**
 * Shared types. These mirror the database tables in supabase/migrations exactly.
 * If you change a column there, change it here too and TypeScript will point
 * out every place in the app that needs updating.
 */

export type LeadStatus =
  | 'unassigned'
  | 'assigned'
  | 'visited'
  | 'follow_up'
  | 'completed';

export type LocationSource = 'uploaded' | 'geocoded' | 'manual' | 'unknown';
export type DataConfidence = 'high' | 'medium' | 'low' | 'unverified';
export type AssignmentStatus = 'active' | 'reassigned' | 'revoked';
export type ActorType = 'admin' | 'bdm' | 'system';
export type ImportStatus =
  | 'uploaded'
  | 'previewing'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AppRole = 'super_admin' | 'bdm';

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------

/** What the app knows about whoever is currently signed in. */
export interface Session {
  token: string;
  role: AppRole;
  id: string;
  name: string;
  username?: string;
  /** Unix seconds. */
  expiresAt: number;
}

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

export interface Admin {
  id: string;
  name: string;
  username: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bdm {
  id: string;
  name: string;
  phone: string | null;
  employee_code: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The minimal, non-sensitive shape used to populate the login dropdown. */
export interface BdmOption {
  id: string;
  name: string;
}

// -----------------------------------------------------------------------------
// Leads
// -----------------------------------------------------------------------------

export interface Lead {
  id: string;

  society_name: string;
  normalized_name: string;

  total_units: number | null;
  units_source: string;
  units_confidence: DataConfidence;
  units_updated_at: string | null;

  latitude: number | null;
  longitude: number | null;
  location_source: LocationSource;
  location_confidence: DataConfidence;
  geocoded_at: string | null;
  geocode_query: string | null;
  geocode_display_name: string | null;

  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;

  source: string | null;
  source_file: string | null;
  source_row: number | null;
  import_job_id: string | null;

  status: LeadStatus;
  current_bdm_id: string | null;
  assigned_at: string | null;

  competitor_name: string | null;
  current_vendor: string | null;
  poc_name: string | null;
  poc_designation: string | null;
  poc_phone: string | null;
  follow_up_date: string | null;
  last_visit_at: string | null;
  last_remark: string | null;
  visit_count: number;

  needs_review: boolean;
  review_reason: string | null;

  created_at: string;
  updated_at: string;
}

/** A lead row joined with its owning BDM's name, as the admin table shows it. */
export interface LeadWithBdm extends Lead {
  current_bdm: { id: string; name: string } | null;
}

/** A lead as the BDM sees it, with the computed distance from their phone. */
export interface LeadWithDistance extends Lead {
  /** Straight-line metres from the BDM's current position; null if unknown. */
  distanceMeters: number | null;
}

// -----------------------------------------------------------------------------
// Assignments & visits
// -----------------------------------------------------------------------------

export interface LeadAssignment {
  id: string;
  lead_id: string;
  bdm_id: string;
  assigned_by: string | null;
  assigned_at: string;
  unassigned_at: string | null;
  unassigned_by: string | null;
  status: AssignmentStatus;
  note: string | null;
}

export interface LeadVisit {
  id: string;
  lead_id: string;
  bdm_id: string;
  assignment_id: string | null;
  visit_date: string;
  total_units: number | null;
  competitor_name: string | null;
  current_vendor: string | null;
  remarks: string | null;
  poc_name: string | null;
  poc_designation: string | null;
  poc_phone: string | null;
  status_after: LeadStatus | null;
  follow_up_date: string | null;
  latitude_at_visit: number | null;
  longitude_at_visit: number | null;
  distance_from_society_m: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadVisitWithBdm extends LeadVisit {
  bdms: { id: string; name: string } | null;
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

export interface ImportJob {
  id: string;
  filename: string;
  uploaded_by: string | null;
  status: ImportStatus;
  total_rows: number;
  successful_rows: number;
  failed_rows: number;
  duplicate_rows: number;
  updated_rows: number;
  column_mapping: Record<string, string> | null;
  error_summary: ImportIssue[] | null;
  created_at: string;
  completed_at: string | null;
}

export interface ImportIssue {
  row: number;
  field?: string;
  message: string;
  value?: string;
}

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------

export interface ActivityLog {
  id: string;
  actor_type: ActorType;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  lead_id: string | null;
  bdm_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// -----------------------------------------------------------------------------
// Analytics payloads (returned by the database functions in migration 003)
// -----------------------------------------------------------------------------

export interface AdminDashboardStats {
  total_leads: number;
  assigned_leads: number;
  unassigned_leads: number;
  visited_leads: number;
  pending_leads: number;
  follow_up_leads: number;
  completed_leads: number;
  total_units: number;
  leads_with_units: number;
  leads_with_poc: number;
  leads_with_competitor: number;
  leads_with_location: number;
  leads_need_review: number;
  geocoded_leads: number;
  total_bdms: number;
  active_bdms: number;
  total_admins: number;
  active_admins: number;
  visits_total: number;
  visits_today: number;
  visits_7d: number;
}

export interface BdmPerformance {
  bdm_id: string;
  bdm_name: string;
  active: boolean;
  assigned_leads: number;
  visited_leads: number;
  pending_leads: number;
  follow_up_leads: number;
  completed_leads: number;
  total_units: number;
  pocs_collected: number;
  poc_designations: number;
  competitors_identified: number;
  total_visits: number;
  last_activity: string | null;
}

export interface BdmStats {
  assigned_leads: number;
  visited_leads: number;
  pending_leads: number;
  follow_up_leads: number;
  completed_leads: number;
  total_units: number;
  pocs_collected: number;
  visits_today: number;
  visits_7d: number;
}

export interface BreakdownRow {
  label: string;
  lead_count: number;
  unit_total: number;
}

export interface VisitActivityRow {
  day: string;
  visits: number;
  bdms_active: number;
}

export interface LeadFilterOptions {
  cities: string[];
  areas: string[];
  competitors: string[];
}

// -----------------------------------------------------------------------------
// Geolocation
// -----------------------------------------------------------------------------

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export type GeolocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted'; position: Coordinates; capturedAt: number }
  | { status: 'denied' }
  | { status: 'unavailable'; message: string };
