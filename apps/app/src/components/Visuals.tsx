import type {
  Achievement, ConsistencyScore, ClubConsistency, OptimalComparison, Progression, SessionReport,
  SessionScore, ShapeBreakdown, StrikeBreakdown, Streak,
} from '@swinglab/core';
import { num } from '../format.js';

/**
 * The visual language of the app.
 *
 * A launch monitor already gives the player a table of numbers, and a second
 * table is not worth opening. What these do is make a pattern visible at a
 * glance — the shape of a session, how wide a miss really is, which single
 * number is holding everything else back — so the reading happens before any
 * of the text is read.
 */

/** A ring gauge. Reads as a single verdict before any number is parsed. */
export function ScoreRing({
  score, label, sublabel, size = 132,
}: { score: number; label: string; sublabel?: string; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const tone = score >= 68 ? 'good' : score >= 45 ? 'mid' : 'bad';

  return (
    <div className={`ring ring-${tone}`} style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
           aria-label={`${label}: ${score} out of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          className="ring-fill" strokeWidth={stroke}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="48%" className="ring-score" textAnchor="middle" dominantBaseline="middle">
          {score}
        </text>
        <text x="50%" y="66%" className="ring-unit" textAnchor="middle">/ 100</text>
      </svg>
      <div className="ring-label">
        <strong>{label}</strong>
        {sublabel && <span>{sublabel}</span>}
      </div>
    </div>
  );
}

/** Consistency bars, worst first — the ordering is the message. */
export function ConsistencyBars({ consistency }: { consistency: ClubConsistency }) {
  return (
    <ul className="bars">
      {consistency.scores.map((s) => (
        <ConsistencyBar key={s.metric} score={s} />
      ))}
    </ul>
  );
}

function ConsistencyBar({ score }: { score: ConsistencyScore }) {
  const tone = score.score >= 68 ? 'good' : score.score >= 45 ? 'mid' : 'bad';
  return (
    <li className={`bar bar-${tone}`}>
      <div className="bar-head">
        <span className="bar-label">{score.label}</span>
        <span className="bar-spread">
          ±{num(score.spread, score.unit === 'rpm' ? 0 : score.unit === '' ? 3 : 1)}
          {score.unit}
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${score.score}%` }} />
      </div>
      <p className="bar-so-what">{score.soWhat}</p>
    </li>
  );
}

/** A segmented bar. One row, sorted, with the dominant band obvious. */
export function SegmentBar({
  segments, caption,
}: {
  segments: { label: string; share: number; tone: string; count: number }[];
  caption?: string;
}) {
  return (
    <div className="segbar">
      <div className="segbar-track">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`segbar-part tone-${s.tone}`}
            style={{ width: `${Math.max(s.share * 100, 2)}%` }}
            title={`${s.label}: ${s.count} (${Math.round(s.share * 100)}%)`}
          />
        ))}
      </div>
      <ul className="segbar-key">
        {segments.map((s) => (
          <li key={s.label}>
            <span className={`dot-key tone-${s.tone}`} />
            {s.label}
            <strong>{Math.round(s.share * 100)}%</strong>
          </li>
        ))}
      </ul>
      {caption && <p className="segbar-caption">{caption}</p>}
    </div>
  );
}

const STRIKE_TONE: Record<string, string> = {
  flush: 'best', solid: 'good', thin: 'bad', heavy: 'bad', 'off-centre': 'mid',
};

export function StrikePanel({ strike }: { strike: StrikeBreakdown }) {
  if (strike.total === 0) return null;
  const segments = strike.counts.map((c) => ({
    label: c.label, share: c.share, count: c.count, tone: STRIKE_TONE[c.klass] ?? 'mid',
  }));
  return (
    <SegmentBar
      segments={segments}
      caption={`${Math.round(strike.qualityShare * 100)}% of your strikes were solid or better, judged against your own baseline rather than anyone else's.`}
    />
  );
}

const SHAPE_TONE: Record<string, string> = {
  Straight: 'best', Draw: 'good', Fade: 'good',
  Pull: 'mid', Push: 'mid', 'Pull fade': 'mid', 'Push draw': 'mid',
  'Pull hook': 'bad', 'Push slice': 'bad',
};

export function ShapePanel({ shape }: { shape: ShapeBreakdown }) {
  if (shape.total === 0) return null;
  const segments = shape.counts.map((c) => ({
    label: c.label, share: c.share, count: c.count, tone: SHAPE_TONE[c.label] ?? 'mid',
  }));
  return (
    <SegmentBar
      segments={segments}
      caption={
        shape.dominant
          ? `Your miss has a shape: ${shape.dominant.label.toLowerCase()} on ${Math.round(shape.dominant.share * 100)}% of shots. A pattern is far easier to fix than randomness.`
          : `No single shape dominates — it takes ${shape.spreadOfShapes} of them to account for most of your session. That usually points at strike rather than at the face.`
      }
    />
  );
}

/** The arc of the session, in thirds. */
export function ProgressionPanel({ progression }: { progression: Progression }) {
  if (progression.thirds.length === 0) return <p className="muted">{progression.detail}</p>;

  const carries = progression.thirds.map((t) => t.carry);
  const min = Math.min(...carries);
  const max = Math.max(...carries);
  const span = Math.max(max - min, 6);
  const tone =
    progression.verdict === 'faded' ? 'bad'
      : progression.verdict === 'warmed-up' ? 'mid' : 'good';

  return (
    <div className={`progression prog-${tone}`}>
      <div className="prog-bars">
        {progression.thirds.map((t) => {
          const height = 30 + ((t.carry - min) / span) * 70;
          return (
            <div key={t.label} className="prog-col">
              <span className="prog-value">{Math.round(t.carry)}</span>
              <div className="prog-bar" style={{ height: `${height}%` }} />
              <span className="prog-label">{t.label}</span>
            </div>
          );
        })}
      </div>
      <div className="prog-text">
        <h4>{progression.headline}</h4>
        <p>{progression.detail}</p>
      </div>
    </div>
  );
}

/**
 * Your numbers against your own targets.
 *
 * The band is the point. A single "target" number invites chasing a decimal
 * that does not matter; showing the acceptable range makes it obvious when a
 * number is fine and when it is genuinely outside where it should be — and
 * the marker's position inside the band says which edge you are drifting
 * towards, which a green tick never would.
 */
export function OptimalBands({
  optimals,
}: {
  optimals: NonNullable<SessionReport['optimals']>;
}) {
  return (
    <>
      <p className="panel-sub">
        Your targets, not tour's — interpolated between the men's and women's tour averages using
        your measured {optimals.clubSpeed.toFixed(0)} mph. The two tours have each optimised for
        their own speed, and they differ in ways no scaling law predicts: slower swings hit further
        up on the driver and launch the ball higher. A player in between should be aiming in
        between.
      </p>
      <ul className="opt-list">
        {optimals.comparisons.map((c) => (
          <OptimalBand key={c.window.metric} comparison={c} />
        ))}
      </ul>
    </>
  );
}

function OptimalBand({ comparison }: { comparison: OptimalComparison }) {
  const { window: w, actual, status } = comparison;
  const dp = w.unit === 'rpm' || w.unit === 'yds' || w.unit === 'mph' ? 0 : w.unit === '' ? 3 : 1;

  // Show a span half again as wide as the band, so a value outside it still
  // lands on the track instead of being clamped to the end and looking fine.
  const half = (w.max - w.min) / 2 || 1;
  const lo = w.min - half;
  const hi = w.max + half;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

  return (
    <li className={`opt opt-${status}`}>
      <div className="opt-head">
        <span className="opt-label">
          {w.label}
          {w.basis === 'extrapolated' && (
            <em title={w.why}>outside tour range — less certain</em>
          )}
        </span>
        <span className="opt-values">
          <strong>{actual.toFixed(dp)}{w.unit}</strong>
          <span>target {w.target.toFixed(dp)}{w.unit}</span>
        </span>
      </div>
      <div className="opt-track">
        <div
          className="opt-band"
          style={{ left: `${pct(w.min)}%`, width: `${pct(w.max) - pct(w.min)}%` }}
        />
        <div className="opt-target" style={{ left: `${pct(w.target)}%` }} />
        {Number.isFinite(actual) && (
          <div className="opt-marker" style={{ left: `${pct(actual)}%` }} />
        )}
      </div>
      <p className="opt-why">{w.why}</p>
    </li>
  );
}

/** The session score: a grade, the components behind it, and where to gain. */
export function ScorePanel({ score }: { score: SessionScore }) {
  const tone = score.total >= 75 ? 'good' : score.total >= 55 ? 'mid' : 'bad';

  return (
    <div className={`score score-${tone}`}>
      <div className="score-head">
        <div className="score-figure">
          <strong>{score.total}</strong>
          <span>/ 100</span>
        </div>
        <div className={`grade grade-${score.grade}`}>{score.grade}</div>
      </div>
      <p className="score-verdict">{score.verdict}</p>

      <ul className="score-components">
        {score.components.map((c) => {
          const t = c.score >= 68 ? 'good' : c.score >= 45 ? 'mid' : 'bad';
          return (
            <li key={c.id} className={`sc sc-${t}`}>
              <div className="sc-head">
                <span>{c.label}</span>
                <strong>{c.score}</strong>
              </div>
              <div className="sc-track">
                <div className="sc-fill" style={{ width: `${c.score}%` }} />
              </div>
              <p>{c.detail}</p>
            </li>
          );
        })}
      </ul>

      {score.weakest && score.headroom > 0 && (
        <p className="score-headroom">
          <strong>+{score.headroom} points</strong> available from{' '}
          {score.weakest.label.toLowerCase()} alone — the rest of the score is already close to
          what it can be.
        </p>
      )}
    </div>
  );
}

/** Achievements: what was crossed, and what is nearly in reach. */
export function AchievementPanel({ achievements }: { achievements: Achievement[] }) {
  if (achievements.length === 0) return null;
  return (
    <ul className="achievements">
      {achievements.map((a) => (
        <li key={a.id} className={a.earned ? `ach ach-earned ach-${a.tier}` : 'ach'}>
          <div className="ach-head">
            <span className="ach-name">
              <i className={`ach-dot ach-dot-${a.tier}`} aria-hidden="true" />
              {a.name}
            </span>
            <span className="ach-tier">{a.earned ? 'earned' : `${Math.round(a.progress * 100)}%`}</span>
          </div>
          {!a.earned && (
            <div className="ach-track">
              <div className="ach-fill" style={{ width: `${a.progress * 100}%` }} />
            </div>
          )}
          <p className="ach-req">{a.requirement}</p>
          <p className="ach-meaning">{a.meaning}</p>
        </li>
      ))}
    </ul>
  );
}

/** Practice streak, counted in days because that is what a habit is. */
export function StreakBadge({ streak }: { streak: Streak }) {
  if (streak.totalDays === 0) return null;
  return (
    <div className="streak">
      <div className="streak-figure">
        <strong>{streak.current}</strong>
        <span>day{streak.current === 1 ? '' : 's'}</span>
      </div>
      <div className="streak-detail">
        <strong>{streak.current > 0 ? 'Current streak' : 'Streak broken'}</strong>
        <span>
          Best {streak.best} · {streak.totalDays} day{streak.totalDays === 1 ? '' : 's'} practised
        </span>
      </div>
    </div>
  );
}
