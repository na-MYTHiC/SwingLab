import type { SessionComparison, SessionReport, ShotSession, Streak } from '@swinglab/core';
import { useState } from 'react';
import {
  AchievementPanel, HandicapPanel, ProgressionPanel, ScorePanel, ShapePanel, StreakBadge,
  StrikePanel,
} from './Visuals.js';
import { shareCard } from '../shareCard.js';
import { DispersionChart } from './Charts.js';
import { shots } from '../format.js';

/**
 * The Session view.
 *
 * Read top to bottom it answers the questions in the order a player asks
 * them: how did I do, what should I do about it, did last time's work land,
 * what actually happened out there, where does that put me — and only then
 * the reference numbers. Anything that is looked up rather than read is
 * pushed below the things that are read every single time.
 */
export function OverviewView({
  report, session, comparison, streak,
}: {
  report: SessionReport;
  session: ShotSession;
  comparison: SessionComparison | null;
  streak: Streak;
}) {
  const [sharing, setSharing] = useState(false);
  const main = report.profiles.length
    ? [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0]
    : null;
  const mainShots = main ? session.shots.filter((s) => s.club === main.club) : [];
  const top = report.priorities.find((p) => p.explainedBy === null) ?? null;

  return (
    <div className="stack">
      {report.score && (
        <section className="card score-card">
          <div className="score-card-head">
            <h3 className="panel-title">This session</h3>
            <button
              className="share-btn"
              disabled={sharing}
              onClick={async () => {
                setSharing(true);
                try {
                  await shareCard(report, session.startedAt, session.shots);
                } finally {
                  setSharing(false);
                }
              }}
            >
              {sharing ? 'Making image…' : 'Save image'}
            </button>
          </div>
          <ScorePanel score={report.score} />
        </section>
      )}

      {/*
        Names the highest-leverage fault so the score is not a verdict with no
        next move. It does not link anywhere: the bottom bar is how you move
        between views, and a button that duplicates it is one more thing to
        read on a screen that is trying to be scannable.
      */}
      {top && (
        <section className="card next-up">
          <span className="next-eyebrow">Work on this next</span>
          <h3>{top.finding.title}</h3>
          <p>
            Worth about <strong>{shots(top.leverageStrokes)} shots a round</strong> and the highest
            leverage thing in this session. Fix has the detail; Practice has the plan.
          </p>
        </section>
      )}

      {comparison && <DidItWork comparison={comparison} />}

      <div className="split">
        <section className="card">
          <h3 className="panel-title">How you struck it</h3>
          <StrikePanel strike={report.strike} />
        </section>
        <section className="card">
          <h3 className="panel-title">Where it went</h3>
          <ShapePanel shape={report.shape} />
        </section>
      </div>

      {main && (
        <section className="card">
          <h3 className="panel-title">{main.club} shot pattern</h3>
          <p className="panel-sub">
            Every shot you hit, and the ring that holds 95% of them.
          </p>
          <DispersionChart profile={main} shots={mainShots} />
        </section>
      )}

      <section className="card">
        <h3 className="panel-title">How the session went</h3>
        <ProgressionPanel progression={report.progression} />
      </section>

      {/*
        The player, rather than the session. These are the numbers that make
        somebody open the app on a day they did not practise, so they sit
        together and away from the shot-by-shot detail above.
      */}
      {(report.handicap || streak.totalDays > 0 || report.achievements.length > 0) && (
        <section className="card">
          <h3 className="panel-title">Where you stand</h3>
          {report.handicap && <HandicapPanel handicap={report.handicap} />}
          <StreakBadge streak={streak} />
          {report.achievements.length > 0 && (
            <>
              <h4 className="block-sub">Milestones</h4>
              <p className="panel-sub">
                Thresholds that mean something in golf. Nothing here rewards hitting more balls or
                one big swing — those are easy to farm and neither makes anybody better.
              </p>
              <AchievementPanel achievements={report.achievements} />
            </>
          )}
        </section>
      )}

      {(report.discardedCount > 0 || report.dataNotes.length > 0) && (
        <details className="notes">
          <summary>About this data</summary>
          <ul>
            {report.discardedCount > 0 && (
              <li>
                {report.discardedCount} shot{report.discardedCount === 1 ? '' : 's'} thrown out
                entirely — tops or shanks that travelled a fraction of this club's normal distance.
                There is nothing to learn from those, so they are excluded from every number above
                rather than dragging your averages down.
              </li>
            )}
            {report.dataNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Whether the last session's work showed up in this one.
 *
 * The loop almost every launch monitor tool leaves open: they measure you,
 * some tell you what to practise, and then nothing ever connects the two. A
 * player never finds out whether the hour moved anything, which is the one
 * piece of feedback that makes practice worth repeating.
 */
function DidItWork({ comparison }: { comparison: SessionComparison }) {
  const since = comparison.previousDate
    ? comparison.previousDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'last time';

  return (
    <section className="card diw">
      <div className="diw-head">
        <h3 className="panel-title">Did the work show up?</h3>
        <span className="diw-since">{comparison.club} vs {since}</span>
      </div>
      <p className="diw-headline">{comparison.headline}</p>

      {comparison.meaningful.length > 0 && (
        <ul className="diw-list">
          {comparison.meaningful.map((d) => {
            const dp = d.unit === '' ? 3 : d.unit === 'rpm' || d.unit === 'yds' ? 0 : 1;
            return (
              <li key={d.metric} className={d.improved ? 'diw-up' : 'diw-down'}>
                <span className="diw-arrow" aria-hidden="true">{d.improved ? '▲' : '▼'}</span>
                <span className="diw-metric">{d.label}</span>
                <span className="diw-change">
                  {d.previous.toFixed(dp)} → <strong>{d.current.toFixed(dp)}{d.unit}</strong>
                </span>
                <span className="diw-verdict">{d.improved ? 'better' : 'worse'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
