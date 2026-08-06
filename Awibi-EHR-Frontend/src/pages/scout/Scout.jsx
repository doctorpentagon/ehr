import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, X, Calculator, BookOpen, AlertTriangle, ArrowLeft,
  Download, Check, Loader2, WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { search as runSearch } from '@/lib/scoutSearch';
import { calculate, isComputable, writtenFormula } from '@/lib/scoutCalculator';
import { loadIndex, loadEntry, downloadForOffline, offlineStatus } from '@/lib/scoutStore';

/**
 * Awibi Scout — clinical reference and calculators.
 *
 * One search box, and everything behind it. The brief was explicit that this
 * must not be a menu of options: with a thousand entries, choosing from a list
 * is slower than remembering where the paper copy is. So the screen is a search
 * box first, and the categories are a fallback for browsing rather than the way
 * in.
 *
 * Results appear as you type because the index is in memory — no request per
 * keystroke, which also means it keeps working when the connection does not.
 */

// Grouped so the chips are scannable rather than an alphabetical wall of 50.
const TYPE_GROUPS = [
  { label: 'Work it out', types: ['calculator', 'score', 'conversion', 'criteria'] },
  { label: 'Decide', types: ['guideline', 'pathway', 'regimen', 'principles', 'differential'] },
  { label: 'Classify', types: ['classification', 'staging', 'grading', 'reference_interval'] },
  { label: 'At the bedside', types: ['examination', 'clerking', 'procedure', 'technique', 'monitoring'] },
  { label: 'Know', types: ['definition', 'sign', 'symptom', 'mechanism', 'anatomy_physiology', 'pathology'] },
  { label: 'Drugs & tests', types: ['drug', 'dose_reference', 'test', 'specimen', 'reversal'] },
  { label: 'Emergency', types: ['emergency', 'fluid_blood'] },
];

const HAZARD_STYLE = {
  high: 'bg-red-50 text-red-800 border-red-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

const prettyType = (t) => String(t || '').replace(/_/g, ' ');

/** Highlights the matched words so it is obvious why a result came back. */
function Highlight({ text, query }) {
  const terms = useMemo(
    () => String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1),
    [query],
  );
  if (!terms.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return (
    <>
      {String(text).split(pattern).map((part, i) => (
        pattern.test(part)
          ? <mark key={i} className="bg-amber-100 text-inherit rounded-sm px-0.5">{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>
      ))}
    </>
  );
}

function ResultCard({ result, query, onOpen }) {
  const e = result.entry;
  return (
    <button
      onClick={() => onOpen(e.g)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-3.5 hover:border-[#2D5BFF] hover:shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              <Highlight text={e.t} query={query} />
            </span>
            {e.c && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-[#2D5BFF]/10 text-[#2D5BFF] rounded font-medium">
                <Calculator size={11} /> calculates
              </span>
            )}
            {e.h === 'high' && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-medium">
                <AlertTriangle size={11} /> high risk
              </span>
            )}
          </div>
          {e.m && (
            <p className="text-xs text-gray-600 mt-1 line-clamp-2">
              <Highlight text={e.m} query={query} />
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
            <span className="capitalize">{prettyType(e.y)}</span>
            {e.f > 0 && <span>· {e.f} key points</span>}
            {e.x > 0 && <span>· {e.x} checks</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

/** The calculator form. Nothing is shown until every input is valid. */
function CalculatorPanel({ entry }) {
  const [values, setValues] = useState({});
  const [outcome, setOutcome] = useState(null);

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setValues((prev) => ({ ...prev, [key]: v }));
    setOutcome(null);
  };

  const run = () => setOutcome(calculate(entry, values));

  const formula = writtenFormula(entry);
  if (!isComputable(entry)) {
    if (!formula) return null;
    return (
      <section className="border border-gray-200 rounded-lg p-4 bg-slate-50">
        <h3 className="text-sm font-semibold text-gray-900 mb-1.5">The formula</h3>
        <p className="text-sm text-gray-800 font-mono whitespace-pre-wrap">{formula}</p>
        <p className="text-xs text-gray-500 mt-2">
          Written out for you to work through — this one is not calculated here.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Work it out</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        {(entry.inputs || []).map((input) => (
          <div key={input.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`in-${input.key}`}>
              {input.label}
              {input.unit && <span className="text-gray-400 font-normal"> ({input.unit})</span>}
              {input.required && <span className="text-red-500"> *</span>}
            </label>

            {input.type === 'boolean' || input.type === 'checkbox' ? (
              <label className="flex items-center gap-2 min-h-11 cursor-pointer">
                <input id={`in-${input.key}`} type="checkbox" checked={Boolean(values[input.key])} onChange={set(input.key)} />
                <span className="text-sm text-gray-700">Yes</span>
              </label>
            ) : input.type === 'select' && input.options ? (
              <select id={`in-${input.key}`} value={values[input.key] ?? ''} onChange={set(input.key)}
                className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm">
                <option value="">Choose…</option>
                {input.options.map((o) => (
                  <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
                ))}
              </select>
            ) : (
              <input
                id={`in-${input.key}`}
                type="number"
                inputMode="decimal"
                step="any"
                value={values[input.key] ?? ''}
                onChange={set(input.key)}
                placeholder={input.min != null && input.max != null ? `${input.min}–${input.max}` : ''}
                className="w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm"
              />
            )}
            {input.note && <p className="text-xs text-gray-500 mt-1">{input.note}</p>}
          </div>
        ))}
      </div>

      <button onClick={run} className="mt-4 w-full sm:w-auto min-h-11 px-6 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">
        Calculate
      </button>

      {outcome && !outcome.ok && (
        <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
          <ul className="text-sm text-amber-900 space-y-1">
            {outcome.problems.map((p, i) => <li key={i}>{p.message}</li>)}
          </ul>
        </div>
      )}

      {outcome?.ok && (
        <div className="mt-3 space-y-2">
          {outcome.results.map((r) => (
            <div key={r.key} className="border border-[#2D5BFF]/30 bg-[#2D5BFF]/5 rounded-lg p-4">
              <div className="text-xs text-gray-600">{r.label}</div>
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {r.value}
                {r.unit && <span className="text-base font-normal text-gray-500 ml-1">{r.unit}</span>}
              </div>
              {r.band && <div className="text-sm font-medium text-gray-800 mt-1">{r.band}</div>}
              {r.action && <div className="text-sm text-gray-700 mt-1">{r.action}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Renders whatever body shape an entry happens to have. */
function Body({ body }) {
  if (!body || typeof body !== 'object' || !Object.keys(body).length) return null;
  return (
    <>
      {Object.entries(body).map(([heading, content]) => (
        <section key={heading}>
          <h3 className="text-sm font-semibold text-gray-900 mb-1.5 capitalize">
            {heading.replace(/_/g, ' ')}
          </h3>
          {Array.isArray(content) ? (
            <ul className="space-y-1.5">
              {content.map((item, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-gray-300 select-none">·</span>
                  <span>{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {typeof content === 'string' ? content : JSON.stringify(content)}
            </p>
          )}
        </section>
      ))}
    </>
  );
}

function EntryView({ slug, onBack }) {
  const [entry, setEntry] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setEntry(null); setFailed(false);
    loadEntry(slug)
      .then((e) => { if (live) setEntry(e); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug]);

  if (failed) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-600 min-h-11">
          <ArrowLeft size={16} /> Back to search
        </button>
        <div className="border border-gray-200 rounded-lg p-6 text-center">
          <WifiOff size={22} className="text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">
            This one is not saved on the device and could not be fetched.
          </p>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="animate-spin text-gray-400" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 min-h-11">
        <ArrowLeft size={16} /> Back to search
      </button>

      <header>
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded capitalize">
            {prettyType(entry.type)}
          </span>
          {entry.hazard && entry.hazard !== 'low' && (
            <span className={`text-xs px-2 py-0.5 rounded border capitalize ${HAZARD_STYLE[entry.hazard] || HAZARD_STYLE.low}`}>
              {entry.hazard} risk
            </span>
          )}
          {entry.jurisdiction && entry.jurisdiction !== 'international' && (
            <span className="text-xs px-2 py-0.5 bg-green-50 text-green-800 rounded capitalize">
              {entry.jurisdiction}
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{entry.title}</h1>
        {entry.summary && <p className="text-sm text-gray-600 mt-1.5">{entry.summary}</p>}
        {entry.also_known_as?.length > 0 && (
          <p className="text-xs text-gray-500 mt-1.5">Also called: {entry.also_known_as.join(' · ')}</p>
        )}
      </header>

      {entry.warnings?.length > 0 && (
        <div className="border-2 border-red-200 bg-red-50 rounded-lg p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={16} className="text-red-700" />
            <h3 className="text-sm font-semibold text-red-900">Before you use this</h3>
          </div>
          <ul className="space-y-1">
            {entry.warnings.map((w, i) => (
              <li key={i} className="text-sm text-red-900">{typeof w === 'string' ? w : w.text}</li>
            ))}
          </ul>
        </div>
      )}

      <CalculatorPanel entry={entry} />

      <Body body={entry.body} />

      {entry.flashcards?.length > 0 && (
        <section className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Key points</h3>
          <ul className="space-y-2">
            {entry.flashcards.map((f, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-gray-900">{f.front || f.q}</span>
                <span className="block text-gray-700 mt-0.5">{f.back || f.a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.checkboxes?.length > 0 && (
        <section className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Checklist</h3>
          <ul className="space-y-1.5">
            {entry.checkboxes.map((c, i) => (
              <li key={i}>
                <label className="flex items-start gap-2.5 cursor-pointer py-1">
                  <input type="checkbox" className="mt-1" />
                  <span className="text-sm text-gray-800">{typeof c === 'string' ? c : c.text || c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.limitations?.length > 0 && (
        <section className="border border-gray-200 rounded-lg p-4 bg-slate-50">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">What this does not tell you</h3>
          <ul className="space-y-1">
            {entry.limitations.map((l, i) => (
              <li key={i} className="text-sm text-gray-700">{typeof l === 'string' ? l : l.text}</li>
            ))}
          </ul>
        </section>
      )}

      {entry.governance && (
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
          {entry.governance.source || entry.governance.basis || 'Reference content'}
          {entry.governance.last_reviewed && ` · reviewed ${entry.governance.last_reviewed}`}
        </p>
      )}
    </div>
  );
}

export default function Scout() {
  const [params, setParams] = useSearchParams();
  const [index, setIndex] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState(params.get('q') || '');
  const [typeFilter, setTypeFilter] = useState(null);
  const [calcOnly, setCalcOnly] = useState(false);
  const [openSlug, setOpenSlug] = useState(params.get('entry') || null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(offlineStatus());
  const inputRef = useRef(null);

  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch(() => setLoadError('Could not load the reference library.'));
  }, []);

  // Keep the address bar in step so a result can be shared or bookmarked.
  useEffect(() => {
    const next = {};
    if (query) next.q = query;
    if (openSlug) next.entry = openSlug;
    setParams(next, { replace: true });
  }, [query, openSlug, setParams]);

  /**
   * Searching runs against an in-memory index, so it is fast enough to run on
   * every keystroke — no debounce, no request, and it works offline.
   */
  const outcome = useMemo(() => {
    if (!index) return null;
    return runSearch(index, query, { type: typeFilter, calculatorsOnly: calcOnly, limit: 60 });
  }, [index, query, typeFilter, calcOnly]);

  const saveOffline = useCallback(async () => {
    setSaving(true);
    try {
      const { stored, total } = await downloadForOffline();
      setOffline(offlineStatus());
      toast.success(`Saved ${stored} of ${total} entries for offline use`);
    } catch {
      toast.error('Could not save for offline use');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loadError) {
    return (
      <div className="border border-gray-200 rounded-lg p-8 text-center max-w-md">
        <WifiOff size={24} className="text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-700">{loadError}</p>
        <button onClick={() => window.location.reload()} className="mt-3 min-h-11 px-4 border border-gray-300 rounded-lg text-sm">
          Try again
        </button>
      </div>
    );
  }

  if (!index) {
    return (
      <div className="py-20 flex flex-col items-center gap-3">
        <Loader2 className="animate-spin text-gray-400" size={24} />
        <p className="text-sm text-gray-500">Loading the reference library…</p>
      </div>
    );
  }

  if (openSlug) return <EntryView slug={openSlug} onBack={() => setOpenSlug(null)} />;

  const results = outcome?.results || [];
  const placeholders = index.ui?.placeholders || [];
  const placeholder = placeholders.length
    ? `Try “${placeholders[0]}”`
    : 'Search anything — a drug, a score, a sign, a formula…';

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scout</h1>
          <p className="text-sm text-gray-500">
            {index.entries.length} references and calculators · type anything
          </p>
        </div>
        <button
          onClick={saveOffline}
          disabled={saving}
          className="flex items-center gap-1.5 min-h-11 px-3 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-50"
          title="Keep the whole library on this device"
        >
          {saving ? <Loader2 size={15} className="animate-spin" />
            : offline.entriesCached > 100 ? <Check size={15} className="text-green-600" />
              : <Download size={15} />}
          {offline.entriesCached > 100 ? 'Available offline' : 'Save for offline'}
        </button>
      </div>

      {/* Search first. Everything else is secondary to this box. */}
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          spellCheck="false"
          className="w-full min-h-14 pl-11 pr-11 border-2 border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#2D5BFF]"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700"
            aria-label="Clear"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setCalcOnly((v) => !v)}
          className={`flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-sm border ${calcOnly ? 'bg-[#2D5BFF] text-white border-[#2D5BFF]' : 'border-gray-300 text-gray-700'}`}
        >
          <Calculator size={14} /> Calculators only
        </button>
        {typeFilter && (
          <button onClick={() => setTypeFilter(null)}
            className="flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-sm bg-gray-900 text-white capitalize">
            {prettyType(typeFilter)} <X size={14} />
          </button>
        )}
      </div>

      {/* Nothing typed yet: offer categories rather than an empty screen. */}
      {!query && !typeFilter && (
        <div className="space-y-3">
          {TYPE_GROUPS.map((group) => {
            const available = group.types.filter((t) => index.byType?.has?.(t) || index.types.includes(t));
            if (!available.length) return null;
            return (
              <div key={group.label}>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{group.label}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {available.map((t) => (
                    <button key={t} onClick={() => setTypeFilter(t)}
                      className="min-h-11 px-3 border border-gray-300 rounded-lg text-sm text-gray-700 hover:border-[#2D5BFF] hover:text-[#2D5BFF] capitalize">
                      {prettyType(t)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(query || typeFilter) && (
        <>
          {/* Say how the results were found. A fuzzy guess must not look like
              an exact answer — somebody is about to dose against this. */}
          {outcome?.note && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {outcome.note}
            </p>
          )}

          {results.length === 0 ? (
            <div className="border border-gray-200 rounded-lg p-8 text-center">
              <BookOpen size={22} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-700">Nothing yet for “{query}”.</p>
              <p className="text-xs text-gray-500 mt-1">Try a shorter word, or browse a category below.</p>
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {(index.ui?.emptyStateChips || []).slice(0, 6).map((chip) => (
                  <button key={chip} onClick={() => setQuery(chip)}
                    className="min-h-11 px-3 border border-gray-300 rounded-lg text-sm text-gray-700">
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                {results.length} {results.length === 1 ? 'result' : 'results'}
              </p>
              <div className="grid gap-2">
                {results.map((r) => (
                  <ResultCard key={r.entry.g} result={r} query={query} onOpen={setOpenSlug} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
