import type {
  SessionComparison, SessionReport, ShotSession, TargetResult,
} from '@swinglab/core';
import { useState } from 'react';
import {
  ProgressionPanel, ScoreDetails, ScoreGrid, ShapePanel, StrikePanel,
} from './Visuals.js';
import { shareCard } from '../shareCard.js';
import { DispersionChart } from './Charts.js';
import { plural, shots } from '../format.js';

/**
 * The Session view.
 *
 * A verdict first, then what changed since last time, then what actually
 * happened out there. The first screen answers the one question a player has
 * on coming off the bay — how did that go, and what do I do about it — and
 * everything below is the evidence for it, in the order it is asked for.
 */
export function OverviewView({
  report, session, comparison, targets,
}: {
  report: SessionReport;
  session: ShotSession;
  comparison: SessionComparison | null;
  targets: { results: TargetResult[]; since: Date | null } | null;
}) {
  const main = report.profiles.length
    ? [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0]
    : null;
  const mainShots = main ? session.shots.filter((s) => s.club === main.club) : [];
  const top = report.priorities.find((p) => p.explainedBy === null) ?? null;
  const hasTargets = targets !== null && targets.results.length > 0;

  return (
    <div className="stack">
      <SessionHero report={report} session={session} top={top} />

      {(hasTargets || comparison) && (
        <SinceLastTime targets={hasTargets ? targets : null} comparison={comparison} />
      )}

      <h2 className="section-head">
        How it went
        <span>what actually happened out there</span>
      </h2>

      {main && (
        <section className="card">
          <h3 className="panel-title">{main.club} shot pattern</h3>
          <p className="panel-sub">
            Every shot you hit, and the ring that holds 95% of them.
          </p>
          <DispersionChart profile={main} shots={mainShots} />
          {report.greenRate !== null && <GreenRate rate={report.greenRate} club={main.club} />}
        </section>
      )}

      <section className="card strike-shape">
        <div>
          <h3 className="panel-title">How you struck it</h3>
          <StrikePanel strike={report.strike} />
        </div>
        <div>
          <h3 className="panel-title">Where it went</h3>
          <ShapePanel shape={report.shape} />
        </div>
      </section>

      <section className="card">
        <h3 className="panel-title">How the session went</h3>
        <ProgressionPanel progression={report.progression} />
      </section>

      {(report.discardedCount > 0 || report.dataNotes.length > 0) && (
        <details className="notes card-quiet">
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
 * The first screen.
 *
 * Everything a player needs from this session in one glance: what it was,
 * the score and grade, the six numbers behind it, and the single thing to work
 * on next. It carries no navigation. The tab bar is how you move between
 * views, and a button duplicating it is one more thing to read on a screen
 * trying to be scannable.
 */
function SessionHero({
  report, session, top,
}: {
  report: SessionReport;
  session: ShotSession;
  top: SessionReport['priorities'][number] | null;
}) {
  const [sharing, setSharing] = useState(false);
  const score = report.score;
  const tone = score ? (score.total >= 75 ? 'good' : score.total >= 55 ? 'mid' : 'bad') : 'brand';

  return (
    <section className={`card card-hero session-hero hero-${tone}`}>
      <div className="hero-top">
        <p className="eyebrow">
          {plural(report.shotCount, 'shot')} · {report.clubsSeen.join(', ') || 'no clubs read'}
        </p>
        {score && (
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
            {sharing ? 'Making image\u2026' : 'Save image'}
          </button>
        )}
      </div>

      {score && (
        <>
          <div className="hero-score">
            <div className="num-display hero-num">
              {score.total}
              <small>/ 100</small>
            </div>
            <div className={`grade grade-${score.grade}`} aria-label={`Grade ${score.grade}`}>
              {score.grade}
            </div>
          </div>
          <p className="hero-verdict">{score.verdict}</p>

          <ScoreGrid score={score} />

          <details className="hero-why">
            <summary>What is behind the {score.total}</summary>
            <ScoreDetails score={score} />
            {score.weakest && score.headroom > 0 && (
              <p className="score-headroom">
                <strong>+{score.headroom} points</strong> available from{' '}
                {score.weakest.label.toLowerCase()} alone — the rest of the score is already close to
                what it can be.
              </p>
            )}
          </details>
        </>
      )}

      {top && (
        <div className="hero-next">
          <p className="eyebrow eyebrow-action">Work on this next</p>
          <h3>{top.finding.title}</h3>
          <p>
            Worth about <strong>{shots(top.leverageStrokes)} shots a round</strong> and the highest
            leverage thing in this session. Fix has the detail; Practice has the plan.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Did last time's work land?
 *
 * Two questions that share a card because they share a moment — you have just
 * come back from the bay and want to know whether the hour counted. The
 * targets are the marks the last plan set; the comparison is everything that
 * moved. Each shows four rows and folds the rest, so a long list never pushes
 * the evidence for today's session off the screen.
 */
const ROWS_SHOWN = 4;

function SinceLastTime({
  targets, comparison,
}: {
  targets: { results: TargetResult[]; since: Date | null } | null;
  comparison: SessionComparison | null;
}) {
  const when = (d: Date | null) =>
    d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'last time';

  const measured = targets ? targets.results.filter((r) => r.met !== null) : [];
  const hit = measured.filter((r) => r.met).length;

  const targetRow = (r: TargetResult) => (
    <li key={r.target.id} className={r.met === null ? 'tg-skip' : r.met ? 'tg-hit' : 'tg-miss'}>
      <span className="tg-mark" aria-hidden="true">
        {r.met === null ? '\u2013' : r.met ? '\u2713' : '\u2717'}
      </span>
      <div>
        <strong>{r.target.label}</strong>
        <span>{r.verdict}</span>
      </div>
    </li>
  );

  return (
    <section className="card since">
      {targets && (
        <div className="since-block">
          <div className="since-head">
            <h3 className="panel-title">Your targets from {when(targets.since)}</h3>
            {measured.length > 0 && (
              <span className="diw-since">{hit} of {measured.length} hit</span>
            )}
          </div>
          <ul className="target-list">{targets.results.slice(0, ROWS_SHOWN).map(targetRow)}</ul>
          {targets.results.length > ROWS_SHOWN && (
            <details className="rows-more">
              <summary>Show {targets.results.length - ROWS_SHOWN} more</summary>
              <ul className="target-list">{targets.results.slice(ROWS_SHOWN).map(targetRow)}</ul>
            </details>
          )}
        </div>
      )}

      {comparison && (
        <div className="since-block">
          <div className="since-head">
            <h3 className="panel-title">Did the work show up?</h3>
            <span className="diw-since">{comparison.club} vs {when(comparison.previousDate)}</span>
          </div>
          <p className="diw-headline">{comparison.headline}</p>
          {comparison.meaningful.length > 0 && (
            <>
              <ul className="diw-list">
                {comparison.meaningful.slice(0, ROWS_SHOWN).map((d) => (
                  <ChangeRow key={d.metric} d={d} />
                ))}
              </ul>
              {comparison.meaningful.length > ROWS_SHOWN && (
                <details className="rows-more">
                  <summary>Show {comparison.meaningful.length - ROWS_SHOWN} more</summary>
                  <ul className="diw-list">
                    {comparison.meaningful.slice(ROWS_SHOWN).map((d) => (
                      <ChangeRow key={d.metric} d={d} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ChangeRow({ d }: { d: SessionComparison['meaningful'][number] }) {
  const dp = d.unit === '' ? 3 : d.unit === 'rpm' || d.unit === 'yds' ? 0 : 1;
  /*
   * Three states, not two. `improved` is null for a metric that moved without
   * that being good or bad news — carry is the one — and null is falsy, so a
   * plain ternary quietly painted it red and labelled it "worse", which is the
   * opposite of the point.
   */
  const tone = d.improved === true ? 'diw-up' : d.improved === false ? 'diw-down' : 'diw-flat';
  const mark = d.improved === true ? '\u25b2' : d.improved === false ? '\u25bc' : '\u2022';
  const verdict = d.improved === true ? 'better' : d.improved === false ? 'worse' : 'changed';
  return (
    <li className={tone}>
      <span className="diw-arrow" aria-hidden="true">{mark}</span>
      <span className="diw-metric">{d.label}</span>
      <span className="diw-change">
        {d.previous.toFixed(dp)} {'\u2192'} <strong>{d.current.toFixed(dp)}{d.unit}</strong>
      </span>
      <span className="diw-verdict">{verdict}</span>
    </li>
  );
}

/**
 * The pattern, turned into the question a golfer actually asks.
 *
 * A width in yards is an abstraction; "this holds a green two times in five"
 * is not. The caveat is not optional — it assumes a flat lie, no wind and
 * aiming at the middle, which is what a bay gives you and a golf course
 * almost never does.
 */
function GreenRate({ rate, club }: { rate: number; club: string }) {
  const pct = Math.round(rate * 100);
  const tone = pct >= 65 ? 'good' : pct >= 40 ? 'mid' : 'bad';
  return (
    <div className={`green-rate green-${tone}`}>
      <strong>{pct}%</strong>
      <div>
        <b>of these {club}s would hold a green</b>
        <span>
          An average green is about 5,500 sq ft. Off a flat lie, no wind, aimed at the middle —
          so treat this as your ceiling rather than as a greens-in-regulation number.
        </span>
      </div>
    </div>
  );
}
