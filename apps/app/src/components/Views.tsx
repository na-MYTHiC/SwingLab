import type {
  Achievement, HandicapEstimate, Streak,
  Prioritised, SessionReport, Prescription, ClubProfile, Shot, ShotSession, Trend,
  PracticeDuration, FormRead, WindowProfile, SelfPercentile, ScoringZone,
} from '@swinglab/core';
import { DispersionChart, TrendChart } from './Charts.js';
import { Runner } from './Runner.js';
import { fresh, loadRun, saveRun } from '../runState.js';
import { useEffect, useState } from 'react';
import {
  AchievementPanel, ConsistencyBars, HandicapPanel, OptimalBands, StreakBadge,
} from './Visuals.js';
import { carryFactor, trackManIndices } from '@swinglab/core';
import { minutes, num, plural, shots, speedLabel } from '../format.js';
import { useWide } from '../useWide.js';

/**
 * The Fix view — the answer to "what do I do next".
 *
 * Ordered by leverage rather than severity, so the top card is whatever
 * produces the fastest real improvement. Symptoms are nested under the cause
 * that explains them, because presenting them as separate work is how a
 * practice session gets spent fixing one fault three times.
 *
 * The ranking only means something if the page looks ranked. Seven cards of
 * identical weight is a list to read; one card that dominates, two that
 * support it and the rest folded away is an instruction.
 */
/**
 * What aiming is worth.
 *
 * Sits above the findings on Fix, and above them for a reason: everything
 * below it needs weeks of practice, and this needs thirty seconds behind the
 * ball. It would be perverse to lead a player into a swing rebuild without
 * first telling them their pattern is not pointed at the target.
 */
function AimCard({ report }: { report: SessionReport }) {
  const aim = report.aim;
  if (!aim.worthSaying || !aim.worst) return null;
  const w = aim.worst;

  return (
    <section className="card aim-card">
      <h3 className="panel-title">Before you practise anything</h3>
      <div className="aim-figure">
        <strong>{aim.strokesFromAim.toFixed(1)}</strong>
        <span>shots a round from aim alone</span>
      </div>
      <p className="aim-move">
        Aim <strong>{Math.round(w.moveYards)} yards {w.moveSide}</strong> with the {w.club}.
      </p>
      <div className="aim-bars">
        <div className="aim-bar">
          <span className="aim-bar-label">Greens held now</span>
          <div className="aim-track">
            <div className="aim-fill now" style={{ width: `${Math.round(w.greenNow * 100)}%` }} />
          </div>
          <span className="aim-bar-value">{Math.round(w.greenNow * 100)}%</span>
        </div>
        <div className="aim-bar">
          <span className="aim-bar-label">Aimed correctly</span>
          <div className="aim-track">
            <div className="aim-fill aimed" style={{ width: `${Math.round(w.greenAimed * 100)}%` }} />
          </div>
          <span className="aim-bar-value">{Math.round(w.greenAimed * 100)}%</span>
        </div>
      </div>
      <details className="aim-why">
        <summary>Why aim comes first</summary>
        <p className="panel-sub">{aim.detail}</p>
      </details>
    </section>
  );
}

export function PriorityView({ report }: { report: SessionReport }) {
  if (report.findings.length === 0) {
    return (
      <div className="empty-state">
        <h2>Nothing clear to act on</h2>
        <p>
          Either this was a clean session, or there were not enough shots per club to draw a
          conclusion. Both are real answers — the app will not invent a fault to fill the space.
        </p>
      </div>
    );
  }

  const roots = report.priorities.filter((p) => p.explainedBy === null);
  const symptomsOf = (root: Prioritised) =>
    report.priorities.filter(
      (p) => p.explainedBy === `${root.finding.id}::${root.finding.club ?? 'bag'}`,
    );

  const [first, ...rest] = roots;
  const supporting = rest.slice(0, 2);
  const later = rest.slice(2);

  const behind = report.optimals || report.consistency;

  return (
    <div className="stack">
      <section className="card card-hero fix-hero hero-brand">
        <p className="eyebrow">On the table</p>
        <div className="num-display fix-num">
          {shots(report.strokesAvailable)}
          <small>shots a round</small>
        </div>
        <p className="fix-sub">
          Everything found in this session, added up. Work down the list: the top item is the
          fastest improvement, not simply the worst number.
        </p>
      </section>

      <AimCard report={report} />

      {first && (
        <>
          <h2 className="section-head">
            Start here
            <span>the one thing worth an hour</span>
          </h2>
          <PriorityCard entry={first} rank={1} lead symptoms={symptomsOf(first)} />
        </>
      )}

      {supporting.length > 0 && (
        <>
          <h2 className="section-head">
            Then these
            <span>worth time once the first is holding</span>
          </h2>
          <ol className="priority-list" start={2}>
            {supporting.map((root, i) => (
              <PriorityCard
                key={`${root.finding.id}-${root.finding.club}`}
                entry={root}
                rank={i + 2}
                folded
                symptoms={symptomsOf(root)}
              />
            ))}
          </ol>
        </>
      )}

      {later.length > 0 && (
        <details className="more-findings">
          <summary>
            {later.length} more finding{later.length === 1 ? '' : 's'}, smaller payoff
          </summary>
          <ol className="priority-list" start={supporting.length + 2}>
            {later.map((root, i) => (
              <PriorityCard
                key={`${root.finding.id}-${root.finding.club}`}
                entry={root}
                rank={i + supporting.length + 2}
                folded
                symptoms={symptomsOf(root)}
              />
            ))}
          </ol>
        </details>
      )}

      {behind && (
        <>
          <h2 className="section-head">
            The numbers behind it
            <span>the proof, for when you want it</span>
          </h2>
          {report.optimals && (
            <details className="card-quiet quiet-disc">
              <summary>
                Where these should be
                <span>{report.optimals.club} at {report.optimals.clubSpeed.toFixed(0)} mph</span>
              </summary>
              <OptimalBands optimals={report.optimals} />
            </details>
          )}
          {report.consistency && (
            <details className="card-quiet quiet-disc">
              <summary>
                What you can repeat
                <span>worst first</span>
              </summary>
              <p className="panel-sub">
                Averages say what you usually do; these say whether you can be relied on to do it.
              </p>
              <ConsistencyBars consistency={report.consistency} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function PriorityCard({
  entry, rank, symptoms, lead = false, folded = false,
}: {
  entry: Prioritised;
  rank: number;
  symptoms: Prioritised[];
  lead?: boolean;
  folded?: boolean;
}) {
  const { finding, impact, leverageStrokes } = entry;
  const unlocks = leverageStrokes - impact.courseStrokes;
  const Wrapper = lead ? 'div' : 'li';
  const cls = `card priority sev-${finding.severity}${lead ? ' priority-lead' : ''}${folded ? ' priority-folded' : ''}`;

  const body = (
    <>
      <div className="impact-row">
        <span className="impact-main">
          ≈<strong>{shots(impact.courseStrokes)}</strong> shots/round
        </span>
        {unlocks > 0.05 && (
          <span className="impact-unlock">
            +{shots(unlocks)} more from what it fixes downstream
          </span>
        )}
        <span className="impact-sim">≈{Math.round(impact.simPoints)} pts on a scored test</span>
      </div>

      <p className="card-detail">{finding.detail}</p>

      <ul className="evidence">
        {finding.evidence.map((e) => (
          <li key={e.label}>
            <span>{e.label}</span>
            <strong>
              {e.value}
              {e.unit}
            </strong>
            {e.reference !== undefined && (
              <em>
                vs {e.reference}
                {e.unit}
              </em>
            )}
          </li>
        ))}
      </ul>

      {symptoms.length > 0 && (
        <details className="symptoms">
          <summary>
            Likely also fixes {symptoms.length} other finding
            {symptoms.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {symptoms.map((s) => (
              <li key={`${s.finding.id}-${s.finding.club}`}>
                <strong>{s.finding.title}</strong>
                <span>{s.finding.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  const tags = (
    <span className="tags">
      <span className={`tag speed-${impact.speed}`}>{speedLabel(impact.speed)}</span>
      {finding.confidence === 'low' && <span className="tag tag-quiet">early signal</span>}
    </span>
  );

  if (folded) {
    // Rank, title, what it is worth and how fast: enough to decide whether to open it.
    return (
      <Wrapper className={cls}>
        <details>
          <summary className="priority-sum">
            <span className="priority-rank">{rank}</span>
            <span className="priority-sum-text">
              <b>{finding.title}</b>
              <span>≈{shots(impact.courseStrokes)} shots/round</span>
            </span>
            {tags}
          </summary>
          <div className="priority-body">{body}</div>
        </details>
      </Wrapper>
    );
  }

  return (
    <Wrapper className={cls}>
      <div className="priority-head">
        <span className="priority-rank">{rank}</span>
        {tags}
      </div>
      <h3>{finding.title}</h3>
      {body}
    </Wrapper>
  );
}

/**
 * The Practice view — a session laid out in real TrackMan modes.
 *
 * This is the one screen that gets read standing on the mat with a glove on,
 * so it is built to be worked through rather than read: a running clock down
 * the side, one block open at a time, and the drill detail folded away until
 * it is that block's turn.
 */
export function PracticeView({
  report, duration, onDuration,
}: {
  report: SessionReport;
  duration: PracticeDuration;
  onDuration: (d: PracticeDuration) => void;
}) {
  const { practice } = report;
  const wide = useWide();

  // A run in progress survives a reload, so coming back to the tab with the
  // clock still going puts you straight back on your block.
  const planKey = `${report.sessionId}:${duration}`;
  const [running, setRunning] = useState(() => loadRun(planKey) !== null);
  useEffect(() => { setRunning(loadRun(planKey) !== null); }, [planKey]);

  if (running) {
    return (
      <div className="stack">
        <Runner practice={practice} planKey={planKey} onExit={() => setRunning(false)} />
      </div>
    );
  }

  // A running clock, so a block's card says when it starts rather than only
  // how long it lasts — the number you need when the bay clock says 7:20.
  let elapsed = 0;
  const starts = practice.blocks.map((b) => {
    const at = elapsed;
    elapsed += b.minutes;
    return at;
  });

  // Open the drills on the first block that has any. The rest stay folded so
  // the plan can be scrolled at a glance, but the block the session is built
  // around should not need a tap before it says what to actually do.
  const firstWithDrills = practice.blocks.findIndex((b) => b.drills.length > 0);

  return (
    <div className="stack">
      <section className="card card-hero plan-hero hero-brand">
        <p className="eyebrow">Your plan</p>
        <h2 className="plan-title">{duration === 60 ? 'Your hour' : 'Your two hours'}</h2>
        <p className="plan-meta">
          {plural(practice.blocks.length, 'block')} · {minutes(practice.totalMinutes)}
        </p>
        <div className="slot-group" role="group" aria-label="Session length">
          {([60, 120] as PracticeDuration[]).map((d) => (
            <button
              key={d}
              className={d === duration ? 'slot slot-on' : 'slot'}
              aria-pressed={d === duration}
              onClick={() => onDuration(d)}
            >
              {d === 60 ? '1 hour' : '2 hours'}
            </button>
          ))}
        </div>
        {practice.blocks.length > 0 && (
          <button
            type="button"
            className="runner-start"
            onClick={() => { saveRun(fresh(planKey, Date.now())); setRunning(true); }}
          >
            Start this plan
            <small>One block at a time, with a clock. The screen stays on.</small>
          </button>
        )}
        <p className="plan-note">
          Bays go by the hour, so the plan fills the slot exactly.{' '}
          {practice.note ??
            'Built from root causes only. Symptoms are left out on purpose; the block that fixes the cause handles them.'}
        </p>
      </section>

      <ol className="practice-list">
        {practice.blocks.map((block, i) => (
          <PracticeBlock
            key={block.id}
            block={block}
            step={i + 1}
            startsAt={starts[i] ?? 0}
            openByDefault={wide || i === firstWithDrills}
          />
        ))}
      </ol>
    </div>
  );
}

function PracticeBlock({
  block, step, startsAt, openByDefault,
}: {
  block: Prescription;
  step: number;
  startsAt: number;
  openByDefault: boolean;
}) {
  return (
    <li className="card practice-block">
     <details open={openByDefault}>
      <summary className="block-head">
        <span className="block-clock">
          <b>{clock(startsAt)}</b>
          <i>{block.minutes} min</i>
        </span>
        <span className="block-title">
          <span className="block-step">Block {step}</span>
          <b>{block.title}</b>
        </span>
      </summary>

      <div className="mode-chip">
        <strong>{block.mode.name}</strong>
        <span>{block.mode.location}</span>
      </div>

      <p className="card-detail">{block.rationale}</p>

      <h4 className="block-sub">Set it up</h4>
      <ol className="setup">
        {block.setup.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <p className="success">
        <b>What good looks like</b>
        {block.success}
      </p>

      {block.targets.length > 0 && (
        <>
          <h4 className="block-sub">Hit these and the app will say so</h4>
          <ul className="target-marks">
            {block.targets.map((t) => (
              <li key={t.id}>
                <strong>{t.label}</strong>
                {t.baseline !== null && (
                  <span>
                    you are at {t.baseline}
                    {t.unit} now
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {block.drills.length > 0 && (
        <details className="drills" open={openByDefault}>
          <summary>
            {block.drills.length} drill{block.drills.length === 1 ? '' : 's'} for this block
          </summary>
          <ul className="drill-list">
            {block.drills.map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                <span>{d.how}</span>
                <p className="drill-phase">
                  <b>Build</b> {d.build}
                </p>
                <p className="drill-phase">
                  <b>Then vary</b> {d.transfer}
                </p>
                <em>{d.dose}</em>
                {d.feelsWorse && (
                  <p className="drill-warn">
                    Expect this to look worse while you do it — the dip is the drill working.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
     </details>
    </li>
  );
}

/** "0:00" from the top of the slot — how a bay clock is actually read. */
function clock(minute: number): string {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * The Clubs view — everything about your numbers, in one place.
 *
 * This is the reference half of the app: what each club does, the picture
 * that explains it, where those numbers should be for somebody swinging at
 * your speed, and which of them you can actually repeat. None of it changes
 * shot to shot, so it lives behind a tab you open on purpose rather than
 * padding out the screen you read after every session.
 *
 * The bag table is a laptop shape. Ten columns at 660px wide becomes a thing
 * to drag sideways on a phone, so below the breakpoint each club renders as
 * a card instead and nothing sits off the edge of the screen.
 */

/**
 * The yardage book.
 *
 * Placed at the very top of Clubs, above the raw numbers, because it is the
 * only screen in the app a player can act on without changing their swing.
 * The two columns that matter sit next to each other on purpose: the number
 * they remember and the number to club off. Seeing the gap is the point.
 */
/**
 * Clubs share their reason for having no number far more often than not — a
 * Combine refuses all seven for the same cause — so they are grouped rather
 * than listed, which would print one identical sentence per club.
 */
function groupOmitted(omitted: { club: string; reason: string }[]): string[] {
  const byReason = new Map<string, string[]>();
  for (const o of omitted) {
    const clubs = byReason.get(o.reason);
    if (clubs) clubs.push(o.club);
    else byReason.set(o.reason, [o.club]);
  }
  return [...byReason].map(([reason, clubs]) => `${clubs.join(', ')}: ${reason}`);
}

function YardageBookCard({ report }: { report: SessionReport }) {
  const book = report.yardageBook;
  if (book.clubs.length === 0) {
    return (
      <section className="card">
        <h3 className="panel-title">Yardage book</h3>
        <p className="panel-sub">
          {book.omitted.length > 0
            ? `No playing numbers from this session. ${groupOmitted(book.omitted).join('. ')}.`
            : 'Hit at least four full shots with a club and its playing number appears here.'}
        </p>
      </section>
    );
  }

  const worst = [...book.clubs].sort((a, b) => b.egoGap - a.egoGap)[0]!;

  return (
    <section className="card card-hero yardage hero-brand">
      <h3 className="panel-title">Yardage book</h3>
      <p className="panel-sub">
        <strong>Plays</strong> is the carry you beat four shots in five — club off that.{' '}
        <strong>Flushed</strong> is the one you remember. Mishits are left in, because the course
        does not throw them out.
      </p>

      <div className="yardage-wrap">
        <table className="yardage-table">
          <thead>
            <tr>
              <th className="l">Club</th>
              <th>Plays</th>
              <th>Flushed</th>
              <th>Aim</th>
              <th>Room</th>
            </tr>
          </thead>
          <tbody>
            {book.clubs.map((c) => (
              <tr key={c.club} className={c.confidence === 'thin' ? 'thin' : undefined}>
                <td className="club l">{c.club}</td>
                {/* Only the club the callout names is highlighted. Amber on
                    every row is amber on none. */}
                <td className={c.club === worst.club && worst.egoGap >= 8 ? 'plays ego-wide' : 'plays'}>
                  {c.plays}
                </td>
                <td className="muted">{c.flushed}</td>
                <td>
                  {c.aimSide === 'straight'
                    ? 'at it'
                    : `${Math.abs(c.aimYards).toFixed(0)}${c.aimSide === 'left' ? 'L' : 'R'}`}
                </td>
                <td>
                  {c.missSide === 'straight' || c.missYards < 4
                    ? '\u2014'
                    : `${c.missYards}${c.missSide === 'left' ? 'L' : 'R'}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {worst.egoGap >= 8 && (
        <p className="panel-sub yardage-call">
          Your {worst.club} is the one costing you. You will remember it as {worst.flushed}, but
          it plays {worst.plays} — {worst.egoGap} yards of club. Take the extra one.
        </p>
      )}

      {book.gaps.length > 0 && (
        <p className="panel-sub">
          Playing gaps:{' '}
          {book.gaps.map((g) => `${g.longer}→${g.shorter} ${g.gap}y`).join(' · ')}
        </p>
      )}

      {book.conditionsNote && (
        <p className="panel-sub">
          {book.conditionsNote}{' '}
          {book.clubs
            .filter((c) => c.playsAtSeaLevel !== null)
            .map((c) => `${c.club} ${c.playsAtSeaLevel}`)
            .join(' · ')}
        </p>
      )}

      {book.omitted.length > 0 && (
        <p className="panel-sub muted">
          {groupOmitted(book.omitted).join('. ')}.
        </p>
      )}
    </section>
  );
}

/** "11 short", "4 long", "on the number" — a signed miss said in words. */
function missWords(bias: number): string {
  const n = Math.round(Math.abs(bias));
  if (n === 0) return 'on the number';
  return `${n} ${bias < 0 ? 'short' : 'long'}`;
}

/**
 * The scoring zone: every target distance, read on one shared number line.
 *
 * Each row is centred on its target. The dot is the median miss, the band is
 * the typical spread around it, and every row uses the same scale so a wide
 * 9-iron and a tight sand wedge look as different as they are. Bias and
 * spread are drawn separately because they are fixed separately: a dot sat
 * left of the line is the wrong number written down, a long band is the swing.
 */
function ScoringZoneCard({ zone }: { zone: ScoringZone }) {
  if (zone.cells.length === 0) {
    return (
      <section className="card">
        <h3 className="panel-title">Scoring zone</h3>
        <p className="panel-sub">{zone.detail}</p>
      </section>
    );
  }

  const reach = Math.max(
    8,
    Math.ceil(Math.max(...zone.cells.map((c) => Math.abs(c.bias) + c.spread)) / 5) * 5,
  );
  const at = (yards: number) => 50 + (Math.max(-reach, Math.min(reach, yards)) / reach) * 50;

  return (
    <section className="card zone-card">
      <h3 className="panel-title">Scoring zone</h3>
      <p className="panel-sub">
        All your target practice — {plural(zone.shots, 'shot')} across{' '}
        {plural(zone.sessions, 'session')}. The line is the target; the dot is your median miss,
        the band your usual spread.
      </p>

      {/* Same grid as the rows, so the labels sit over the track at any width. */}
      <div className="zone-row zone-head" aria-hidden="true">
        <span className="zone-target">yds</span>
        <span />
        <span className="zone-scale">
          <span>← short</span>
          <span>long →</span>
        </span>
        <span>miss</span>
        <span className="zone-prox">to pin</span>
      </div>

      <ul className="zone-list">
        {zone.cells.map((c) => {
          const worst = zone.worst === c;
          const best = zone.best === c;
          const label =
            `${c.club} to ${c.target} yards: ${missWords(c.bias)}, ` +
            `spread ±${c.spread.toFixed(0)}` +
            (c.proximityFt !== null ? `, ${Math.round(c.proximityFt)} feet from the target` : '') +
            `, ${plural(c.shots, 'shot')}`;
          return (
            <li
              key={`${c.club}@${c.target}`}
              className={worst ? 'zone-row is-worst' : best ? 'zone-row is-best' : 'zone-row'}
              title={label}
              aria-label={label}
            >
              <span className="zone-target">{c.target}</span>
              <span className="zone-club">{c.club}</span>
              <span className="zone-track" aria-hidden="true">
                <span className="zone-zero" />
                <span
                  className="zone-band"
                  style={{ left: `${at(c.bias - c.spread)}%`, right: `${100 - at(c.bias + c.spread)}%` }}
                />
                <span className="zone-dot" style={{ left: `${at(c.bias)}%` }} />
              </span>
              <span className="zone-miss">
                {missWords(c.bias)}
                <small>±{c.spread.toFixed(0)}</small>
              </span>
              <span className="zone-prox">
                {c.proximityFt !== null ? `${Math.round(c.proximityFt)} ft` : '—'}
                {worst && <small className="zone-flag">weakest</small>}
                {best && <small className="zone-flag">best</small>}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="panel-sub zone-call">{zone.headline}. {zone.detail}</p>
    </section>
  );
}

export function ClubsView({
  report, session, zone,
}: { report: SessionReport; session: ShotSession; zone: ScoringZone }) {
  const wide = useWide();
  // The club you hit most is the one you most likely opened this tab for.
  const mostHit = [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0]?.club ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const current = report.profiles.some((p) => p.club === picked) ? picked : mostHit;
  const shown = wide ? report.profiles : report.profiles.filter((p) => p.club === current);

  return (
    <div className="stack">
      <YardageBookCard report={report} />
      <ScoringZoneCard zone={zone} />
      {report.conditions.raw && <ConditionsCard report={report} />}

      <h2 className="section-head">
        Club by club
        <span>{plural(report.profiles.length, 'club')} in this session</span>
      </h2>

      {report.profiles.length > 1 && (
        <div className="table-scroll card wide-only">
          <table>
            <thead>
              <tr>
                <th>Club</th>
                <th>Shots</th>
                <th>Carry</th>
                <th>±</th>
                <th>Club spd</th>
                <th>Smash</th>
                <th>Path</th>
                <th>Face/path</th>
                <th>AoA</th>
                <th>Spin</th>
              </tr>
            </thead>
            <tbody>
              {report.profiles.map((p) => (
                <tr key={p.club}>
                  <td className="club">{p.club}</td>
                  <td>
                    {p.shotCount}
                    {p.mishitCount > 0 && <em className="mishits"> ({p.mishitCount} off)</em>}
                  </td>
                  <td>{num(p.carry.median, 0)}</td>
                  <td>{p.carry.n > 2 ? num(p.carry.mad, 0) : '—'}</td>
                  <td>{num(p.clubSpeed.median, 1)}</td>
                  <td>{num(p.smashFactor.median, 2)}</td>
                  <td>{num(p.clubPath.median, 1)}</td>
                  <td>{num(p.faceToPath.median, 1)}</td>
                  <td>{num(p.attackAngle.median, 1)}</td>
                  <td>{num(p.spinRate.median, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!wide && report.profiles.length > 1 && (
        <div className="club-picker" role="group" aria-label="Choose a club">
          {report.profiles.map((p) => (
            <button
              key={p.club}
              type="button"
              className={p.club === current ? 'club-pick club-pick-on' : 'club-pick'}
              aria-pressed={p.club === current}
              onClick={() => setPicked(p.club)}
            >
              {p.club}
            </button>
          ))}
        </div>
      )}

      <div className="club-cards">
        {shown.map((p) => (
          <ClubCard
            key={p.club}
            profile={p}
            shots={session.shots.filter((s) => s.club === p.club)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One club: the numbers, then the picture of them.
 *
 * Carry and its spread lead because they are the two a player checks first,
 * and they are the pair that decides whether a club can be aimed at a flag.
 */
/**
 * The air these numbers were measured in.
 *
 * Silent until now, and it mattered more than almost anything else on the
 * screen: a bay at altitude inflates every carry, and the app was comparing
 * those inflated numbers against sea-level tour targets.
 */
function ConditionsCard({ report }: { report: SessionReport }) {
  const c = report.conditions;
  const pct = (carryFactor(c) - 1) * 100;
  return (
    <section className="card-quiet conditions">
      <h3 className="panel-title">The air you hit in</h3>
      <div className="cond-row">
        {c.altitudeFeet !== null && (
          <Cell label="Altitude" value={Math.round(c.altitudeFeet).toLocaleString()} unit="ft" />
        )}
        {c.temperatureF !== null && (
          <Cell label="Temp" value={String(Math.round(c.temperatureF))} unit="°F" />
        )}
        {c.ball && <Cell label="Ball" value={c.ball} unit="" />}
        <Cell label="Carry effect" value={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`} unit="%" big />
      </div>
      <p className="panel-sub cond-note">
        {Math.abs(pct) < 1.5
          ? 'Close enough to sea level that no correction is worth making.'
          : `Your carries here run ${Math.abs(pct).toFixed(1)}% ${pct > 0 ? 'longer' : 'shorter'} `
            + 'than the same swing would produce at sea level. Carry targets below are scaled to '
            + 'match, and sessions from other venues are put back into common air before any '
            + 'comparison.'}
      </p>
    </section>
  );
}

/**
 * Percentiles against the player's own history.
 *
 * The reading a launch monitor app usually takes from a population database,
 * except the population is the player. That is both the only data that
 * actually exists — there is no public shot-level dataset worth benchmarking
 * against — and arguably the better comparison: "better than 68% of every
 * 7-iron you have hit" is a sentence you can act on.
 */
function PercentileCard({ rows }: { rows: SelfPercentile[] }) {
  return (
    <section className="card">
      <ul className="pct-list">
        {rows.map((r) => {
          const tone = r.percentile >= 66 ? 'good' : r.percentile >= 34 ? 'mid' : 'bad';
          return (
            <li key={r.metric}>
              <div className="pct-head">
                <strong>{r.label}</strong>
                <span>
                  {r.value}
                  {r.unit}
                </span>
              </div>
              <div className="pct-track">
                <div className={`pct-fill pct-${tone}`} style={{ width: `${r.percentile}%` }} />
                <span className="pct-mark" style={{ left: '50%' }} />
              </div>
              <em>{r.detail}</em>
            </li>
          );
        })}
      </ul>
      <p className="panel-sub cond-note">
        Measured against {rows[0]?.n ?? 0} of your own past shots with that club, all put into
        common air first. The line marks your usual.
      </p>
    </section>
  );
}

/** Recent form against the long run: a bad day, or a new normal. */
function FormCard({ form, windows }: { form: FormRead[]; windows: WindowProfile[] }) {
  const counted = windows.filter((w) => w.profile !== null);
  return (
    <section className="card">
      <ul className="form-list">
        {form.map((f) => (
          <li key={f.metric} className={`form-${f.verdict}`}>
            <div>
              <strong>{f.label}</strong>
              <span>{f.detail}</span>
            </div>
            <em>{f.verdict}</em>
          </li>
        ))}
      </ul>
      <p className="panel-sub cond-note">
        Built from{' '}
        {counted.map((w) => `${w.window.label} (${w.profile?.representativeCount ?? 0})`).join(', ')}
        , all put into common air first.
      </p>
    </section>
  );
}

function ClubCard({ profile: p, shots }: { profile: ClubProfile; shots: Shot[] }) {
  return (
    <section className="card club-card">
      <div className="club-card-head">
        <strong>{p.club}</strong>
        <span>
          {plural(p.shotCount, 'shot')}
          {p.mishitCount > 0 && <em className="mishits"> · {p.mishitCount} off</em>}
        </span>
      </div>
      <div className="club-figures">
        <Cell label="Carry" value={num(p.carry.median, 0)} unit="yds" big />
        <Cell
          label="Spread"
          value={p.carry.n > 2 ? `±${num(p.carry.mad, 0)}` : '—'}
          unit="yds"
          big
        />
        <Cell label="Club spd" value={num(p.clubSpeed.median, 1)} unit="mph" />
        <Cell label="Smash" value={num(p.smashFactor.median, 2)} unit="" />
        <Cell label="Spin" value={num(p.spinRate.median, 0)} unit="rpm" />
        <Cell label="Path" value={num(p.clubPath.median, 1)} unit="°" />
        <Cell label="Face/path" value={num(p.faceToPath.median, 1)} unit="°" />
        <Cell label="Attack" value={num(p.attackAngle.median, 1)} unit="°" />
      </div>
      <TrackManVerdict shots={shots} />
      {p.dispersion !== null && (
        <div className="club-chart">
          <DispersionChart profile={p} shots={shots} />
        </div>
      )}
    </section>
  );
}

/**
 * What TrackMan itself made of the same shots.
 *
 * The unit grades every shot against its own optimal model. Shown beside our
 * numbers rather than folded into them: where the two agree that is worth more
 * than either alone, and where they disagree that is the interesting part.
 */
function TrackManVerdict({ shots }: { shots: Shot[] }) {
  const idx = trackManIndices(shots);
  if (idx.smashIndex === null && idx.spinIndex === null) return null;
  return (
    <div className="tm-verdict">
      <span className="tm-label">TrackMan's own grade</span>
      <div>
        {idx.smashIndex !== null && (
          <span>
            Smash <strong>{Math.round(idx.smashIndex)}%</strong> of optimal
          </span>
        )}
        {idx.spinIndex !== null && (
          <span>
            Spin <strong>{Math.round(idx.spinIndex)}%</strong> of optimal
          </span>
        )}
      </div>
    </div>
  );
}

function Cell({
  label, value, unit, big = false,
}: {
  label: string;
  value: string;
  unit: string;
  big?: boolean;
}) {
  return (
    <div className={big ? 'club-cell club-cell-big' : 'club-cell'}>
      <span>{label}</span>
      <strong>
        {value}
        {unit && <i>{unit}</i>}
      </strong>
    </div>
  );
}

/**
 * Whether the six-minute-a-fortnight version of you is getting better.
 *
 * This is the only tab about the player rather than about a session or a
 * club: where the handicap sits, how often you practise, what has moved over
 * weeks, what milestones are banked. It used to be the thinnest tab in the app
 * while the Session tab carried the handicap, the streak and eighteen
 * milestone tiles below the shot-by-shot detail — a layout telling you the
 * information was in the wrong room.
 */
export function ProgressView({
  trends, sessionCount, windows, handicap, streak, achievements,
}: {
  trends: Trend[];
  sessionCount: number;
  windows: {
    windows: WindowProfile[]; form: FormRead[]; percentiles: SelfPercentile[];
  } | null;
  handicap: HandicapEstimate | null;
  streak: Streak;
  achievements: Achievement[];
}) {
  const hasForm = windows !== null && windows.form.length > 0;
  const hasPercentiles = windows !== null && windows.percentiles.length > 0;
  const significant = trends.filter((t) => t.significant);
  const rest = trends.filter((t) => !t.significant);

  return (
    <div className="stack">
      {(handicap || streak.totalDays > 0) && (
        <section className="card card-hero standing">
          <p className="eyebrow">Where you stand</p>
          {handicap && <HandicapPanel handicap={handicap} />}
          <StreakBadge streak={streak} />
        </section>
      )}

      {windows && hasForm && (
        <>
          <h2 className="section-head">
            Form
            <span>your last twenty against your all-time</span>
          </h2>
          <FormCard form={windows.form} windows={windows.windows} />
        </>
      )}

      {windows && hasPercentiles && (
        <>
          <h2 className="section-head">
            Against yourself
            <span>where this session sits in everything you have hit</span>
          </h2>
          <PercentileCard rows={windows.percentiles} />
        </>
      )}

      {sessionCount < 3 ? (
        <div className="card-quiet">
          <p className="quiet-title">
            Import {3 - sessionCount} more session{3 - sessionCount === 1 ? '' : 's'} for trend lines
          </p>
          <p className="quiet-body">
            Trend lines need at least three sessions with the same club before they mean anything.
            Two points is a line through noise, not a direction.
          </p>
        </div>
      ) : (
        <>
          {significant.length > 0 ? (
            <>
              <h2 className="section-head">
                Moving
                <span>further than your shot-to-shot noise</span>
              </h2>
              <div className="trend-grid">
                {significant.slice(0, 4).map((t) => (
                  <TrendChart key={`${t.club}-${t.metric}`} trend={t} />
                ))}
              </div>
              {significant.length > 4 && (
                <details className="more-findings">
                  <summary>Show {significant.length - 4} more that are moving</summary>
                  <div className="trend-grid">
                    {significant.slice(4).map((t) => (
                      <TrendChart key={`${t.club}-${t.metric}`} trend={t} />
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <p className="plan-note">
              Nothing has moved further than your shot-to-shot noise yet. That is not a failure —
              most real changes take several sessions to show up above the scatter.
            </p>
          )}
          {rest.length > 0 && (
            <details className="more-findings">
              <summary>{rest.length} holding steady</summary>
              <div className="trend-grid">
                {rest.map((t) => (
                  <TrendChart key={`${t.club}-${t.metric}`} trend={t} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {achievements.length > 0 && (
        <>
          <h2 className="section-head">
            Milestones
            <span>thresholds that mean something in golf</span>
          </h2>
          <section className="card">
            <AchievementPanel achievements={achievements} />
            <p className="panel-sub ach-foot">
              Nothing here rewards hitting more balls or one big swing.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
