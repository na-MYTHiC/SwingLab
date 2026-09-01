import type { ClubProfile, SessionReport, Shot } from '@swinglab/core';
import { VERSION } from './version.js';

/**
 * Renders a session as a full phone-sized scorecard the player can send.
 *
 * Drawn on a canvas rather than screenshotted from the DOM: a screenshot of
 * this app would be a screenshot of a scrolling page, and what a person wants
 * to send is one legible card.
 *
 * THE BRIEF THIS ANSWERS. Somebody who was not in the bay — a coach, a mate,
 * a playing partner — should be able to look at this once and understand how
 * the session went. That takes more than a score: it takes what the score was
 * made of, how the pattern actually looked, which numbers were off and by how
 * much, and what the one thing to fix is. So the card is a full 9:16 phone
 * portrait rather than the square it used to be, and every band on it earns
 * its height by answering a question the previous band raises.
 *
 * No external library. This is one specific picture, and a rasterising
 * dependency would be larger than the code that draws it.
 */

const W = 1080;
/**
 * A phone portrait is the floor, not the ceiling.
 *
 * 9:16 is the shape this is read in, so the card is never shorter than that.
 * But a session with six delivery numbers and a fault worth naming has more
 * to say than one with two, and clipping the bottom off the card to hold a
 * fixed aspect loses exactly the detail that makes it worth sending. So the
 * content is drawn first and the canvas is cut to fit afterwards.
 */
const MIN_H = 1920;
const SCRATCH_H = 3600;
const PAD = 56;
const INNER = W - PAD * 2;

/**
 * The app's own palette, hard-coded rather than read from CSS.
 *
 * The card is generated off-screen and is often viewed in someone else's
 * message thread, so it cannot inherit the viewer's theme and must not depend
 * on which theme the player happened to have on when they tapped save.
 */
const C = {
  bg: '#0a0c12',
  panel: '#12151f',
  panel2: '#191d2a',
  line: '#2a3044',
  text: '#eaeefb',
  dim: '#9aa5c0',
  faint: '#6b7591',
  brand: '#7c8cff',
  data: '#34d3ee',
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#fb7185',
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panel(ctx: CanvasRenderingContext2D, y: number, h: number, fill = C.panel): void {
  ctx.fillStyle = fill;
  roundRect(ctx, PAD, y, INNER, h, 22);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Section label: small, uppercase, tracked. Used to open every band. */
function eyebrow(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = C.faint;
  ctx.font = '600 21px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.letterSpacing = '0px';
}

const STRIKE_TONES: Record<string, string> = {
  flush: C.good, solid: '#2aa87c', thin: C.bad, heavy: C.bad, 'off-centre': C.warn,
};

/** Same mapping the app uses, so the card and the screen agree. */
const SHAPE_TONES: Record<string, string> = {
  Straight: C.good, Draw: '#2aa87c', Fade: '#2aa87c',
  Pull: C.warn, Push: C.warn, 'Pull fade': C.warn, 'Push draw': C.warn,
  'Pull hook': C.bad, 'Push slice': C.bad,
};

const TIER_COLOURS: Record<string, string> = {
  bronze: '#c98a55', silver: '#c3ccd4', gold: C.warn,
};

/**
 * A labelled segmented bar. Strike and shape are the same picture of two
 * different things, so they are the same code.
 */
function segmentPanel(
  ctx: CanvasRenderingContext2D,
  y: number,
  title: string,
  segments: { label: string; share: number; colour: string }[],
  caption?: string,
): number {
  const trackW = INNER - 68;
  // Legends wrap to a second line once there are more than four labels.
  const lines = segments.length > 4 ? 2 : 1;
  const h = 116 + lines * 34 + (caption ? 40 : 0);
  panel(ctx, y, h);
  eyebrow(ctx, title, PAD + 34, y + 40);

  let sx = PAD + 34;
  for (const seg of segments) {
    const w = Math.max(seg.share * trackW, 4);
    ctx.fillStyle = seg.colour;
    ctx.fillRect(sx, y + 62, w - 3, 20);
    sx += w;
  }

  ctx.font = '400 24px system-ui, -apple-system, sans-serif';
  const labels = segments.map((seg) => `${seg.label} ${Math.round(seg.share * 100)}%`);
  const half = Math.ceil(labels.length / lines);
  let ly = y + 120;
  for (let i = 0; i < lines; i += 1) {
    ctx.fillStyle = C.dim;
    ctx.fillText(truncate(ctx, labels.slice(i * half, (i + 1) * half).join('   '), trackW),
      PAD + 34, ly);
    ly += 34;
  }

  if (caption) {
    ctx.fillStyle = C.faint;
    ctx.font = '400 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(truncate(ctx, caption, trackW), PAD + 34, ly + 4);
  }
  return y + h + 18;
}

function toneFor(score: number): string {
  return score >= 68 ? C.good : score >= 45 ? C.warn : C.bad;
}

function bar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, pct: number, colour: string, h = 12,
): void {
  ctx.fillStyle = C.panel2;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const filled = Math.max(0, Math.min(1, pct)) * w;
  if (filled > 1) {
    ctx.fillStyle = colour;
    roundRect(ctx, x, y, Math.max(filled, h), h, h / 2);
    ctx.fill();
  }
}

/** Draw the card and hand back a PNG blob. */
export async function renderShareCard(
  report: SessionReport,
  sessionDate: Date | null,
  shots: Shot[] = [],
): Promise<Blob | null> {
  // Drawn oversized, then cropped to the content once the height is known.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = SCRATCH_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, SCRATCH_H);
  ctx.textBaseline = 'alphabetic';

  const main = report.profiles.length
    ? [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0] ?? null
    : null;

  let y = PAD + 10;

  // ------------------------------------------------------------- header
  ctx.fillStyle = C.text;
  ctx.font = '650 40px system-ui, -apple-system, sans-serif';
  ctx.fillText('Swing', PAD, y + 34);
  const swingW = ctx.measureText('Swing').width;
  ctx.fillStyle = C.brand;
  ctx.fillText('Lab', PAD + swingW, y + 34);

  ctx.textAlign = 'right';
  ctx.fillStyle = C.faint;
  ctx.font = '500 24px system-ui, -apple-system, sans-serif';
  const when = sessionDate
    ? sessionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Undated session';
  ctx.fillText(when, W - PAD, y + 32);
  ctx.textAlign = 'left';

  y += 62;
  ctx.fillStyle = C.dim;
  ctx.font = '500 25px system-ui, -apple-system, sans-serif';
  const bits = [
    report.mode?.name ?? 'Session',
    `${report.shotCount} shots`,
    main ? `${main.club} · ${Math.round(main.carry.median)} yds` : null,
  ].filter(Boolean);
  ctx.fillText(bits.join('   ·   '), PAD, y + 22);
  y += 54;

  // -------------------------------------------------------- score hero
  const score = report.score;
  if (score) {
    const heroH = 220;
    panel(ctx, y, heroH);

    ctx.fillStyle = toneFor(score.total);
    ctx.font = '700 128px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(score.total), PAD + 40, y + 138);
    const numW = ctx.measureText(String(score.total)).width;

    ctx.fillStyle = C.faint;
    ctx.font = '500 34px system-ui, -apple-system, sans-serif';
    ctx.fillText('/ 100', PAD + 54 + numW, y + 138);

    // Grade badge, right-aligned.
    const gx = W - PAD - 40 - 108;
    ctx.strokeStyle = toneFor(score.total);
    ctx.lineWidth = 5;
    roundRect(ctx, gx, y + 34, 108, 108, 26);
    ctx.stroke();
    ctx.fillStyle = toneFor(score.total);
    ctx.font = '700 62px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(score.grade, gx + 54, y + 111);
    ctx.textAlign = 'left';

    ctx.fillStyle = C.dim;
    ctx.font = '400 26px system-ui, -apple-system, sans-serif';
    wrapText(ctx, score.verdict, PAD + 40, y + 186, INNER - 80 - 130, 34);
    y += heroH + 18;

    // ------------------------------------------------- what it was made of
    const rowH = 76;
    const compH = 54 + score.components.length * rowH;
    panel(ctx, y, compH);
    eyebrow(ctx, 'What the score is made of', PAD + 34, y + 40);

    /*
     * Best first, rather than in the order the engine happens to compute
     * them. Someone reading this card for the first time should see what
     * held up before what did not — and the weakest component landing last
     * is where the eye stops, which is the right place for it.
     */
    const ordered = [...score.components].sort((a, b) => b.score - a.score);

    let cy = y + 74;
    for (const c of ordered) {
      ctx.fillStyle = C.text;
      ctx.font = '550 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(c.label, PAD + 34, cy + 22);

      ctx.textAlign = 'right';
      ctx.fillStyle = toneFor(c.score);
      ctx.font = '650 30px system-ui, -apple-system, sans-serif';
      ctx.fillText(String(c.score), W - PAD - 34, cy + 22);
      ctx.textAlign = 'left';

      bar(ctx, PAD + 34, cy + 36, INNER - 68, c.score / 100, toneFor(c.score));
      cy += rowH;
    }
    y += compH + 18;
  }

  // --------------------------------------- handicap and pattern, side by side
  const halfW = (INNER - 16) / 2;
  const pairH = 210;
  if (report.handicap || main?.dispersion) {
    ctx.fillStyle = C.panel;
    roundRect(ctx, PAD, y, halfW, pairH, 22);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = C.panel;
    roundRect(ctx, PAD + halfW + 16, y, halfW, pairH, 22);
    ctx.fill();
    ctx.stroke();

    const h = report.handicap;
    eyebrow(ctx, 'Ball-striking handicap', PAD + 28, y + 40);
    if (h) {
      ctx.fillStyle = C.brand;
      ctx.font = '700 64px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${Math.round(h.low)}–${Math.round(h.high)}`, PAD + 28, y + 116);
      ctx.fillStyle = C.faint;
      ctx.font = '400 23px system-ui, -apple-system, sans-serif';
      wrapText(ctx, `${h.band} · ${h.confidence} confidence`, PAD + 28, y + 152, halfW - 56, 30);
      ctx.fillText('Range data only — no short game', PAD + 28, y + 186);
    } else {
      ctx.fillStyle = C.faint;
      ctx.font = '400 24px system-ui, -apple-system, sans-serif';
      ctx.fillText('Not enough shots', PAD + 28, y + 100);
    }

    const px = PAD + halfW + 16 + 28;
    eyebrow(ctx, 'Shot pattern', px, y + 40);
    if (main?.dispersion) {
      const d = main.dispersion;
      ctx.fillStyle = C.data;
      ctx.font = '700 54px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${Math.round(d.width)}`, px, y + 108);
      const wW = ctx.measureText(`${Math.round(d.width)}`).width;
      ctx.fillStyle = C.faint;
      ctx.font = '500 26px system-ui, -apple-system, sans-serif';
      ctx.fillText('yds wide', px + wW + 12, y + 108);

      ctx.fillStyle = C.dim;
      ctx.font = '400 23px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${Math.round(d.depth)} yds deep`, px, y + 146);
      ctx.fillStyle = C.faint;
      const centre = d.centreSide >= 0 ? 'right' : 'left';
      ctx.fillText(
        `Centre ${Math.abs(Math.round(d.centreSide))} yds ${centre} of target`,
        px, y + 182,
      );
    }
    y += pairH + 18;
  }

  // ------------------------------------------ your numbers against target
  const comps = report.optimals?.comparisons.filter((c) => c.status !== 'unknown') ?? [];
  if (comps.length > 0) {
    const rowH = 52;
    const tableH = 96 + comps.length * rowH;
    panel(ctx, y, tableH);
    eyebrow(
      ctx,
      `Delivery vs tour at ${Math.round(report.optimals?.clubSpeed ?? 0)} mph`,
      PAD + 34, y + 40,
    );

    ctx.fillStyle = C.faint;
    ctx.font = '500 21px system-ui, -apple-system, sans-serif';
    ctx.fillText('MEASURED', PAD + 380, y + 78);
    ctx.fillText('TARGET', PAD + 600, y + 78);
    ctx.fillText('OFF BY', PAD + 800, y + 78);

    let ry = y + 116;
    for (const c of comps) {
      const dp = c.window.unit === '' ? 3 : c.window.unit === 'rpm' || c.window.unit === 'yds' ? 0 : 1;
      ctx.fillStyle = C.text;
      ctx.font = '500 26px system-ui, -apple-system, sans-serif';
      ctx.fillText(c.window.label, PAD + 34, ry);

      ctx.font = '650 27px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${c.actual.toFixed(dp)}${c.window.unit}`, PAD + 380, ry);

      ctx.fillStyle = C.faint;
      ctx.font = '400 25px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${c.window.target.toFixed(dp)}${c.window.unit}`, PAD + 600, ry);

      /*
       * The signed distance from the target, not the word "on target".
       *
       * Six rows all reading "on target" beside a Delivery score of 70 reads
       * as a contradiction — they were all inside their bands and none of
       * them was on the number. The gap is the useful thing, and it is what a
       * coach reads first anyway.
       */
      const diff = c.actual - c.window.target;
      const half = Math.max((c.window.max - c.window.min) / 2, 1e-9);
      const off = Math.abs(diff) / half;
      ctx.fillStyle = off <= 0.25 ? C.good : off <= 1 ? C.warn : C.bad;
      ctx.font = '600 25px system-ui, -apple-system, sans-serif';
      const sign = diff > 0 ? '+' : '';
      ctx.fillText(
        off <= 0.08 ? 'spot on' : `${sign}${diff.toFixed(dp)}${c.window.unit}`,
        PAD + 800, ry,
      );
      ry += rowH;
    }
    y += tableH + 18;
  }

  // ------------------------------------------------------- how you struck it
  if (report.strike.total > 0 && report.strike.counts.length > 0) {
    y = segmentPanel(
      ctx, y, 'How you struck it',
      report.strike.counts.map((c) => ({
        label: c.label, share: c.share, colour: STRIKE_TONES[c.klass] ?? C.warn,
      })),
    );
  }

  /*
   * Where it went.
   *
   * The companion to the strike bar and the thing a reader asks next: a
   * player can strike it beautifully and still miss every green in the same
   * direction, and one shape on most swings is a completely different
   * problem — an easier one — from six shapes in equal measure.
   */
  if (report.shape.total > 0 && report.shape.counts.length > 0) {
    y = segmentPanel(
      ctx, y, 'Where it went',
      report.shape.counts.map((c) => ({
        label: c.label, share: c.share, colour: SHAPE_TONES[c.label] ?? C.warn,
      })),
      report.shape.dominant
        ? `${report.shape.dominant.label.toLowerCase()} on ${Math.round(report.shape.dominant.share * 100)}% of shots — a pattern, which is far easier to fix than randomness`
        : `no single shape dominates; it takes ${report.shape.spreadOfShapes} of them to cover the session`,
    );
  }

  /*
   * Milestones.
   *
   * What the player has actually crossed, and what is nearly in reach. These
   * are the part of the card somebody else can read without knowing any of
   * the numbers — thresholds that mean something in golf, rather than a score
   * that means something inside this app.
   */
  const earned = report.achievements.filter((a) => a.earned);
  const near = report.achievements.filter((a) => !a.earned).slice(0, 3);
  const shown = [...earned, ...near];
  if (shown.length > 0) {
    const rowH = 64;
    const milesH = 78 + shown.length * rowH;
    panel(ctx, y, milesH);
    eyebrow(
      ctx,
      `Milestones — ${earned.length} of ${report.achievements.length}`,
      PAD + 34, y + 40,
    );

    let my = y + 84;
    for (const a of shown) {
      const tierColour = TIER_COLOURS[a.tier] ?? C.faint;
      ctx.fillStyle = a.earned ? tierColour : C.faint;
      ctx.beginPath();
      ctx.arc(PAD + 44, my - 8, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = a.earned ? C.text : C.dim;
      ctx.font = `${a.earned ? 650 : 500} 28px system-ui, -apple-system, sans-serif`;
      ctx.fillText(a.name, PAD + 66, my);

      ctx.textAlign = 'right';
      if (a.earned) {
        ctx.fillStyle = tierColour;
        ctx.font = '600 22px system-ui, -apple-system, sans-serif';
        ctx.fillText(a.tier.toUpperCase(), W - PAD - 34, my);
      } else {
        ctx.fillStyle = C.faint;
        ctx.font = '500 22px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${Math.round(a.progress * 100)}%`, W - PAD - 34, my);
      }
      ctx.textAlign = 'left';

      ctx.fillStyle = C.faint;
      ctx.font = '400 22px system-ui, -apple-system, sans-serif';
      ctx.fillText(truncate(ctx, a.requirement, INNER - 140), PAD + 66, my + 28);
      my += rowH;
    }
    y += milesH + 18;
  }

  // ---------------------------------------------- crop to what was drawn
  const contentH = y + 10;
  const finalH = Math.max(MIN_H, contentH + PAD + 40);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = finalH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.fillStyle = C.bg;
  octx.fillRect(0, 0, W, finalH);
  octx.drawImage(canvas, 0, 0, W, contentH, 0, 0, W, contentH);

  // The footer is pinned to the bottom of the finished card, not to the
  // bottom of the content — on a short session those are not the same place.
  octx.fillStyle = C.faint;
  octx.font = '400 21px system-ui, -apple-system, sans-serif';
  octx.textBaseline = 'alphabetic';
  octx.fillText(`SwingLab v${VERSION}`, PAD, finalH - PAD + 6);
  octx.textAlign = 'right';
  octx.fillText('Measured on TrackMan · computed on device', W - PAD, finalH - PAD + 6);
  octx.textAlign = 'left';

  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}

function shotsFor(shots: Shot[], profile: ClubProfile): Shot[] {
  return shots.filter(
    (s) => s.club === profile.club && s.carry !== null && s.side !== null
      && !s.flags.includes('unusable'),
  );
}

/**
 * The pattern itself.
 *
 * The single most informative thing on the card: an ellipse says how wide the
 * pattern is, but the dots say what it is made of — whether the width comes
 * from a steady bias or from two good shots and one wild one, which changes
 * the advice entirely and is invisible in any summary number.
 */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  profile: ClubProfile,
  shots: Shot[],
  x: number, y: number, w: number, h: number,
): void {
  const d = profile.dispersion;
  if (!d) return;

  /*
   * Equal yards per pixel on both axes.
   *
   * Stretching the plot to fill a wide box made a 57-yard-wide, 45-yard-deep
   * pattern look three times wider than it was deep, which is a picture of
   * the box rather than of the golf. The scale is shared, and the drawing is
   * centred in whatever space is left over.
   */
  const sides = shots.map((s) => s.side as number);
  const carries = shots.map((s) => s.carry as number);
  const halfWidth = (Math.max(d.width * 0.75, ...sides.map(Math.abs)) || 30) * 1.12;
  const nearCarry = Math.min(...carries, d.centreCarry - d.depth / 2) - 6;
  const farCarry = Math.max(...carries, d.centreCarry + d.depth / 2) + 6;
  const carrySpan = Math.max(farCarry - nearCarry, 12);

  // Yards per pixel: whichever axis is more demanding sets it for both.
  const scale = Math.max((halfWidth * 2) / w, carrySpan / h);
  const plotW = (halfWidth * 2) / scale;
  const plotH = carrySpan / scale;
  const ox = x + (w - plotW) / 2;
  const oy = y + (h - plotH) / 2;

  const px = (side: number) => ox + ((side + halfWidth) / (halfWidth * 2)) * plotW;
  const py = (carry: number) => oy + plotH - ((carry - nearCarry) / carrySpan) * plotH;

  // Target line.
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.moveTo(px(0), oy);
  ctx.lineTo(px(0), oy + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  // The 95% ellipse.
  const rx = Math.max(8, d.width / 2 / scale);
  const ry = Math.max(8, d.depth / 2 / scale);
  ctx.beginPath();
  ctx.ellipse(px(d.centreSide), py(d.centreCarry), rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(52, 211, 238, 0.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(52, 211, 238, 0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();

  for (const shot of shots) {
    ctx.beginPath();
    ctx.arc(px(shot.side as number), py(shot.carry as number), 7, 0, Math.PI * 2);
    ctx.fillStyle = shot.flags.includes('mishit') ? 'rgba(251,113,133,0.8)' : 'rgba(52,211,238,0.85)';
    ctx.fill();
  }

  // Centre of the pattern.
  ctx.beginPath();
  ctx.arc(px(d.centreSide), py(d.centreCarry), 9, 0, Math.PI * 2);
  ctx.fillStyle = C.text;
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = C.faint;
  ctx.font = '400 21px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${Math.round(farCarry)} yds`, x, oy + 18);
  ctx.fillText(`${Math.round(nearCarry)} yds`, x, oy + plotH - 2);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number, maxWidth: number, lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let cursor = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cursor);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 4 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/**
 * Save the card, preferring the native share sheet on a phone.
 *
 * A download on mobile buries the file in Downloads where nobody looks; the
 * share sheet puts it straight into a message, which is what the player
 * actually wanted when they tapped the button.
 */
export async function shareCard(
  report: SessionReport,
  date: Date | null,
  shots: Shot[] = [],
): Promise<void> {
  const blob = await renderShareCard(report, date, shots);
  if (!blob) return;

  const name = `swinglab-${date ? date.toISOString().slice(0, 10) : 'session'}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };

  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: 'SwingLab session' });
      return;
    } catch {
      // Cancelled, or the sheet refused — fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoke on the next tick so the click has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
