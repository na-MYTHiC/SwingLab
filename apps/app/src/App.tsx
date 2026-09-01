import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBaseline,
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
  type PlayerBaseline,
  type PracticeDuration,
  type Trend,
} from '@swinglab/core';
import { clearAll, loadAll, remove, save, type StoredSession } from './storage.js';
import { isDesktop, watchExportFolder } from './desktop.js';
import { applyTheme, loadTheme, type Theme } from './theme.js';
import { buildStamp, VERSION } from './version.js';
import { plural, sessionKindLabel, shortDate } from './format.js';
import { ClubsView, PracticeView, PriorityView, TrendsView } from './components/Views.js';
import { OverviewView } from './components/Overview.js';

export type Tab = 'overview' | 'priority' | 'practice' | 'clubs' | 'trends';

/*
 * Tab order follows the order the questions are actually asked: how did I do,
 * what is wrong, what do I do about it — then the reference material. The
 * first three are the session loop; Clubs and Trends get looked up, not read.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Session' },
  { id: 'priority', label: 'Fix' },
  { id: 'practice', label: 'Practice' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'trends', label: 'Trends' },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [handedness] = useState<Handedness>('right');
  const [stored, setStored] = useState<StoredSession[]>(() => byDate(loadAll()));
  const [activeId, setActiveId] = useState<string | null>(
    () => byDate(loadAll())[0]?.session.id ?? null,
  );
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

  // Changing tab mid-scroll and landing halfway down the next view is
  // disorienting on a phone, where the nav sits at the far end of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const active = useMemo(
    () => stored.find((s) => s.session.id === activeId)?.session ?? null,
    [stored, activeId],
  );

  const cloned = useMemo(() => (active ? cloneSession(active) : null), [active]);

  /*
   * The player's rolling averages, so the optimal targets hold still.
   *
   * Club speed moves three or four mph between two ordinary sessions with
   * warmth and effort, and rebuilding the targets from one afternoon means
   * they shift under the player on every import. Capped at the session being
   * viewed so that opening an older session shows the targets that applied
   * then, rather than judging March against a swing measured in September.
   */
  const baseline = useMemo<PlayerBaseline>(
    () => buildBaseline(stored.map((s) => s.session), { upTo: active?.startedAt ?? null }),
    [stored, active],
  );

  const report = useMemo<SessionReport | null>(
    () => (cloned ? diagnoseSession(cloned, { practiceDuration, baseline }) : null),
    [cloned, practiceDuration, baseline],
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
    let next = byDate(loadAll());

    for (const input of inputs) {
      const result = ingest(input, { handedness: handednessRef.current });
      collected.push(...result.warnings);
      if (result.session) {
        next = byDate(save(result.session));
        lastId = result.session.id;
      }
    }

    setStored(next);
    setWarnings(collected);
    if (lastId) {
      setActiveId(lastId);
      setTab('overview');
    } else if (collected.length > 0) {
      setError('No shots could be read from that file.');
    }
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
      const next = byDate(remove(id));
      setStored(next);
      setActiveId((current) => (current === id ? (next[0]?.session.id ?? null) : current));
    },
    [],
  );

  const startWatching = useCallback(async () => {
    const stop = await watchExportFolder((files) => ingestRaw(files));
    if (stop) {
      stopWatchRef.current = stop;
      setWatching(true);
    }
  }, [ingestRaw]);

  return (
    <div className="app">
      {/*
        One row, at every width. The identity is small because it is never the
        reason the app is open; the two things a player actually reaches for —
        getting this session in, and making it readable in a dark bay — are
        the controls.
      */}
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
          <label className="import-btn" title="Import a TrackMan export">
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            Import
          </label>

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

      {stored.length === 0 && (
        <DropZone dragging={dragging} setDragging={setDragging} onFiles={handleFiles} />
      )}

      {isDesktop() && (
        <button className="watch" onClick={startWatching} disabled={watching}>
          {watching
            ? 'Watching your export folder — new sessions appear automatically'
            : 'Watch my TPS export folder'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
      {warnings.length > 0 && <Warnings warnings={warnings} />}

      {report && active ? (
        <main>
          {/*
            Which session is on screen, and how big it was. The picker lives
            here rather than in the top bar because it is a property of the
            content — and because a full-width control is reachable one-handed
            in a way a shrunk-to-fit dropdown in a crowded header is not.
          */}
          <SessionBar
            stored={stored}
            activeId={activeId}
            onSelect={setActiveId}
            report={report}
            onDelete={() => deleteSession(active.id)}
          />

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
            {tab === 'clubs' && cloned && <ClubsView report={report} session={cloned} />}
            {tab === 'trends' && <TrendsView trends={trends} sessionCount={stored.length} />}
          </section>
        </main>
      ) : (
        <Empty />
      )}

      <footer className="footer">
        <span>Everything runs on this device. Nothing is uploaded.</span>
        <span className="footer-build">{buildStamp()}</span>
      </footer>

      {/*
        Navigation sits at the bottom, where a thumb is. A tab strip halfway
        down the page competes with the content for the eye and is the
        furthest thing from reach on a phone.
      */}
      {report && (
        <nav className="bottom-nav" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'nav-item nav-on' : 'nav-item'}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-label">{t.label}</span>
              {t.id === 'trends' && trends.some((x) => x.significant) && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function SessionBar({
  stored, activeId, onSelect, report, onDelete,
}: {
  stored: StoredSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  report: SessionReport;
  onDelete: () => void;
}) {
  return (
    <div className="session-bar">
      <div className="session-pick">
        <select
          aria-label="Session"
          value={activeId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {stored.map((s) => (
            <option key={s.session.id} value={s.session.id}>
              {shortDate(s.session.startedAt)} · {sessionKindLabel(s.session.kind)} ·{' '}
              {s.session.shots.length} shots
            </option>
          ))}
        </select>
      </div>

      <div className="session-meta">
        <span>{plural(report.shotCount, 'shot')}</span>
        <span>{plural(report.clubsSeen.length, 'club')}</span>
        <span>{plural(report.findings.length, 'finding')}</span>
        <button className="ghost" onClick={onDelete} title="Delete this session">
          Delete
        </button>
      </div>
    </div>
  );
}

function DropZone({
  dragging, setDragging, onFiles,
}: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
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
      <strong>Drop a TrackMan export here</strong>
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
 * Newest practice first.
 *
 * The store keeps import order, which is not the same thing: importing an
 * export from three weeks ago should not put it at the top of a list a player
 * reads as a history. Undated sessions fall to the end rather than jumping the
 * queue on a null date.
 */
function byDate(sessions: StoredSession[]): StoredSession[] {
  return [...sessions].sort((a, b) => {
    const at = a.session.startedAt?.getTime() ?? -Infinity;
    const bt = b.session.startedAt?.getTime() ?? -Infinity;
    return bt - at;
  });
}

/**
 * Diagnosis attaches outlier flags to the shots it is given, so hand it a copy
 * rather than the stored objects — otherwise flags accumulate across renders
 * and a shot can end up flagged from a previous pass.
 */
function cloneSession(session: ShotSession): ShotSession {
  return { ...session, shots: session.shots.map((s) => ({ ...s, flags: [] })) };
}
