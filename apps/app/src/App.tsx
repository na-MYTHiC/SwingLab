import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBaseline,
  buildTrends,
  buildWindows,
  readForm,
  compareSessions,
  evaluateTargets,
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
  type FormRead,
  type PracticeTarget,
  type TargetResult,
  type WindowProfile,
  type Trend,
} from '@swinglab/core';
import {
  buildBackup, forgetTargets, loadAll, loadTargets, remove, restoreBackup, save, saveTargets,
  type StoredSession,
} from './storage.js';
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
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  /*
   * The closed loop.
   *
   * A plan's pass marks are written once, against the session that produced
   * them, and read back when a later session is imported. Without this the app
   * could say what to practise and never find out whether it worked — which is
   * the loop almost every launch monitor tool leaves open.
   */
  useEffect(() => {
    if (report && active) saveTargets(active.id, report.practice.targets);
  }, [report, active]);

  const targetResults = useMemo<{ results: TargetResult[]; since: Date | null } | null>(() => {
    if (!active) return null;
    const ordered = stored.map((s) => s.session);
    const index = ordered.findIndex((s) => s.id === active.id);
    const previous = index >= 0 ? ordered[index + 1] : undefined;
    if (!previous) return null;

    const targets = loadTargets(previous.id) as PracticeTarget[] | null;
    if (!targets || targets.length === 0) return null;
    return { results: evaluateTargets(targets, active), since: previous.startedAt };
  }, [stored, active]);

  /*
   * Form over several lengths of history.
   *
   * A single session cannot separate "today was bad" from "I have got worse".
   * The windows can, and it is the question a player actually has after a poor
   * afternoon.
   */
  const windows = useMemo<{ windows: WindowProfile[]; form: FormRead[] } | null>(() => {
    if (!report || report.profiles.length === 0 || stored.length < 2) return null;
    const club = [...report.profiles].sort((x, y) => y.shotCount - x.shotCount)[0]?.club;
    if (!club) return null;
    const built = buildWindows(stored.map((x) => x.session), club);
    return { windows: built, form: readForm(built) };
  }, [report, stored]);

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

  /**
   * Everything that arrives as a file, however it arrived.
   *
   * A folder drop hands over every file inside it, including whatever else the
   * player keeps in there, so exports are picked out by extension and a
   * SwingLab backup is routed to the restorer rather than the CSV parser.
   * Restoring by dropping the folder you already keep your exports in is the
   * whole point: no per-file clicking on the day something goes wrong.
   */
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const all = Array.from(files);
      const backups = all.filter((f) => /\.json$/i.test(f.name));
      const exports_ = all.filter((f) => /\.(csv|tsv|txt)$/i.test(f.name));

      if (backups.length > 0) {
        const result = restoreBackup(await (backups[0] as File).text());
        setNotice(result.message);
        if (result.ok) {
          const next = byDate(loadAll());
          setStored(next);
          setActiveId((current) => current ?? next[0]?.session.id ?? null);
        }
        if (exports_.length === 0) return;
      }

      if (exports_.length === 0) {
        if (backups.length === 0) setError('No TrackMan exports found in that selection.');
        return;
      }

      const inputs = await Promise.all(
        exports_.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      ingestRaw(inputs);
      if (inputs.length > 1) {
        setNotice(`Read ${inputs.length} files.`);
      }
    },
    [ingestRaw],
  );

  const downloadBackup = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swinglab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  /**
   * Delete one session, keeping a sensible selection.
   *
   * No confirmation dialog: imports are cheap to redo, the file is still on
   * disk, and a prompt on every delete makes clearing out test data tedious.
   */
  const deleteSession = useCallback(
    (id: string) => {
      forgetTargets(id);
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
          <button
            className="import-btn"
            onClick={() => setManaging(true)}
            title="Import a TrackMan export, or remove one"
          >
            Import
          </button>

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
          <SessionBar stored={stored} activeId={activeId} onSelect={setActiveId} />

          <section className="view">
            {tab === 'overview' && cloned && (
              <OverviewView
                report={report}
                session={cloned}
                comparison={comparison}
                streak={streak}
                targets={targetResults}
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
            {tab === 'clubs' && cloned && (
              <ClubsView report={report} session={cloned} windows={windows} />
            )}
            {tab === 'trends' && <TrendsView trends={trends} sessionCount={stored.length} />}
          </section>
        </main>
      ) : (
        <Empty />
      )}

      {managing && (
        <ImportDialog
          stored={stored}
          activeId={activeId}
          onFiles={handleFiles}
          onDelete={deleteSession}
          onBackup={downloadBackup}
          notice={notice}
          onClose={() => { setManaging(false); setNotice(null); }}
        />
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

/**
 * Which session is on screen.
 *
 * Only the picker. The counts and the delete control that used to sit under
 * it were a second row of chrome above every view, and deleting is not
 * something anybody does often enough to earn permanent space — it lives in
 * the import dialog now, next to the list it acts on.
 */
function SessionBar({
  stored, activeId, onSelect,
}: {
  stored: StoredSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="session-bar">
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
  );
}

/**
 * Import and remove sessions, in one place.
 *
 * Both halves of the same job — getting files in and taking them back out —
 * so they belong on the same screen rather than having delete permanently
 * parked under the picker where it is one mis-tap from losing a session.
 */
function ImportDialog({
  stored, activeId, onFiles, onDelete, onBackup, notice, onClose,
}: {
  stored: StoredSession[];
  activeId: string | null;
  onFiles: (files: FileList | File[]) => void;
  onDelete: (id: string) => void;
  onBackup: () => void;
  notice: string | null;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a sheet is over it — on a phone
    // that reads as the dialog itself having come apart.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>Sessions</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

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
            if (e.dataTransfer.files.length > 0) {
              onFiles(e.dataTransfer.files);
              onClose();
            }
          }}
        >
          <input
            type="file"
            accept=".csv,.tsv,.txt,.json"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <strong>Add exports</strong>
          <span>
            TPS → Table View → File Options → TrackMan CSV. Drop one file, several, or a whole
            folder.
          </span>
        </label>

        {/*
          A folder picker as well as a file picker.
          
          Keeping every export in one folder means a wipe is recoverable in a
          single action rather than by clicking through a year of files one at
          a time — which is the difference between a backup that works and one
          that exists.
        */}
        <div className="sheet-row">
          <label className="ghost-btn">
            <input
              type="file"
              hidden
              multiple
              // Not in the React types; supported by every browser that matters.
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => {
                if (e.target.files?.length) void onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            Import a folder
          </label>
          <button className="ghost-btn" onClick={onBackup} disabled={stored.length === 0}>
            Save a backup
          </button>
        </div>

        {notice && <p className="sheet-notice">{notice}</p>}

        {stored.length > 0 && (
          <>
            <h3 className="sheet-sub">{plural(stored.length, 'session')} on this device</h3>
            <ul className="sheet-list">
              {stored.map((s) => (
                <li key={s.session.id} className={s.session.id === activeId ? 'is-active' : ''}>
                  <div>
                    <strong>{shortDate(s.session.startedAt)}</strong>
                    <span>
                      {sessionKindLabel(s.session.kind)} · {plural(s.session.shots.length, 'shot')}
                    </span>
                  </div>
                  <button
                    className="ghost"
                    onClick={() => onDelete(s.session.id)}
                    aria-label={`Delete the session from ${shortDate(s.session.startedAt)}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="sheet-note">
          Everything stays on this device — which also means a browser tidy-up can erase it. Save a
          backup now and then, or keep your exports in one folder and re-import it.
        </p>
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
