import type { ClubProfile, Trend } from '@swinglab/core';
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
export function DispersionChart({ profile }: { profile: ClubProfile }) {
  const d = profile.dispersion;
  if (!d || !Number.isFinite(d.centreCarry)) {
    return <p className="chart-empty">Not enough shots with a carry and side reading to plot.</p>;
  }

  const width = 320;
  const height = 380;
  const padX = 34;
  const padY = 26;

  // Scale to the pattern with headroom, and never narrower than ±15 yards so
  // a tight pattern does not get magnified into looking scattered.
  const halfWidth = Math.max(15, d.width / 2 + 6);
  const depth = Math.max(20, d.depth + 12);
  const nearCarry = d.centreCarry - depth / 2;
  const farCarry = d.centreCarry + depth / 2;

  const x = (side: number) =>
    padX + ((side + halfWidth) / (halfWidth * 2)) * (width - padX * 2);
  const y = (carry: number) =>
    height - padY - ((carry - nearCarry) / (farCarry - nearCarry)) * (height - padY * 2);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Shot dispersion pattern">
        <line
          x1={x(0)} y1={padY - 8} x2={x(0)} y2={height - padY + 4}
          className="axis-line"
          strokeDasharray="3 4"
        />
        {[nearCarry, d.centreCarry, farCarry].map((carry, i) => (
          <g key={i}>
            <line x1={padX} y1={y(carry)} x2={width - padX} y2={y(carry)} className="grid-line" />
            <text x={4} y={y(carry) + 4} className="axis-text">
              {Math.round(carry)}
            </text>
          </g>
        ))}

        {/* Two-sigma pattern: roughly where 95% of shots land. */}
        <ellipse
          cx={x(d.centreSide)}
          cy={y(d.centreCarry)}
          rx={Math.max(6, (d.width / 2 / halfWidth) * ((width - padX * 2) / 2))}
          ry={Math.max(6, (d.depth / 2 / (farCarry - nearCarry)) * (height - padY * 2))}
          className="ellipse"
        />
        <circle cx={x(d.centreSide)} cy={y(d.centreCarry)} r={4} className="centre-dot" />
      </svg>
      <figcaption>
        Typical shot finishes <strong>{num(Math.abs(d.centreSide), 0)} yds{' '}
        {d.centreSide >= 0 ? 'right' : 'left'}</strong> at{' '}
        <strong>{num(d.centreCarry, 0)} yds</strong> carry. The ring covers about 95% of your shots
        — {num(d.width, 0)} yds wide, {num(d.depth, 0)} yds deep.
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
