import type {
  Prioritised, SessionReport, Prescription, ClubProfile, Shot, ShotSession, Trend,
  PracticeDuration, FormRead, WindowProfile,
} from '@swinglab/core';
import { DispersionChart, TrendChart } from './Charts.js';
import { ConsistencyBars, OptimalBands } from './Visuals.js';
import { carryFactor, trackManIndices } from '@swinglab/core';
import { minutes, num, shots, speedLabel } from '../format.js';

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

  return (
    <div className="stack">
      <div className="headline">
        <div className="headline-figure">
          <strong>{shots(report.strokesAvailable)}</strong>
          <span>shots a round on the table</span>
        </div>
        <p>
          Estimated from everything found in this session. Work down the list — the top item is
          whichever produces the biggest improvement soonest, not simply the worst number.
        </p>
      </div>

      {first && (
        <>
          <h2 className="section-head">
            Start here
            <span>the one thing worth an hour</span>
          </h2>
          <PriorityCard
            entry={first}
            rank={1}
            lead
            symptoms={symptomsOf(first)}
          />
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
                symptoms={symptomsOf(root)}
              />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function PriorityCard({
  entry, rank, symptoms, lead = false,
}: {
  entry: Prioritised;
  rank: number;
  symptoms: Prioritised[];
  lead?: boolean;
}) {
  const { finding, impact, leverageStrokes } = entry;
  const unlocks = leverageStrokes - impact.courseStrokes;
  const Wrapper = lead ? 'div' : 'li';

  return (
    <Wrapper className={`card priority sev-${finding.severity}${lead ? ' priority-lead' : ''}`}>
      <div className="priority-head">
        <span className="priority-rank">{rank}</span>
        <div className="tags">
          <span className={`tag speed-${impact.speed}`}>{speedLabel(impact.speed)}</span>
          {finding.confidence === 'low' && <span className="tag tag-quiet">early signal</span>}
        </div>
      </div>

      <h3>{finding.title}</h3>

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
      <div className="slot-picker" role="group" aria-label="Session length">
        <span className="slot-lead">Booked for</span>
        <div className="slot-group">
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
        <p className="slot-note">
          Bays go by the hour, so the plan fills the slot exactly — {practice.blocks.length} blocks,{' '}
          {minutes(practice.totalMinutes)}.
        </p>
      </div>

      <p className="plan-note">
        {practice.note ??
          'Built from root causes only. Symptoms are left out on purpose — they are handled by the block that fixes what is causing them.'}
      </p>

      <ol className="practice-list">
        {practice.blocks.map((block, i) => (
          <PracticeBlock
            key={block.id}
            block={block}
            step={i + 1}
            startsAt={starts[i] ?? 0}
            openByDefault={i === firstWithDrills}
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
      <div className="block-head">
        <span className="block-clock">
          <b>{clock(startsAt)}</b>
          <i>{block.minutes} min</i>
        </span>
        <span className="block-step">Block {step}</span>
      </div>

      <h3>{block.title}</h3>

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
export function ClubsView({
  report, session, windows,
}: {
  report: SessionReport;
  session: ShotSession;
  windows: { windows: WindowProfile[]; form: FormRead[] } | null;
}) {
  return (
    <div className="stack">
      {report.conditions.raw && <ConditionsCard report={report} />}

      {windows && windows.form.length > 0 && (
        <>
          <h2 className="section-head">
            Form
            <span>your last twenty against your all-time</span>
          </h2>
          <FormCard form={windows.form} windows={windows.windows} />
        </>
      )}

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

      <div className="club-cards">
        {report.profiles.map((p) => (
          <ClubCard
            key={p.club}
            profile={p}
            shots={session.shots.filter((s) => s.club === p.club)}
          />
        ))}
      </div>

      {report.optimals && (
        <>
          <h2 className="section-head">
            Where these should be
            <span>
              {report.optimals.club} at {report.optimals.clubSpeed.toFixed(0)} mph
            </span>
          </h2>
          <section className="card">
            <OptimalBands optimals={report.optimals} />
          </section>
        </>
      )}

      {report.consistency && (
        <>
          <h2 className="section-head">
            What you can repeat
            <span>worst first</span>
          </h2>
          <section className="card">
            <p className="panel-sub">
              Averages say what you usually do; these say whether you can be relied on to do it.
            </p>
            <ConsistencyBars consistency={report.consistency} />
          </section>
        </>
      )}
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
    <section className="card conditions">
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
          {p.shotCount} shots
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

/** The Trends view — the only thing a single session cannot tell you. */
export function TrendsView({ trends, sessionCount }: { trends: Trend[]; sessionCount: number }) {
  if (sessionCount < 3) {
    return (
      <div className="empty-state">
        <h2>Import {3 - sessionCount} more session{3 - sessionCount === 1 ? '' : 's'}</h2>
        <p>
          Trends need at least three sessions with the same club before they mean anything. Two
          points is a line through noise, not a direction.
        </p>
      </div>
    );
  }

  const significant = trends.filter((t) => t.significant);
  const rest = trends.filter((t) => !t.significant);

  return (
    <div className="stack">
      {significant.length === 0 && (
        <p className="plan-note">
          Nothing has moved further than your shot-to-shot noise yet. That is not a failure — most
          real changes take several sessions to show up above the scatter.
        </p>
      )}
      {significant.length > 0 && (
        <h2 className="section-head">
          Moving
          <span>further than your shot-to-shot noise</span>
        </h2>
      )}
      <div className="trend-grid">
        {significant.map((t) => (
          <TrendChart key={`${t.club}-${t.metric}`} trend={t} />
        ))}
      </div>
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
    </div>
  );
}
