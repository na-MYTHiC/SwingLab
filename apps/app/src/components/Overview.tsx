import type { SessionComparison, SessionReport, ShotSession } from '@swinglab/core';
import {
  ConsistencyBars, OptimalBands, ProgressionPanel, ScoreRing, ShapePanel, StrikePanel,
} from './Visuals.js';
import { DispersionChart } from './Charts.js';
import { shots as fmtShots } from '../format.js';

/**
 * The Overview.
 *
 * Answers, in order: how did I strike it, how repeatable was I, what shape
 * was the miss, and what is that costing. The priority list and the practice
 * plan follow from this — but a player wants to *see* the session before they
 * are told what to do about it, and a wall of findings skips that step.
 */
export function OverviewView({
  report, session, comparison,
}: {
  report: SessionReport;
  session: ShotSession;
  comparison: SessionComparison | null;
}) {
  const main = report.profiles.length
    ? [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0]
    : null;
  const mainShots = main ? session.shots.filter((s) => s.club === main.club) : [];

  return (
    <div className="overview">
      <section className="hero">
        <div className="hero-main">
          <span className="hero-eyebrow">On the table this session</span>
          <div className="hero-figure">
            <strong>{fmtShots(report.strokesAvailable)}</strong>
            <span>shots a round</span>
          </div>
          <p>
            An estimate of what the findings below are costing you, weighted so the fastest
            improvement comes first. Ranges flatter everyone — treat it as a direction, not a
            promise.
          </p>
        </div>
        {report.consistency && (
          <ScoreRing
            score={report.consistency.overall}
            label="Repeatability"
            sublabel={
              report.consistency.weakest
                ? `Weakest: ${report.consistency.weakest.label.toLowerCase()}`
                : undefined
            }
          />
        )}
      </section>

      {report.potential && (
        <section className="card callout">
          <h3>{report.potential.headline}</h3>
          <p>{report.potential.detail}</p>
          <div className="callout-figures">
            <Figure value={Math.round(report.potential.reliableCarry)} label="club off this" accent />
            <Figure value={Math.round(report.potential.medianCarry)} label="typical" />
            <Figure value={Math.round(report.potential.bestCarry)} label="your best" />
          </div>
        </section>
      )}

      {comparison && <DidItWork comparison={comparison} />}

      {report.optimals && (
        <section className="card">
          <h3 className="panel-title">
            Your optimal numbers — {report.optimals.club} at{' '}
            {report.optimals.clubSpeed.toFixed(0)} mph
          </h3>
          <OptimalBands optimals={report.optimals} />
        </section>
      )}

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
        <div className="split split-wide">
          <section className="card">
            <h3 className="panel-title">{main.club} shot pattern</h3>
            <DispersionChart profile={main} shots={mainShots} />
          </section>
          {report.consistency && (
            <section className="card">
              <h3 className="panel-title">What is repeatable, and what is not</h3>
              <p className="panel-sub">
                Worst first. Averages say what you usually do; these say whether you can be
                relied on to do it.
              </p>
              <ConsistencyBars consistency={report.consistency} />
            </section>
          )}
        </div>
      )}

      <section className="card">
        <h3 className="panel-title">How the session went</h3>
        <ProgressionPanel progression={report.progression} />
      </section>

      {report.dataNotes.length > 0 && (
        <section className="card notes">
          <h3 className="panel-title">About this data</h3>
          <ul>
            {report.dataNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Figure({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={accent ? 'figure figure-accent' : 'figure'}>
      <strong>{value}</strong>
      <span>{label}</span>
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
