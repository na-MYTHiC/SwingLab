import type { SessionReport } from '@swinglab/core';
import { VERSION } from './version.js';

/**
 * Renders a session summary as an image the player can save or send.
 *
 * Drawn on a canvas rather than screenshotted from the DOM: a screenshot of
 * this app would be a screenshot of a scrolling page, and what a person
 * actually wants to send someone is one legible card. Portrait, because it is
 * going to a phone.
 *
 * No external library. This is one specific picture, and a rasterising
 * dependency would be larger than the code that draws it.
 */

const W = 1080;
/*
 * Height is computed from the content rather than fixed.
 *
 * A fixed portrait card left a third of itself empty whenever a player earned
 * one achievement instead of three, and empty space reads as "something
 * failed to load" rather than as design.
 */
const HEADER_H = 150;
const SCORE_H = 300;
const COMPONENT_H = 62;
const STATS_H = 188;
const ACH_HEADER_H = 40;
const ACH_ROW_H = 78;
const FOOTER_H = 110;

const COLOURS = {
  bg: '#0c0a09',
  panel: '#17130f',
  line: '#332a24',
  text: '#f4efea',
  dim: '#ab9f95',
  faint: '#7a6c61',
  accent: '#ff7a2f',
  warn: '#f5c518',
  alert: '#ff4d6d',
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

function gradeColour(grade: string): string {
  if (grade === 'S' || grade === 'A') return COLOURS.accent;
  if (grade === 'B') return COLOURS.warn;
  return COLOURS.alert;
}

/** Draw the card and hand back a PNG blob. */
export async function renderShareCard(
  report: SessionReport,
  sessionDate: Date | null,
): Promise<Blob | null> {
  const componentCount = report.score?.components.length ?? 0;
  const earnedCount = Math.min(report.achievements.filter((a) => a.earned).length, 3);

  const H =
    HEADER_H +
    (report.score ? SCORE_H + componentCount * COMPONENT_H : 0) +
    STATS_H +
    (earnedCount > 0 ? ACH_HEADER_H + earnedCount * ACH_ROW_H : 0) +
    FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const font = (size: number, weight = '400') =>
    `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  // Background, with the same warm glow the app's hero carries.
  ctx.fillStyle = COLOURS.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(120, 60, 0, 120, 60, 900);
  glow.addColorStop(0, 'rgba(255,122,47,0.16)');
  glow.addColorStop(1, 'rgba(255,122,47,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // --- Header -----------------------------------------------------------
  ctx.fillStyle = COLOURS.accent;
  ctx.beginPath();
  ctx.arc(76, 88, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLOURS.text;
  ctx.font = font(34, '650');
  ctx.fillText('SwingLab', 106, 100);

  ctx.fillStyle = COLOURS.faint;
  ctx.font = font(22);
  const dateLabel = sessionDate
    ? sessionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Session';
  ctx.textAlign = 'right';
  ctx.fillText(dateLabel, W - 72, 100);
  ctx.textAlign = 'left';

  // --- Score ------------------------------------------------------------
  const score = report.score;
  let y = 190;

  if (score) {
    ctx.fillStyle = COLOURS.faint;
    ctx.font = font(22, '500');
    ctx.fillText('SESSION SCORE', 76, y);

    ctx.fillStyle = gradeColour(score.grade);
    ctx.font = font(170, '700');
    ctx.fillText(String(score.total), 72, y + 145);

    const scoreWidth = ctx.measureText(String(score.total)).width;
    ctx.fillStyle = COLOURS.dim;
    ctx.font = font(40, '500');
    ctx.fillText('/100', 84 + scoreWidth, y + 145);

    // Grade badge.
    const badgeX = W - 220;
    ctx.strokeStyle = gradeColour(score.grade);
    ctx.lineWidth = 4;
    roundRect(ctx, badgeX, y - 6, 148, 148, 32);
    ctx.stroke();
    ctx.fillStyle = gradeColour(score.grade);
    ctx.font = font(84, '700');
    ctx.textAlign = 'center';
    ctx.fillText(score.grade, badgeX + 74, y + 100);
    ctx.textAlign = 'left';

    y += 200;
    ctx.fillStyle = COLOURS.dim;
    ctx.font = font(26);
    wrapText(ctx, score.verdict, 76, y, W - 152, 36);
    y += 84;

    // Component bars.
    for (const c of score.components) {
      ctx.fillStyle = COLOURS.text;
      ctx.font = font(24, '550');
      ctx.fillText(c.label, 76, y);
      ctx.fillStyle = COLOURS.dim;
      ctx.textAlign = 'right';
      ctx.font = font(24, '600');
      ctx.fillText(String(c.score), W - 76, y);
      ctx.textAlign = 'left';

      ctx.fillStyle = COLOURS.line;
      roundRect(ctx, 76, y + 14, W - 152, 12, 6);
      ctx.fill();
      ctx.fillStyle = c.score >= 68 ? COLOURS.accent : c.score >= 45 ? COLOURS.warn : COLOURS.alert;
      roundRect(ctx, 76, y + 14, Math.max(12, ((W - 152) * c.score) / 100), 12, 6);
      ctx.fill();

      y += 62;
    }
  }

  // --- Key numbers ------------------------------------------------------
  y += 20;
  const main = [...report.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
  const stats: [string, string][] = [
    ['Club', main?.club ?? '—'],
    ['Shots', String(report.shotCount)],
    ['Carry', main && Number.isFinite(main.carry.median) ? `${Math.round(main.carry.median)} yds` : '—'],
    [
      'Pattern',
      main?.dispersion && Number.isFinite(main.dispersion.width)
        ? `${Math.round(main.dispersion.width)} yds`
        : '—',
    ],
  ];

  const cardW = (W - 152 - 36) / 4;
  stats.forEach(([label, value], i) => {
    const x = 76 + i * (cardW + 12);
    ctx.fillStyle = COLOURS.panel;
    roundRect(ctx, x, y, cardW, 120, 18);
    ctx.fill();
    ctx.strokeStyle = COLOURS.line;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, cardW, 120, 18);
    ctx.stroke();

    ctx.fillStyle = COLOURS.text;
    ctx.font = font(36, '650');
    ctx.textAlign = 'center';
    ctx.fillText(value, x + cardW / 2, y + 62);
    ctx.fillStyle = COLOURS.faint;
    ctx.font = font(20);
    ctx.fillText(label.toUpperCase(), x + cardW / 2, y + 94);
    ctx.textAlign = 'left';
  });
  y += 168;

  // --- Achievements earned ---------------------------------------------
  const earned = report.achievements.filter((a) => a.earned);
  if (earned.length > 0) {
    ctx.fillStyle = COLOURS.faint;
    ctx.font = font(22, '500');
    ctx.fillText('EARNED THIS SESSION', 76, y);
    y += 40;

    for (const a of earned.slice(0, 3)) {
      ctx.fillStyle = COLOURS.panel;
      roundRect(ctx, 76, y, W - 152, 66, 16);
      ctx.fill();
      ctx.fillStyle = COLOURS.accent;
      ctx.beginPath();
      ctx.arc(112, y + 33, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLOURS.text;
      ctx.font = font(26, '600');
      ctx.fillText(a.name, 140, y + 42);
      ctx.fillStyle = COLOURS.faint;
      ctx.font = font(20);
      ctx.textAlign = 'right';
      ctx.fillText(a.tier.toUpperCase(), W - 96, y + 42);
      ctx.textAlign = 'left';
      y += 78;
    }
  }

  // --- Footer -----------------------------------------------------------
  ctx.fillStyle = COLOURS.faint;
  ctx.font = font(20);
  ctx.fillText(`SwingLab v${VERSION}`, 76, H - 48);
  ctx.textAlign = 'right';
  const top = report.priorities.find((p) => p.explainedBy === null);
  if (top) {
    ctx.fillText(truncate(ctx, `Next: ${top.finding.title}`, W - 300), W - 76, H - 48);
  }
  ctx.textAlign = 'left';

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
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
export async function shareCard(report: SessionReport, date: Date | null): Promise<void> {
  const blob = await renderShareCard(report, date);
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
