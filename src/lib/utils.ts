/** Small shared helpers used across the app. */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Coordinates, LeadStatus } from '@/types';

/** Combines Tailwind classes, with later ones correctly overriding earlier. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// -----------------------------------------------------------------------------
// DISTANCE
// -----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

/**
 * Straight-line ("as the crow flies") distance in metres between two points,
 * using the Haversine formula.
 *
 * IMPORTANT: this is NOT driving distance. A society 800 m away across a lake
 * may be a 6 km drive. The UI always labels this as straight-line distance so
 * nobody plans their day on a wrong assumption.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "18 min" / "1 hr 5 min" - the driving time beside a road distance. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "850 m away" / "1.2 km away" / "14 km away" */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return 'Distance unknown';
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m away`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km away`;
  return `${Math.round(meters / 1000)} km away`;
}

/** Same numbers without the word "away", for pairing with a duration. */
export function formatDistanceShort(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

// -----------------------------------------------------------------------------
// FORMATTING
// -----------------------------------------------------------------------------

/** Indian digit grouping: 1,20,000 rather than 120,000. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatPercent(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "just now" / "3 hours ago" / "12 Mar 2026" */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (seconds < 604_800) {
    const d = Math.floor(seconds / 86_400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return formatDate(iso);
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// -----------------------------------------------------------------------------
// STATUS PRESENTATION
// -----------------------------------------------------------------------------

export const STATUS_LABELS: Record<LeadStatus, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  visited: 'Visited',
  follow_up: 'Follow-up',
  completed: 'Completed',
};

export const STATUS_CLASSES: Record<LeadStatus, string> = {
  unassigned: 'bg-slate-100 text-slate-700 ring-slate-200',
  assigned: 'bg-blue-50 text-blue-700 ring-blue-200',
  visited: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  follow_up: 'bg-amber-50 text-amber-800 ring-amber-200',
  completed: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export const ALL_STATUSES: LeadStatus[] = [
  'unassigned',
  'assigned',
  'visited',
  'follow_up',
  'completed',
];

// -----------------------------------------------------------------------------
// MISC
// -----------------------------------------------------------------------------

/** Waits until the user stops typing before running an expensive search. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs = 300,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

/** Escapes the wildcard characters PostgREST treats specially in ilike. */
export function escapeLike(value: string): string {
  return value.replace(/[%_,()]/g, (c) => `\\${c}`);
}

export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

/** Formats an Indian mobile number for display without altering stored data. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '-';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
