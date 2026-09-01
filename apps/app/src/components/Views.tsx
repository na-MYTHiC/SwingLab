import type {
  Prioritised, SessionReport, Prescription, ClubProfile, Trend, PracticeDuration,
} from '@swinglab/core';
import { DispersionChart, TrendChart } from './Charts.js';
import { minutes, num, shots, speedLabel } from '../format.js';

/**
 * The Priority view — the answer to "what do I do next".
 *
 * Ordered by leverage rather than severity, so the top card is whatever
 * produces the fastest real improvement. Symptoms are nested under the cause
 * that explains them, because presenting them as separate work is how a
 * practice session gets spent fixing one fault three times.
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

  return (
    <>
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

      <ol className="priority-list">
        {roots.map((root, index) => (
          <PriorityCard
            key={`${root.finding.id}-${root.finding.club}`}
            entry={root}
            rank={index + 1}
            symptoms={report.priorities.filter(
              (p) => p.explainedBy === `${root.finding.id}::${root.finding.club ?? 'bag'}`,
            )}
          />
        ))}
      </ol>
    </>
  );
}

function PriorityCard({
  entry,
  rank,
  symptoms,
}: {
  entry: Prioritised;
  rank: number;
  symptoms: Prioritised[];
}) {
  const { finding, impact, leverageStrokes } = entry;
  const unlocks = leverageStrokes - impact.courseStrokes;

  return (
    <li className={`card priority sev-${finding.severity}`}>
      <div className="priority-rank">{rank}</div>
      <div className="priority-body">
        <div className="card-head">
          <h3>{finding.title}</h3>
          <div className="tags">
            <span className={`tag speed-${impact.speed}`}>{speedLabel(impact.speed)}</span>
            {finding.confidence === 'low' && <span className="tag tag-quiet">early signal</span>}
          </div>
        </div>

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
      </div>
    </li>
  );
}

/** The Practice view — a session laid out in real TrackMan modes. */
export function PracticeView({
  report, duration, onDuration,
}: {
  report: SessionReport;
  duration: PracticeDuration;
  onDuration: (d: PracticeDuration) => void;
}) {
  const { practice } = report;

  return (
    <>
      <div className="slot-picker" role="group" aria-label="Session length">
        <span>Book a</span>
        {([60, 120] as PracticeDuration[]).map((d) => (
          <button
            key={d}
            className={d === duration ? 'slot slot-on' : 'slot'}
            onClick={() => onDuration(d)}
          >
            {d === 60 ? '1 hour' : '2 hours'}
          </button>
        ))}
        <span className="slot-note">Bays go by the hour, so the plan fills the slot exactly.</span>
      </div>

      <div className="headline">
        <div className="headline-figure">
          <strong>{minutes(practice.totalMinutes)}</strong>
          <span>next session</span>
        </div>
        <p>
          {practice.note ??
            'Built from root causes only. Symptoms are left out on purpose — they are handled by the block that fixes what is causing them.'}
        </p>
      </div>

      <ol className="practice-list">
        {practice.blocks.map((block, i) => (
          <PracticeBlock key={block.id} block={block} step={i + 1} />
        ))}
      </ol>
    </>
  );
}

function PracticeBlock({ block, step }: { block: Prescription; step: number }) {
  return (
    <li className="card practice-block">
      <div className="block-head">
        <div>
          <span className="block-step">Block {step}</span>
          <h3>{block.title}</h3>
        </div>
        <span className="block-minutes">{block.minutes}m</span>
      </div>

      <div className="mode-chip">
        <strong>{block.mode.name}</strong>
        <span>{block.mode.location}</span>
      </div>

      <p className="card-detail">{block.rationale}</p>

      <div className="block-grid">
        <div>
          <h4>Set it up</h4>
          <ol className="setup">
            {block.setup.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>What good looks like</h4>
          <p className="success">{block.success}</p>
          {block.drills.length > 0 && (
            <>
              <h4>Drills for this block</h4>
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
                    {d.feelsWorse && (
                      <p className="drill-warn">
                        Expect this to look worse while you do it. Variable practice lowers
                        performance in the moment and raises it on retention — that dip is the
                        drill working, not failing.
                      </p>
                    )}
                    <em>{d.dose}</em>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** The Clubs view — the numbers, plus the picture that explains them. */
export function ClubsView({ report }: { report: SessionReport }) {
  const plottable = report.profiles.filter((p) => p.dispersion !== null);

  return (
    <>
      <div className="table-scroll card">
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

      {plottable.length > 0 && (
        <div className="chart-grid">
          {plottable.map((p) => (
            <section key={p.club} className="card">
              <h3 className="chart-title">{p.club} shot pattern</h3>
              <DispersionChart profile={p} />
            </section>
          ))}
        </div>
      )}
    </>
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
    <>
      {significant.length === 0 && (
        <div className="headline">
          <p>
            Nothing has moved further than your shot-to-shot noise yet. That is not a failure —
            most real changes take several sessions to show up above the scatter.
          </p>
        </div>
      )}
      <div className="trend-grid">
        {[...significant, ...rest].map((t) => (
          <TrendChart key={`${t.club}-${t.metric}`} trend={t} />
        ))}
      </div>
    </>
  );
}
