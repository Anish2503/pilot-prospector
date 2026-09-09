import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ExternalLink,
  History,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Save,
  Swords,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { DeleteLeadDialog, PullLeadDialog } from '@/components/LeadActions';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Alert, Badge, ConfidenceTag, LoadingBlock, StatusBadge } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatDate, formatDateTime, formatNumber, formatPhone } from '@/lib/utils';
import type { Bdm, Lead, LeadAssignment, LeadVisit, LeadWithBdm } from '@/types';

interface AssignmentRow extends LeadAssignment {
  bdms: { name: string } | null;
}
interface VisitRow extends LeadVisit {
  bdms: { name: string } | null;
}

export function LeadDetailDialog({
  lead,
  bdms,
  onClose,
  onChanged,
}: {
  lead: LeadWithBdm | Lead | null;
  bdms: Bdm[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const leadId = lead?.id;

  const loadHistory = useCallback(async () => {
    if (!leadId) return;
    const [visitResult, assignmentResult] = await Promise.all([
      supabase
        .from('lead_visits')
        .select('*, bdms(name)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('lead_assignments')
        .select('*, bdms(name)')
        .eq('lead_id', leadId)
        .order('assigned_at', { ascending: false }),
    ]);
    setVisits((visitResult.data ?? []) as VisitRow[]);
    setAssignments((assignmentResult.data ?? []) as AssignmentRow[]);
  }, [leadId]);

  useEffect(() => {
    if (!leadId) {
      setVisits(null);
      setAssignments(null);
      setEditing(false);
      setAssigning(false);
      return;
    }
    void loadHistory();
  }, [leadId, loadHistory]);

  if (!lead) return null;

  const currentBdmName =
    'current_bdm' in lead && lead.current_bdm ? lead.current_bdm.name : null;

  return (
    <>
      <Dialog
        open={Boolean(lead)}
        onClose={onClose}
        title={lead.society_name}
        description={[lead.area, lead.city].filter(Boolean).join(', ') || undefined}
        size="lg"
      >
        <div className="space-y-6">
          {/* ------------------------------------------------------- Summary */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lead.status} />
            {lead.needs_review && <Badge tone="red">Needs review</Badge>}
            {currentBdmName ? (
              <Badge tone="brand">Assigned to {currentBdmName}</Badge>
            ) : (
              <Badge tone="slate">Unassigned</Badge>
            )}
            <span className="text-xs text-slate-400">
              {lead.visit_count} visit{lead.visit_count === 1 ? '' : 's'}
            </span>
          </div>

          {lead.review_reason && <Alert tone="warning">{lead.review_reason}</Alert>}

          {/* --------------------------------------------------- Assignment */}
          <section>
            <SectionTitle icon={<UserPlus className="size-4" />}>Assignment</SectionTitle>

            {assigning ? (
              <AssignInline
                leadId={lead.id}
                bdms={bdms.filter((b) => b.active)}
                currentBdmName={currentBdmName}
                onCancel={() => setAssigning(false)}
                onDone={() => {
                  setAssigning(false);
                  onChanged();
                  void loadHistory();
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAssigning(true)}>
                  {currentBdmName ? 'Reassign' : 'Assign to a BDM'}
                </Button>
                {currentBdmName && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<UserMinus className="size-4" />}
                    onClick={() => setConfirmPull(true)}
                  >
                    Pull from BDM
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* ------------------------------------------------------- Details */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle icon={<Building2 className="size-4" />} className="mb-0">
                Society details
              </SectionTitle>
              {!editing && (
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>

            {editing ? (
              <EditLeadForm
                lead={lead}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  onChanged();
                }}
              />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Total units">
                  {lead.total_units === null ? (
                    <span className="text-amber-600">Needs verification</span>
                  ) : (
                    formatNumber(lead.total_units)
                  )}
                  <div className="mt-1">
                    <ConfidenceTag source={lead.units_source} confidence={lead.units_confidence} />
                  </div>
                </Detail>

                <Detail label="Location">
                  {lead.latitude === null ? (
                    <span className="text-amber-600">Not known yet</span>
                  ) : (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${lead.latitude}&mlon=${lead.longitude}#map=17/${lead.latitude}/${lead.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline underline-offset-2"
                    >
                      {lead.latitude.toFixed(5)}, {lead.longitude!.toFixed(5)}
                    </a>
                  )}
                  <div className="mt-1">
                    <ConfidenceTag
                      source={lead.location_source}
                      confidence={lead.location_confidence}
                    />
                  </div>
                </Detail>

                <Detail label="Google Maps link">
                  {lead.google_maps_url ? (
                    <a
                      href={lead.resolved_maps_url ?? lead.google_maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 underline underline-offset-2"
                    >
                      Open Google Maps
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <span className="text-slate-400">Not supplied</span>
                  )}
                </Detail>

                <Detail label="Address">{lead.address ?? '—'}</Detail>
                <Detail label="Area">{lead.area ?? '—'}</Detail>
                <Detail label="City">{lead.city ?? '—'}</Detail>
                <Detail label="Pincode">{lead.pincode ?? '—'}</Detail>
              </dl>
            )}
          </section>

          {/* ----------------------------------------------------- POC + rival */}
          {(lead.poc_name || lead.poc_phone || lead.competitor_name) && (
            <section className="grid gap-4 sm:grid-cols-2">
              {(lead.poc_name || lead.poc_phone) && (
                <div className="rounded-lg bg-emerald-50 p-3">
                  <SectionTitle icon={<Phone className="size-4" />}>Point of contact</SectionTitle>
                  <p className="font-medium text-slate-900">{lead.poc_name ?? 'Name not recorded'}</p>
                  {lead.poc_designation && (
                    <p className="text-sm text-slate-600">{lead.poc_designation}</p>
                  )}
                  {lead.poc_phone && (
                    <a
                      href={`tel:${lead.poc_phone}`}
                      className="mt-1 inline-block text-sm font-medium text-emerald-700 underline underline-offset-2"
                    >
                      {formatPhone(lead.poc_phone)}
                    </a>
                  )}
                </div>
              )}

              {lead.competitor_name && (
                <div className="rounded-lg bg-violet-50 p-3">
                  <SectionTitle icon={<Swords className="size-4" />}>Competitor</SectionTitle>
                  <p className="font-medium text-slate-900">{lead.competitor_name}</p>
                  {lead.current_vendor && (
                    <p className="text-sm text-slate-600">Current vendor: {lead.current_vendor}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* -------------------------------------------------- Visit history */}
          <section>
            <SectionTitle icon={<MessageSquare className="size-4" />}>
              Visit history {visits ? `(${visits.length})` : ''}
            </SectionTitle>

            {visits === null ? (
              <LoadingBlock label="Loading history…" />
            ) : visits.length === 0 ? (
              <p className="text-sm text-slate-500">No visits recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {visits.map((visit) => (
                  <li key={visit.id} className="border-l-2 border-slate-200 pl-4">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-medium text-slate-900">
                        {visit.bdms?.name ?? 'A BDM'}
                      </p>
                      <p className="text-xs text-slate-400">{formatDateTime(visit.created_at)}</p>
                    </div>

                    {visit.remarks && (
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        &ldquo;{visit.remarks}&rdquo;
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {visit.total_units !== null && (
                        <Badge tone="slate">{formatNumber(visit.total_units)} units</Badge>
                      )}
                      {visit.competitor_name && <Badge tone="violet">{visit.competitor_name}</Badge>}
                      {visit.poc_name && <Badge tone="emerald">POC: {visit.poc_name}</Badge>}
                      {visit.status_after && <StatusBadge status={visit.status_after} />}
                      {visit.follow_up_date && (
                        <Badge tone="amber">Follow up {formatDate(visit.follow_up_date)}</Badge>
                      )}
                      {visit.distance_from_society_m !== null &&
                        visit.distance_from_society_m < 500 && (
                          <Badge tone="emerald">
                            <MapPin className="mr-1 size-3" />
                            On site
                          </Badge>
                        )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* --------------------------------------------- Assignment history */}
          {assignments && assignments.length > 0 && (
            <section>
              <SectionTitle icon={<History className="size-4" />}>Assignment history</SectionTitle>
              <ol className="space-y-2 text-sm">
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-slate-800">
                      {assignment.bdms?.name ?? 'Unknown BDM'}
                    </span>
                    <span className="text-slate-500">
                      {formatDate(assignment.assigned_at)}
                      {assignment.unassigned_at && ` → ${formatDate(assignment.unassigned_at)}`}
                    </span>
                    {assignment.status === 'active' ? (
                      <Badge tone="emerald">Current</Badge>
                    ) : (
                      <Badge tone="slate">
                        {assignment.status === 'reassigned' ? 'Reassigned' : 'Removed'}
                      </Badge>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* -------------------------------------------------- Danger zone */}
          <section className="rounded-lg border border-red-200 bg-red-50/50 p-3">
            <h3 className="text-sm font-semibold text-red-900">Delete this lead</h3>
            <p className="mt-0.5 mb-3 text-sm leading-relaxed text-red-800/80">
              Removes {lead.society_name} from the app permanently — the leads list, the map,
              search, every BDM's sheet and all reports. A full copy is kept in the deletion
              archive for auditing, but it cannot be restored from the app.
            </p>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete lead
            </Button>
          </section>

          {/* ---------------------------------------------------- Provenance */}
          <section className="border-t border-slate-200 pt-4 text-xs text-slate-400">
            {lead.source_file && (
              <p>
                Imported from {lead.source_file}
                {lead.source_row ? `, row ${lead.source_row}` : ''}
              </p>
            )}
            <p>Added {formatDateTime(lead.created_at)}</p>
          </section>
        </div>
      </Dialog>

      <PullLeadDialog
        lead={
          confirmPull
            ? {
                id: lead.id,
                society_name: lead.society_name,
                visit_count: lead.visit_count,
                bdmName: currentBdmName,
              }
            : null
        }
        onClose={() => setConfirmPull(false)}
        onDone={() => {
          setConfirmPull(false);
          onChanged();
          void loadHistory();
        }}
      />

      <DeleteLeadDialog
        lead={
          confirmDelete
            ? {
                id: lead.id,
                society_name: lead.society_name,
                visit_count: lead.visit_count,
                bdmName: currentBdmName,
              }
            : null
        }
        onClose={() => setConfirmDelete(false)}
        onDone={() => {
          setConfirmDelete(false);
          onChanged();
          // The lead no longer exists, so this panel must not stay open on it.
          onClose();
        }}
      />
    </>
  );
}

// -----------------------------------------------------------------------------

function SectionTitle({
  icon,
  children,
  className = 'mb-2',
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={`flex items-center gap-1.5 text-sm font-semibold text-slate-700 ${className}`}>
      {icon}
      {children}
    </h3>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------

function AssignInline({
  leadId,
  bdms,
  currentBdmName,
  onCancel,
  onDone,
}: {
  leadId: string;
  bdms: Bdm[];
  currentBdmName: string | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [bdmId, setBdmId] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!bdmId) return;
    setSaving(true);
    const { error } = await supabase.rpc('assign_lead', {
      p_lead_id: leadId,
      p_bdm_id: bdmId,
      p_note: null,
    });
    setSaving(false);

    if (error) toast.error(friendlyError(error));
    else {
      toast.success(currentBdmName ? 'Lead reassigned.' : 'Lead assigned.');
      onDone();
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      {currentBdmName && (
        <Alert tone="warning">
          Currently assigned to <strong>{currentBdmName}</strong>. Reassigning keeps the full
          history of who had it and when.
        </Alert>
      )}
      <Select
        value={bdmId}
        onChange={(e) => setBdmId(e.target.value)}
        placeholder="Choose a BDM"
        options={bdms.map((b) => ({ value: b.id, label: b.name }))}
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} loading={saving} disabled={!bdmId}>
          Confirm
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} icon={<X className="size-4" />}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function EditLeadForm({
  lead,
  onCancel,
  onSaved,
}: {
  lead: Lead;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [units, setUnits] = useState(lead.total_units?.toString() ?? '');
  const [latitude, setLatitude] = useState(lead.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(lead.longitude?.toString() ?? '');
  const [address, setAddress] = useState(lead.address ?? '');
  const [area, setArea] = useState(lead.area ?? '');
  const [city, setCity] = useState(lead.city ?? '');
  const [pincode, setPincode] = useState(lead.pincode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);

    const patch: Record<string, unknown> = {
      address: address.trim() || null,
      area: area.trim() || null,
      city: city.trim() || null,
      pincode: pincode.trim() || null,
    };

    // Units
    if (units.trim() === '') {
      patch.total_units = null;
    } else {
      const parsed = Number(units);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
        setError('Please enter a sensible number of units, or leave it blank.');
        return;
      }
      if (parsed !== lead.total_units) {
        patch.total_units = Math.round(parsed);
        patch.units_source = 'manual';
        patch.units_confidence = 'high';
        patch.units_updated_at = new Date().toISOString();
      }
    }

    // Coordinates - both or neither.
    const hasLat = latitude.trim() !== '';
    const hasLng = longitude.trim() !== '';
    if (hasLat !== hasLng) {
      setError('Please enter both latitude and longitude, or clear both.');
      return;
    }
    if (hasLat) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
        setError('Those coordinates are not valid. Latitude is -90 to 90, longitude -180 to 180.');
        return;
      }
      if (lat !== lead.latitude || lng !== lead.longitude) {
        patch.latitude = lat;
        patch.longitude = lng;
        patch.location_source = 'manual';
        patch.location_confidence = 'high';
        patch.needs_review = false;
        patch.review_reason = null;
      }
    } else if (lead.latitude !== null) {
      patch.latitude = null;
      patch.longitude = null;
      patch.location_source = 'unknown';
      patch.location_confidence = 'unverified';
    }

    setSaving(true);
    const { error: updateError } = await supabase.from('leads').update(patch).eq('id', lead.id);

    if (!updateError) {
      await supabase.rpc('log_activity', {
        p_action: 'lead.edited',
        p_lead_id: lead.id,
        p_metadata: { fields: Object.keys(patch) },
      });
    }
    setSaving(false);

    if (updateError) setError(friendlyError(updateError, 'Could not save your changes.'));
    else {
      toast.success('Society details updated.');
      onSaved();
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Total units"
          value={units}
          onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          placeholder="Leave blank if unknown"
        />
        <Input label="Pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
        <Input label="Latitude" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="12.93910" />
        <Input label="Longitude" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="77.74110" />
        <Input label="Area" value={area} onChange={(e) => setArea(e.target.value)} />
        <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>

      <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />

      <div className="flex gap-2">
        <Button size="sm" icon={<Save className="size-4" />} onClick={save} loading={saving}>
          Save changes
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
