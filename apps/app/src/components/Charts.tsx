import type { ClubProfile, Shot, Trend } from '@swinglab/core';
import { num } from '../format.js';

/**
 * Inline SVG charts.
 *
 * No charting library: these are two specific pictures, each about eighty
 * lines, and pulling in a general-purpose library would add more bytes and
 * more configuration than drawing them directly. It also keeps the app
 * dependency-light, which matters when the whole thing has to stay free to
 * run and host.
 */

/**
 * Shot pattern: where the ball actually finished, relative to the target
 * line. The single most useful picture in golf data — a player who sees
 * their pattern is left and short understands it faster than any table.
 */
export function DispersionChart({
  profile, shots = [],
}: { profile: ClubProfile; shots?: Shot[] }) {
  const d = profile.dispersion;
  if (!d || !Number.isFinite(d.centreCarry)) {
    return <p className="chart-empty">Not enough shots with a carry and side reading to plot.</p>;
  }

  /*
   * A club played to several targets needs a different picture.
   *
   * In a Combine the same wedge goes to 60 and 70 yards, so plotting absolute
   * carry draws a pattern 30 yards deep and captions it as scatter — a chart
   * that makes a player look wildly inconsistent for following the protocol.
   * Where a target exists, the honest depth is the error against it.
   */
  const multiTarget = profile.distinctTargets > 1 && profile.carryError.n >= 3;
  const depthSpread = multiTarget ? 4 * profile.carryError.mad : d.depth;
  const depthCentre = multiTarget ? profile.carryError.median : d.centreCarry;

  const width = 320;
  const height = 400;
  const padX = 30;
  const padY = 30;

  /*
   * The plotted points, computed before the axes, because the axes have to
   * contain them.
   *
   * Plot every shot, not only the summary ellipse. The ellipse says how wide
   * the pattern is; the dots say what it is made of — whether the width comes
   * from a steady bias or from two good shots and one wild one. That
   * distinction changes the advice, and it is invisible in any summary
   * statistic.
   */
  const plotted = shots
    .filter((s) => s.carry !== null && s.side !== null)
    .map((s) => ({
      shot: s,
      carryValue: multiTarget && s.targetDistance !== null
        ? (s.carry as number) - s.targetDistance
        : (s.carry as number),
      side: s.side as number,
      mishit: s.flags.includes('mishit'),
    }))
    .filter((p) => Number.isFinite(p.carryValue));

  /*
   * Size the axes to the widest of the ellipse and the actual shots.
   *
   * Scaling to the ellipse alone drew every shot outside it beyond the edge of
   * the plot, and on a wide pattern that put dots off the side of the phone
   * entirely. The outliers are the most informative marks on the chart — one
   * ball fifty yards right is the whole story of a session — so the box grows
   * to hold them rather than cropping them away.
   */
  const sideReach = plotted.reduce((m, p) => Math.max(m, Math.abs(p.side)), 0);
  const halfWidth = Math.max(15, d.width / 2 + 8, sideReach + 6);

  const carries = plotted.map((p) => p.carryValue);
  const lowShot = carries.length > 0 ? Math.min(...carries) : depthCentre;
  const highShot = carries.length > 0 ? Math.max(...carries) : depthCentre;
  const depth = Math.max(20, depthSpread + 14);
  const nearCarry = Math.min(depthCentre - depth / 2, lowShot - 6);
  const farCarry = Math.max(depthCentre + depth / 2, highShot + 6);

  const x = (side: number) =>
    padX + ((side + halfWidth) / (halfWidth * 2)) * (width - padX * 2);
  const y = (carry: number) =>
    height - padY - ((carry - nearCarry) / (farCarry - nearCarry)) * (height - padY * 2);

  const rx = Math.max(6, (d.width / 2 / halfWidth) * ((width - padX * 2) / 2));
  const ry = Math.max(6, (depthSpread / 2 / (farCarry - nearCarry)) * (height - padY * 2));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Shot dispersion pattern">
        <defs>
          <radialGradient id="patternFill" cx="50%" cy="50%">
            <stop offset="0%" className="ellipse-core" />
            <stop offset="100%" className="ellipse-edge" />
          </radialGradient>
        </defs>

        {/* Distance bands, so depth is readable without reading the axis. */}
        {[0.25, 0.5, 0.75].map((t) => {
          const carry = nearCarry + (farCarry - nearCarry) * t;
          return (
            <line key={t} x1={padX} y1={y(carry)} x2={width - padX} y2={y(carry)}
                  className="grid-line" />
          );
        })}
        <text x={4} y={y(farCarry) + 10} className="axis-text">{Math.round(farCarry)}</text>
        <text x={4} y={y(nearCarry)} className="axis-text">{Math.round(nearCarry)}</text>

        {/* The target line. */}
        <line x1={x(0)} y1={padY - 10} x2={x(0)} y2={height - padY + 6}
              className="axis-line" strokeDasharray="4 5" />

        <ellipse cx={x(d.centreSide)} cy={y(depthCentre)} rx={rx} ry={ry} className="ellipse" />

        {plotted.map((p, i) => (
          <circle
            key={p.shot.id + i}
            cx={x(p.side)}
            cy={y(p.carryValue)}
            r={p.mishit ? 3 : 3.5}
            className={p.mishit ? 'shot-dot shot-dot-off' : 'shot-dot'}
          />
        ))}

        <circle cx={x(d.centreSide)} cy={y(depthCentre)} r={4.5} className="centre-dot" />
      </svg>
      <figcaption>
        {multiTarget ? (
          <>
            Played to <strong>{profile.distinctTargets} different targets</strong>, so this shows
            carry <em>relative to each target</em> rather than absolute distance. Typical shot
            finishes{' '}
            <strong>
              {num(Math.abs(profile.carryError.median), 0)} yds{' '}
              {profile.carryError.median >= 0 ? 'past' : 'short of'}
            </strong>{' '}
            the flag.
          </>
        ) : (
          <>
            Typical shot finishes{' '}
            <strong>
              {num(Math.abs(d.centreSide), 0)} yds {d.centreSide >= 0 ? 'right' : 'left'}
            </strong>{' '}
            at <strong>{num(d.centreCarry, 0)} yds</strong> carry. The ring covers about 95% of your
            shots — {num(d.width, 0)} yds wide, {num(d.depth, 0)} yds deep.
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** A trend line across sessions. Small, dense, and honest about thin data. */
export function TrendChart({ trend }: { trend: Trend }) {
  const width = 300;
  const height = 84;
  const pad = 8;

  const values = trend.points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) =>
    pad + (i / Math.max(1, trend.points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const path = trend.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const state = !trend.significant ? 'flat' : trend.improving ? 'good' : 'bad';

  return (
    <div className={`trend trend-${state}`}>
      <div className="trend-head">
        <span className="trend-label">
          {trend.label} <em>{trend.club}</em>
        </span>
        <span className="trend-change">
          {trend.significant
            ? `${trend.change > 0 ? '+' : ''}${num(trend.change, trend.unit === '' ? 2 : 1)}${trend.unit}`
            : 'no real change'}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${trend.label} trend`}>
        <path d={path} className="trend-line" fill="none" />
        {trend.points.map((p, i) => (
          <circle key={p.sessionId} cx={x(i)} cy={y(p.value)} r={3} className="trend-dot" />
        ))}
      </svg>
      <p className="trend-note">
        {trend.significant
          ? trend.improving
            ? 'Moving the right way across your last sessions.'
            : 'Moving the wrong way — worth a look.'
          : 'Change is smaller than your shot-to-shot noise, so this is not a trend yet.'}
      </p>
    </div>
  );
}
