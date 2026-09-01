import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTrends,
  compareSessions,
  practiceStreak,
  previousSessionFor,
  diagnoseSession,
  ingest,
  trendableClubs,
  type Handedness,
  type IngestWarning,
  type SessionReport,
  type ShotSession,
  type PracticeDuration,
  type Trend,
} from '@swinglab/core';
import { clearAll, loadAll, remove, save, type StoredSession } from './storage.js';
import { isDesktop, watchExportFolder } from './desktop.js';
import { applyTheme, loadTheme, type Theme } from './theme.js';
import { buildStamp, VERSION } from './version.js';
import { shortDate } from './format.js';
import { ClubsView, PracticeView, PriorityView, TrendsView } from './components/Views.js';
import { OverviewView } from './components/Overview.js';

type Tab = 'overview' | 'priority' | 'practice' | 'clubs' | 'trends';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'priority', label: 'Priority' },
  { id: 'practice', label: 'Practice' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'trends', label: 'Trends' },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [stored, setStored] = useState<StoredSession[]>(() => loadAll());
  const [activeId, setActiveId] = useState<string | null>(() => loadAll()[0]?.session.id ?? null);
  const [tab, setTab] = useState<Tab>('overview');
  const [practiceDuration, setPracticeDuration] = useState<PracticeDuration>(60);
  const [warnings, setWarnings] = useState<IngestWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [watching, setWatching] = useState(false);

  const handednessRef = useRef(handedness);
  handednessRef.current = handedness;
  const stopWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => () => stopWatchRef.current?.(), []);

  const active = useMemo(
    () => stored.find((s) => s.session.id === activeId)?.session ?? null,
    [stored, activeId],
  );

  const cloned = useMemo(() => (active ? cloneSession(active) : null), [active]);

  const report = useMemo<SessionReport | null>(
    () => (cloned ? diagnoseSession(cloned, { practiceDuration }) : null),
    [cloned, practiceDuration],
  );

  /*
   * Did the last session's work actually change anything?
   *
   * Computed here rather than in the report because it needs every stored
   * session, not just the one being viewed.
   */
  const comparison = useMemo(() => {
    if (!cloned) return null;
    const club = [...cloned.shots].reduce<Record<string, number>>((acc, s) => {
      acc[s.club] = (acc[s.club] ?? 0) + 1;
      return acc;
    }, {});
    const main = Object.entries(club).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!main) return null;
    const prev = previousSessionFor(
      stored.map((s) => s.session), cloned, main as Parameters<typeof compareSessions>[2],
    );
    if (!prev) return null;
    return compareSessions(prev, cloned, main as Parameters<typeof compareSessions>[2]);
  }, [cloned, stored]);

  // Counted in days, not sessions — importing one afternoon twice is not a
  // two-day habit.
  const streak = useMemo(
    () => practiceStreak(stored.map((s) => s.session.startedAt)),
    [stored],
  );

  const trends = useMemo<Trend[]>(() => {
    const sessions = stored.map((s) => s.session);
    if (sessions.length < 3) return [];
    return trendableClubs(sessions).flatMap((club) => buildTrends(sessions, club));
  }, [stored]);

  /** The single ingest path — drops, the picker and the folder watcher. */
  const ingestRaw = useCallback((inputs: { name: string; text: string }[]) => {
    setError(null);
    const collected: IngestWarning[] = [];
    let lastId: string | null = null;
    let next = loadAll();

    for (const input of inputs) {
      const result = ingest(input, { handedness: handednessRef.current });
      collected.push(...result.warnings);
      if (result.session) {
        next = save(result.session);
        lastId = result.session.id;
      }
    }

    setStored(next);
    setWarnings(collected);
    if (lastId) setActiveId(lastId);
    else if (collected.length > 0) setError('No shots could be read from that file.');
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const inputs = await Promise.all(
        Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      ingestRaw(inputs);
    },
    [ingestRaw],
  );

  /**
   * Delete one session, keeping a sensible selection.
   *
   * No confirmation dialog: imports are cheap to redo, the file is still on
   * disk, and a prompt on every delete makes clearing out test data tedious.
   */
  const deleteSession = useCallback(
    (id: string) => {
      const next = remove(id);
      setStored(next);
      setActiveId((current) => (current === id ? (next[0]?.session.id ?? null) : current));
    },
    [],
  );

  const handleClearAll = useCallback(() => {
    setStored(clearAll());
    setActiveId(null);
    setWarnings([]);
    setError(null);
  }, []);

  const startWatching = useCallback(async () => {
    const stop = await watchExportFolder((files) => ingestRaw(files));
    if (stop) {
      stopWatchRef.current = stop;
      setWatching(true);
    }
  }, [ingestRaw]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <h1>
            Swing<span>Lab</span>
          </h1>
          <span className="version" title={buildStamp()}>
            v{VERSION}
          </span>
        </div>
        <div className="topbar-actions">
          <select
            aria-label="Handedness"
            value={handedness}
            onChange={(e) => setHandedness(e.target.value as Handedness)}
          >
            <option value="right">Right-handed</option>
            <option value="left">Left-handed</option>
          </select>
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <DropZone
        dragging={dragging}
        setDragging={setDragging}
        onFiles={handleFiles}
        hasData={stored.length > 0}
      />

      {isDesktop() && (
        <button className="watch" onClick={startWatching} disabled={watching}>
          {watching
            ? 'Watching your export folder — new sessions appear automatically'
            : 'Watch my TPS export folder'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
      {warnings.length > 0 && <Warnings warnings={warnings} />}

      {stored.length > 0 && (
        <nav className="sessions" aria-label="Sessions">
          {stored.map((s) => (
            <span
              key={s.session.id}
              className={s.session.id === activeId ? 'chip-wrap chip-on' : 'chip-wrap'}
            >
              <button className="chip" onClick={() => setActiveId(s.session.id)}>
                {shortDate(s.session.startedAt)}
                <em>{s.session.kind}</em>
                <span>{s.session.shots.length}</span>
              </button>
              <button
                className="chip-x"
                aria-label={`Delete the ${shortDate(s.session.startedAt)} session`}
                title="Delete this session"
                onClick={() => deleteSession(s.session.id)}
              >
                ×
              </button>
            </span>
          ))}
          {stored.length > 1 && (
            <button className="chip-clear" onClick={handleClearAll}>
              Clear all
            </button>
          )}
        </nav>
      )}

      {report && active ? (
        <main>
          <SessionSummary report={report} onDelete={() => deleteSession(active.id)} />

          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'tab tab-on' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'trends' && trends.filter((x) => x.significant).length > 0 && (
                  <span className="dot" />
                )}
              </button>
            ))}
          </nav>

          <section className="view">
            {tab === 'overview' && cloned && (
              <OverviewView
                report={report}
                session={cloned}
                comparison={comparison}
                streak={streak}
              />
            )}
            {tab === 'priority' && <PriorityView report={report} />}
            {tab === 'practice' && (
              <PracticeView
                report={report}
                duration={practiceDuration}
                onDuration={setPracticeDuration}
              />
            )}
            {tab === 'clubs' && <ClubsView report={report} />}
            {tab === 'trends' && <TrendsView trends={trends} sessionCount={stored.length} />}
          </section>
        </main>
      ) : (
        <Empty />
      )}

      <footer className="footer">
        <span>{buildStamp()}</span>
        <span>Everything runs on this device. Nothing is uploaded.</span>
      </footer>
    </div>
  );
}

function SessionSummary({ report, onDelete }: { report: SessionReport; onDelete: () => void }) {
  return (
    <div className="summary card">
      <div className="summary-mode">
        <strong>{report.mode?.name ?? 'Session'}</strong>
        <span>{report.mode?.what ?? 'Imported shots'}</span>
      </div>
      <div className="summary-stats">
        <Stat value={String(report.shotCount)} label="shots" />
        <Stat value={String(report.clubsSeen.length)} label="clubs" />
        <Stat value={String(report.findings.length)} label="findings" />
      </div>
      <button className="ghost" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DropZone({
  dragging,
  setDragging,
  onFiles,
  hasData,
}: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  hasData: boolean;
}) {
  return (
    <label
      className={dragging ? 'drop drop-active' : 'drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept=".csv,.tsv,.txt"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <strong>{hasData ? 'Import another session' : 'Drop a TrackMan export here'}</strong>
      <span>
        TPS → Table View → File Options → TrackMan CSV. Works with Range, Test Center, Combine,
        Performance Center and the games.
      </span>
    </label>
  );
}

function Warnings({ warnings }: { warnings: IngestWarning[] }) {
  const grouped = new Map<string, number>();
  for (const w of warnings) grouped.set(w.message, (grouped.get(w.message) ?? 0) + 1);

  return (
    <details className="warnings">
      <summary>
        {warnings.length} note{warnings.length === 1 ? '' : 's'} from the import
      </summary>
      <ul>
        {[...grouped.entries()].map(([message, count]) => (
          <li key={message}>
            {message}
            {count > 1 && <em> ×{count}</em>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Empty() {
  return (
    <main className="empty-state">
      <h2>No sessions yet</h2>
      <p>
        Import a TrackMan export to get a ranked read on your game and a practice session laid out
        in real TrackMan modes. Everything is computed on this device from your own numbers.
      </p>
    </main>
  );
}

/**
 * Diagnosis attaches outlier flags to the shots it is given, so hand it a copy
 * rather than the stored objects — otherwise flags accumulate across renders
 * and a shot can end up flagged from a previous pass.
 */
function cloneSession(session: ShotSession): ShotSession {
  return { ...session, shots: session.shots.map((s) => ({ ...s, flags: [] })) };
}
