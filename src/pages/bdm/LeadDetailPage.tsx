import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock, StatusBadge } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { useGeolocation } from '@/hooks/useGeolocation';
import {
  ALL_STATUSES,
  formatDate,
  formatDateTime,
  formatDistance,
  formatNumber,
  formatPhone,
  haversineMeters,
  isValidPhone,
  STATUS_LABELS,
} from '@/lib/utils';
import type { Lead, LeadStatus, LeadVisit } from '@/types';

interface DraftForm {
  totalUnits: string;
  competitorName: string;
  currentVendor: string;
  remarks: string;
  pocName: string;
  pocDesignation: string;
  pocPhone: string;
  status: LeadStatus | '';
  followUpDate: string;
}

const EMPTY_FORM: DraftForm = {
  totalUnits: '',
  competitorName: '',
  currentVendor: '',
  remarks: '',
  pocName: '',
  pocDesignation: '',
  pocPhone: '',
  status: '',
  followUpDate: '',
};

const DESIGNATIONS = [
  'Association President',
  'Association Secretary',
  'Treasurer',
  'Committee Member',
  'Facility Manager',
  'Estate Manager',
  'Security Head',
  'Builder / Developer',
  'Resident',
  'Other',
];

const draftKey = (leadId: string) => `pp.visitDraft.${leadId}`;

export default function BdmLeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { session } = useAuth();
  const { position, request, state } = useGeolocation();

  const [lead, setLead] = useState<Lead | null>(null);
  const [visits, setVisits] = useState<LeadVisit[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const submitted = useRef(false);

  // ---------------------------------------------------------------- Loading

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoadError(null);

    const [leadResult, visitResult] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
      supabase
        .from('lead_visits')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
    ]);

    if (leadResult.error) {
      setLoadError(friendlyError(leadResult.error, 'Could not open this society.'));
      return;
    }
    if (!leadResult.data) {
      // Either it was deleted, or it is no longer assigned to this BDM - the
      // database simply returns nothing in both cases.
      setLoadError(
        'This society is no longer in your list. It may have been reassigned. Go back and refresh.',
      );
      return;
    }

    setLead(leadResult.data as Lead);
    setVisits((visitResult.data ?? []) as LeadVisit[]);
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Restore an unsent draft, so a dropped connection loses nothing.
  useEffect(() => {
    if (!leadId) return;
    try {
      const raw = localStorage.getItem(draftKey(leadId));
      if (raw) {
        setForm({ ...EMPTY_FORM, ...(JSON.parse(raw) as DraftForm) });
        setHasDraft(true);
      }
    } catch {
      /* ignore */
    }
  }, [leadId]);

  // ---- Keep saving the draft as they type.
  useEffect(() => {
    if (!leadId || submitted.current) return;

    const isEmpty = Object.values(form).every((value) => value === '');
    try {
      if (isEmpty) localStorage.removeItem(draftKey(leadId));
      else localStorage.setItem(draftKey(leadId), JSON.stringify(form));
    } catch {
      /* ignore */
    }
  }, [form, leadId]);

  const distance = useMemo(() => {
    if (!lead || !position || lead.latitude === null || lead.longitude === null) return null;
    return haversineMeters(position, { latitude: lead.latitude, longitude: lead.longitude });
  }, [lead, position]);

  // ----------------------------------------------------------------- Saving

  function update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  async function submit() {
    if (!lead || !session) return;

    // Something must actually have been entered.
    const meaningful =
      form.remarks.trim() ||
      form.totalUnits.trim() ||
      form.competitorName.trim() ||
      form.pocName.trim() ||
      form.pocPhone.trim() ||
      form.status ||
      form.followUpDate;

    if (!meaningful) {
      setFormError('Please fill in at least one thing before saving.');
      return;
    }

    let units: number | null = null;
    if (form.totalUnits.trim()) {
      const parsed = Number(form.totalUnits);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
        setFormError('Please enter a sensible number of units.');
        return;
      }
      units = Math.round(parsed);
    }

    if (form.pocPhone.trim() && !isValidPhone(form.pocPhone)) {
      setFormError('That phone number does not look right. Use 10 digits.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const { error } = await supabase.from('lead_visits').insert({
      lead_id: lead.id,
      bdm_id: session.id,
      visit_date: new Date().toISOString().slice(0, 10),
      total_units: units,
      competitor_name: form.competitorName.trim() || null,
      current_vendor: form.currentVendor.trim() || null,
      remarks: form.remarks.trim() || null,
      poc_name: form.pocName.trim() || null,
      poc_designation: form.pocDesignation.trim() || null,
      poc_phone: form.pocPhone.trim() || null,
      status_after: form.status || null,
      follow_up_date: form.followUpDate || null,
      latitude_at_visit: position?.latitude ?? null,
      longitude_at_visit: position?.longitude ?? null,
      distance_from_society_m: distance,
    });

    setSaving(false);

    if (error) {
      setFormError(friendlyError(error, 'Could not save your update. Your notes are still here.'));
      return;
    }

    // Only now is it safe to throw the draft away.
    submitted.current = true;
    try {
      localStorage.removeItem(draftKey(lead.id));
    } catch {
      /* ignore */
    }

    toast.success('Update saved.');
    setForm(EMPTY_FORM);
    setHasDraft(false);
    submitted.current = false;
    await load();
  }

  function discardDraft() {
    if (!leadId) return;
    try {
      localStorage.removeItem(draftKey(leadId));
    } catch {
      /* ignore */
    }
    setForm(EMPTY_FORM);
    setHasDraft(false);
  }

  // ----------------------------------------------------------------- Render

  if (loadError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert tone="error" title="Cannot open this society">
          {loadError}
        </Alert>
        <Button variant="secondary" fullWidth onClick={() => navigate('/bdm')}>
          Back to my leads
        </Button>
      </div>
    );
  }

  if (!lead) return <LoadingBlock label="Loading…" />;

  const mapsUrl =
    lead.latitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [lead.society_name, lead.area, lead.city].filter(Boolean).join(' '),
        )}`;

  return (
    <div className="space-y-4 pb-6">
      <BackLink />

      {/* ------------------------------------------------------------ Header */}
      <div className="card p-4">
        <h1 className="text-lg font-semibold text-slate-900">{lead.society_name}</h1>

        <p className="mt-1 text-sm text-slate-500">
          {[lead.address, lead.area, lead.city].filter(Boolean).join(', ') ||
            (lead.latitude !== null
              ? 'Located on the map - no street address recorded'
              : 'No address recorded')}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={lead.status} />
          {lead.total_units !== null ? (
            <Badge tone="slate">{formatNumber(lead.total_units)} units</Badge>
          ) : (
            <Badge tone="amber">Units not confirmed</Badge>
          )}
          {distance !== null && (
            <Badge tone="brand">
              <MapPin className="mr-1 size-3" />
              {formatDistance(distance)}
            </Badge>
          )}
        </div>

        {distance === null && lead.latitude !== null && state.status !== 'granted' && (
          <button
            onClick={() => request()}
            className="mt-2 text-sm font-medium text-brand-700 underline underline-offset-2"
          >
            Turn on location to see how far away this is
          </button>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" fullWidth icon={<Navigation className="size-4" />}>
              Directions
            </Button>
          </a>
          {lead.poc_phone ? (
            <a href={`tel:${lead.poc_phone}`}>
              <Button variant="secondary" fullWidth icon={<Phone className="size-4" />}>
                Call POC
              </Button>
            </a>
          ) : (
            <Button variant="secondary" fullWidth disabled icon={<Phone className="size-4" />}>
              No POC yet
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------- Known information */}
      {(lead.poc_name || lead.competitor_name) && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-700">What we know so far</h2>

          {lead.poc_name && (
            <div>
              <p className="text-xs text-slate-500">Point of contact</p>
              <p className="text-sm font-medium text-slate-900">
                {lead.poc_name}
                {lead.poc_designation && (
                  <span className="font-normal text-slate-500"> — {lead.poc_designation}</span>
                )}
              </p>
              {lead.poc_phone && (
                <p className="text-sm text-slate-600">{formatPhone(lead.poc_phone)}</p>
              )}
            </div>
          )}

          {lead.competitor_name && (
            <div>
              <p className="text-xs text-slate-500">Competitor</p>
              <p className="text-sm font-medium text-slate-900">{lead.competitor_name}</p>
            </div>
          )}

          {lead.follow_up_date && (
            <div>
              <p className="text-xs text-slate-500">Follow-up due</p>
              <p className="text-sm font-medium text-slate-900">{formatDate(lead.follow_up_date)}</p>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- Visit form */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-700">Add an update</h2>
        <p className="mt-0.5 mb-4 text-sm text-slate-500">
          Fill in whatever you learned. Previous updates are never overwritten.
        </p>

        {hasDraft && (
          <Alert
            tone="info"
            className="mb-4"
            action={
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={discardDraft}>
                Discard
              </Button>
            }
          >
            We kept what you typed last time but did not send.
          </Alert>
        )}

        {formError && (
          <Alert tone="error" className="mb-4">
            {formError}
          </Alert>
        )}

        <div className="space-y-4">
          <Textarea
            label="Remarks / notes"
            value={form.remarks}
            onChange={(e) => update('remarks', e.target.value)}
            placeholder="e.g. Spoke to the security manager. Asked to contact the association president next week."
            rows={3}
            disabled={saving}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Total units"
              value={form.totalUnits}
              onChange={(e) => update('totalUnits', e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder={lead.total_units?.toString() ?? 'e.g. 420'}
              hint={lead.total_units !== null ? 'Only fill in if different' : 'Not known yet'}
              disabled={saving}
            />
            <Input
              label="Competitor"
              value={form.competitorName}
              onChange={(e) => update('competitorName', e.target.value)}
              placeholder="e.g. NoBrokerHood"
              disabled={saving}
            />
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <h3 className="mb-3 text-sm font-medium text-slate-700">Point of contact</h3>
            <div className="space-y-3">
              <Input
                label="Name"
                value={form.pocName}
                onChange={(e) => update('pocName', e.target.value)}
                placeholder="e.g. Ramesh Kumar"
                disabled={saving}
              />
              <Select
                label="Designation"
                value={form.pocDesignation}
                onChange={(e) => update('pocDesignation', e.target.value)}
                placeholder="Select a role"
                options={DESIGNATIONS.map((d) => ({ value: d, label: d }))}
                disabled={saving}
              />
              <Input
                label="Phone number"
                value={form.pocPhone}
                onChange={(e) => update('pocPhone', e.target.value)}
                inputMode="tel"
                placeholder="98765 43210"
                disabled={saving}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Set status"
              value={form.status}
              onChange={(e) => update('status', e.target.value as LeadStatus)}
              placeholder="Leave unchanged"
              options={ALL_STATUSES.filter((s) => s !== 'unassigned').map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
              }))}
              disabled={saving}
            />
            <Input
              label="Follow-up date"
              type="date"
              value={form.followUpDate}
              onChange={(e) => update('followUpDate', e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              disabled={saving}
            />
          </div>

          <Button
            size="lg"
            fullWidth
            onClick={submit}
            loading={saving}
            icon={<Save className="size-4" />}
          >
            Save update
          </Button>

          {position && (
            <p className="text-center text-xs text-slate-400">
              Your location is recorded with this update so your admin can see you were on site.
            </p>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- History */}
      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <MessageSquare className="size-4" />
          Previous updates {visits ? `(${visits.length})` : ''}
        </h2>

        {visits === null ? (
          <LoadingBlock />
        ) : visits.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No updates yet"
            description="Your first update for this society will appear here."
            className="py-8"
          />
        ) : (
          <ol className="space-y-4">
            {visits.map((visit) => (
              <li key={visit.id} className="border-l-2 border-brand-200 pl-3">
                <p className="text-xs text-slate-400">{formatDateTime(visit.created_at)}</p>

                {visit.remarks && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{visit.remarks}</p>
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
                    visit.distance_from_society_m < 300 && (
                      <Badge tone="emerald">
                        <CheckCircle2 className="mr-1 size-3" />
                        On site
                      </Badge>
                    )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/bdm"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
    >
      <ArrowLeft className="size-4" />
      My leads
    </Link>
  );
}
