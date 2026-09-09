import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  MapPinOff,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Alert, Badge, Spinner } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { cn, formatNumber } from '@/lib/utils';
import {
  autoDetectMapping,
  buildIssueCsv,
  FIELD_LABELS,
  parseSpreadsheet,
  prepareRows,
  validateFile,
  type ColumnMapping,
  type LeadField,
  type ParsedSheet,
  type PreparedFile,
} from '@/lib/importer';

const BATCH_SIZE = 400;

type Step = 'choose' | 'map' | 'importing' | 'done';

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export default function UploadPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const cancelled = useRef(false);

  // The preview is recalculated whenever the mapping changes - instantly,
  // because the whole file is already in memory.
  const prepared: PreparedFile | null = useMemo(
    () => (parsed ? prepareRows(parsed, mapping) : null),
    [parsed, mapping],
  );

  // ---------------------------------------------------------------- Choose

  const handleFile = useCallback(async (chosen: File) => {
    setError(null);

    const problem = validateFile(chosen);
    if (problem) {
      setError(problem);
      return;
    }

    setParsing(true);
    try {
      const sheet = await parseSpreadsheet(chosen);
      setFile(chosen);
      setParsed(sheet);
      setMapping(autoDetectMapping(sheet.headers));
      setStep('map');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That file could not be read. Please check it opens correctly in Excel.',
      );
    } finally {
      setParsing(false);
    }
  }, []);

  async function changeSheet(sheetName: string) {
    if (!file) return;
    setParsing(true);
    try {
      const sheet = await parseSpreadsheet(file, sheetName);
      setParsed(sheet);
      setMapping(autoDetectMapping(sheet.headers));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that sheet.');
    } finally {
      setParsing(false);
    }
  }

  // ---------------------------------------------------------------- Import

  async function runImport() {
    if (!prepared || !parsed) return;

    const rows = prepared.validRows;
    if (rows.length === 0) {
      setError('There are no valid rows to import.');
      return;
    }

    cancelled.current = false;
    setStep('importing');
    setProgress({ done: 0, total: rows.length });
    setError(null);

    const totals: ImportResult = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
    let jobId: string | null = null;

    try {
      const started = await api.post<{ jobId: string }>('/import-leads', {
        action: 'start',
        filename: parsed.filename,
        totalRows: prepared.counts.total,
        columnMapping: mapping,
      });
      jobId = started.jobId;

      for (let index = 0; index < rows.length; index += BATCH_SIZE) {
        if (cancelled.current) {
          await api.post('/import-leads', { action: 'cancel', jobId });
          setStep('map');
          toast.info('Import cancelled. Rows already added were kept.');
          return;
        }

        const batch = rows.slice(index, index + BATCH_SIZE).map((row) => ({
          rowNumber: row.rowNumber,
          society_name: row.society_name,
          total_units: row.total_units,
          address: row.address,
          area: row.area,
          city: row.city,
          state: row.state,
          pincode: row.pincode,
          latitude: row.latitude,
          longitude: row.longitude,
          source: row.source,
        }));

        const batchResult = await api.post<ImportResult>('/import-leads', {
          action: 'batch',
          jobId,
          rows: batch,
          duplicateMode,
        });

        totals.inserted += batchResult.inserted;
        totals.updated += batchResult.updated;
        totals.skipped += batchResult.skipped;
        totals.failed += batchResult.failed;

        setProgress({ done: Math.min(index + BATCH_SIZE, rows.length), total: rows.length });
      }

      await api.post('/import-leads', { action: 'finish', jobId });

      setResult(totals);
      setStep('done');
      toast.success(`${formatNumber(totals.inserted)} leads imported.`);
    } catch (cause) {
      setError(friendlyError(cause, 'The import stopped partway through.'));
      setResult(totals);
      setStep('done');
      if (jobId) {
        await api.post('/import-leads', { action: 'finish', jobId }).catch(() => {});
      }
    }
  }

  function downloadIssues() {
    if (!prepared) return;
    const problems = [...prepared.errorRows, ...prepared.duplicateRows];
    const csv = buildIssueCsv(problems);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `import-issues-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setStep('choose');
    setFile(null);
    setParsed(null);
    setMapping({});
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
  }

  // ---------------------------------------------------------------- Render

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Upload leads
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Bring in societies from an Excel or CSV file. Nothing is saved until you confirm.
        </p>
      </div>

      <Steps current={step} />

      {error && (
        <Alert tone="error" title="There is a problem with this file">
          {error}
        </Alert>
      )}

      {step === 'choose' && (
        <ChooseFile onFile={handleFile} parsing={parsing} />
      )}

      {step === 'map' && parsed && prepared && (
        <MapAndPreview
          parsed={parsed}
          prepared={prepared}
          mapping={mapping}
          setMapping={setMapping}
          duplicateMode={duplicateMode}
          setDuplicateMode={setDuplicateMode}
          onChangeSheet={changeSheet}
          onBack={reset}
          onImport={runImport}
          onDownloadIssues={downloadIssues}
          parsing={parsing}
        />
      )}

      {step === 'importing' && (
        <ImportProgress
          progress={progress}
          onCancel={() => {
            cancelled.current = true;
          }}
        />
      )}

      {step === 'done' && result && (
        <ImportDone
          result={result}
          hadError={Boolean(error)}
          onUploadAnother={reset}
          onViewLeads={() => navigate('/admin/leads')}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function Steps({ current }: { current: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'choose', label: 'Choose file' },
    { key: 'map', label: 'Check columns' },
    { key: 'done', label: 'Import' },
  ];
  const activeIndex = current === 'importing' ? 2 : steps.findIndex((s) => s.key === current);

  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((step, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'todo';
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                state === 'done' && 'bg-emerald-600 text-white',
                state === 'current' && 'bg-brand-600 text-white',
                state === 'todo' && 'bg-slate-200 text-slate-500',
              )}
            >
              {state === 'done' ? <CheckCircle2 className="size-4" /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate font-medium',
                state === 'todo' ? 'text-slate-400' : 'text-slate-700',
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------

function ChooseFile({ onFile, parsing }: { onFile: (file: File) => void; parsing: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="card p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50',
        )}
      >
        {parsing ? (
          <>
            <Spinner className="size-8" />
            <p className="mt-3 text-sm font-medium text-slate-700">Reading your file...</p>
            <p className="mt-1 text-sm text-slate-500">Large files can take a few seconds.</p>
          </>
        ) : (
          <>
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
              <FileSpreadsheet className="size-7" />
            </div>
            <p className="text-base font-medium text-slate-900">
              Drop your spreadsheet here
            </p>
            <p className="mt-1 text-sm text-slate-500">Excel (.xlsx, .xls) or CSV, up to 15 MB</p>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) onFile(chosen);
                e.target.value = '';
              }}
            />
            <Button className="mt-5" icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
          </>
        )}
      </div>

      <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Your column names do not need to match anything.</p>
        <p className="mt-1 leading-relaxed">
          The app recognises common variations by itself — &ldquo;Society Name&rdquo;,
          &ldquo;Apartment Name&rdquo;, &ldquo;Property Name&rdquo; all work, as do
          &ldquo;Units&rdquo;, &ldquo;Total Units&rdquo; and &ldquo;No. of Flats&rdquo;. You will
          get a chance to correct anything it guesses wrong.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

const MAPPABLE_FIELDS: LeadField[] = [
  'society_name',
  'total_units',
  'address',
  'area',
  'city',
  'state',
  'pincode',
  'latitude',
  'longitude',
  'coordinates',
  'source',
];

function MapAndPreview({
  parsed,
  prepared,
  mapping,
  setMapping,
  duplicateMode,
  setDuplicateMode,
  onChangeSheet,
  onBack,
  onImport,
  onDownloadIssues,
  parsing,
}: {
  parsed: ParsedSheet;
  prepared: PreparedFile;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  duplicateMode: 'skip' | 'update';
  setDuplicateMode: (m: 'skip' | 'update') => void;
  onChangeSheet: (name: string) => void;
  onBack: () => void;
  onImport: () => void;
  onDownloadIssues: () => void;
  parsing: boolean;
}) {
  const { counts } = prepared;
  const hasName = Boolean(mapping.society_name);
  const problemRows = prepared.errorRows.length + prepared.duplicateRows.length;

  const columnOptions = parsed.headers.map((header) => ({ value: header, label: header }));

  return (
    <div className="space-y-5">
      {/* -------------------------------------------------------- File summary */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <FileSpreadsheet className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{parsed.filename}</p>
              <p className="text-sm text-slate-500">
                {formatNumber(counts.total)} rows · {parsed.headers.length} columns
              </p>
            </div>
          </div>

          {parsed.sheetNames.length > 1 && (
            <Select
              value={parsed.activeSheet}
              onChange={(e) => onChangeSheet(e.target.value)}
              options={parsed.sheetNames.map((name) => ({ value: name, label: name }))}
              containerClassName="w-48"
              aria-label="Sheet"
              disabled={parsing}
            />
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- Validation */}
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">What we found</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tally label="Rows detected" value={counts.total} tone="slate" />
          <Tally label="Ready to import" value={counts.valid} tone="emerald" />
          <Tally label="Duplicates in file" value={counts.duplicatesInFile} tone="amber" />
          <Tally label="Cannot import" value={counts.errors} tone={counts.errors ? 'red' : 'slate'} />
        </div>

        {counts.valid > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {counts.missingLocation > 0 && (
              <Badge tone="amber">
                <MapPinOff className="mr-1 size-3" />
                {formatNumber(counts.missingLocation)} without coordinates
              </Badge>
            )}
            {counts.missingUnits > 0 && (
              <Badge tone="amber">{formatNumber(counts.missingUnits)} without unit count</Badge>
            )}
            {counts.withWarnings > 0 && (
              <Badge tone="slate">{formatNumber(counts.withWarnings)} with minor warnings</Badge>
            )}
          </div>
        )}

        {problemRows > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            icon={<Download className="size-4" />}
            onClick={onDownloadIssues}
          >
            Download the {formatNumber(problemRows)} problem rows
          </Button>
        )}
      </div>

      {/* ------------------------------------------------------------- Mapping */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-700">Which column is which?</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          We have guessed these from your headings. Change anything that looks wrong.
        </p>

        {!hasName && (
          <Alert tone="error" className="mb-4">
            Choose which column holds the society name — nothing can be imported without it.
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {MAPPABLE_FIELDS.map((field) => {
            // Hide the combined column selector unless it is actually in use.
            if (field === 'coordinates' && !mapping.coordinates && mapping.latitude) return null;

            return (
              <Select
                key={field}
                label={FIELD_LABELS[field] + (field === 'society_name' ? ' *' : '')}
                value={mapping[field] ?? ''}
                placeholder="— not in this file —"
                options={columnOptions}
                onChange={(e) => {
                  const next = { ...mapping };
                  if (e.target.value) next[field] = e.target.value;
                  else delete next[field];
                  setMapping(next);
                }}
                error={field === 'society_name' && !hasName ? 'Required' : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------- Preview */}
      {prepared.validRows.length > 0 && (
        <div className="card overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
            Preview — first 5 rows as they will be saved
          </h2>
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Society</th>
                  <th className="px-4 py-2 font-medium">Units</th>
                  <th className="px-4 py-2 font-medium">Area</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {prepared.validRows.slice(0, 5).map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{row.society_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {row.total_units === null ? (
                        <span className="text-amber-600">Needs verification</span>
                      ) : (
                        formatNumber(row.total_units)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.area ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.city ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {row.latitude === null ? (
                        <span className="text-amber-600">Will need locating</span>
                      ) : (
                        `${row.latitude.toFixed(4)}, ${row.longitude!.toFixed(4)}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- Duplicates */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-700">
          If a society is already in the database
        </h2>
        <div className="mt-3 space-y-2">
          <RadioCard
            checked={duplicateMode === 'skip'}
            onChange={() => setDuplicateMode('skip')}
            icon={<Copy className="size-4" />}
            title="Skip it"
            description="Leave the existing record exactly as it is. Safest option."
          />
          <RadioCard
            checked={duplicateMode === 'update'}
            onChange={() => setDuplicateMode('update')}
            icon={<Upload className="size-4" />}
            title="Fill in missing details"
            description="Add address, area and city where they are blank. Never overwrites a unit count or location a BDM confirmed on site."
          />
        </div>
      </div>

      {/* --------------------------------------------------------------- Act */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Choose a different file
        </Button>
        <Button
          size="lg"
          onClick={onImport}
          disabled={!hasName || counts.valid === 0}
          icon={<Upload className="size-4" />}
        >
          Import {formatNumber(counts.valid)} leads
        </Button>
      </div>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'amber' | 'red';
}) {
  const tones = {
    slate: 'bg-slate-50 text-slate-900',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={cn('rounded-lg p-3', tones[tone])}>
      <p className="text-2xl font-semibold tabular-nums">{formatNumber(value)}</p>
      <p className="mt-0.5 text-xs opacity-80">{label}</p>
    </div>
  );
}

function RadioCard({
  checked,
  onChange,
  icon,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
        checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          {icon}
          {title}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{description}</p>
      </div>
    </label>
  );
}

// -----------------------------------------------------------------------------

function ImportProgress({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number };
  onCancel: () => void;
}) {
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card p-8 text-center">
      <Spinner className="mx-auto size-8" />
      <p className="mt-4 text-base font-medium text-slate-900">Importing your leads...</p>
      <p className="mt-1 text-sm text-slate-500">
        {formatNumber(progress.done)} of {formatNumber(progress.total)} rows
      </p>

      <div className="mx-auto mt-5 h-2.5 max-w-md overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <p className="mt-3 text-sm text-slate-400">
        Please keep this page open until it finishes.
      </p>

      <Button variant="ghost" size="sm" className="mt-4" icon={<X className="size-4" />} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------------

function ImportDone({
  result,
  hadError,
  onUploadAnother,
  onViewLeads,
}: {
  result: ImportResult;
  hadError: boolean;
  onUploadAnother: () => void;
  onViewLeads: () => void;
}) {
  return (
    <div className="card p-8 text-center">
      <div
        className={cn(
          'mx-auto mb-4 flex size-14 items-center justify-center rounded-full',
          hadError ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600',
        )}
      >
        {hadError ? <AlertTriangle className="size-7" /> : <CheckCircle2 className="size-7" />}
      </div>

      <h2 className="text-lg font-semibold text-slate-900">
        {hadError ? 'Import finished with problems' : 'Import complete'}
      </h2>

      <dl className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3 text-left sm:grid-cols-4">
        <Tally label="Added" value={result.inserted} tone="emerald" />
        <Tally label="Updated" value={result.updated} tone="slate" />
        <Tally label="Skipped" value={result.skipped} tone="amber" />
        <Tally label="Failed" value={result.failed} tone={result.failed ? 'red' : 'slate'} />
      </dl>

      <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="secondary" onClick={onUploadAnother}>
          Upload another file
        </Button>
        <Button onClick={onViewLeads}>View leads</Button>
      </div>
    </div>
  );
}
