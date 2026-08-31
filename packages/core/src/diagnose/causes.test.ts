import { describe, expect, it } from 'vitest';
import { prioritise } from './causes.js';
import { impactOf } from './impact.js';
import { estimateStrokesAvailable } from './index.js';
import type { Finding } from './types.js';
import type { Club } from '../schema.js';

function finding(id: string, club: Club | null, over: Partial<Finding> = {}): Finding {
  return {
    id,
    club,
    severity: 'minor',
    confidence: 'high',
    title: id,
    detail: id,
    evidence: [{ label: 'x', value: 1, unit: '' }],
    drills: [],
    ...over,
  };
}

describe('leverage ranking', () => {
  it('puts a root cause above a symptom that costs more on its own', () => {
    // Low smash outscores a scattered strike in isolation for this player,
    // but the strike is what is causing it, so it has to come first.
    const findings = [
      finding('low-smash-factor', '7i', { severity: 'major' }),
      finding('strike-scattered', '7i'),
    ];
    const ordered = prioritise(findings);
    expect(ordered[0]?.finding.id).toBe('strike-scattered');
  });

  it('marks the symptom as explained by its cause', () => {
    const ordered = prioritise([
      finding('strike-scattered', '7i'),
      finding('low-smash-factor', '7i'),
    ]);
    const symptom = ordered.find((p) => p.finding.id === 'low-smash-factor');
    expect(symptom?.explainedBy).toBe('strike-scattered::7i');
  });

  it('credits a root cause with what it would resolve', () => {
    const solo = prioritise([finding('strike-scattered', '7i')])[0];
    const withDownstream = prioritise([
      finding('strike-scattered', '7i'),
      finding('low-smash-factor', '7i'),
      finding('carry-inconsistent', '7i'),
    ])[0];

    expect(withDownstream?.finding.id).toBe('strike-scattered');
    expect(withDownstream!.leverage).toBeGreaterThan(solo!.leverage);
    expect(withDownstream!.resolves.length).toBe(2);
  });

  it('does not link faults across different clubs', () => {
    // A scattered 7-iron strike says nothing about the driver's smash.
    const ordered = prioritise([
      finding('strike-scattered', '7i'),
      finding('low-smash-factor', 'Dr'),
    ]);
    const driver = ordered.find((p) => p.finding.club === 'Dr');
    expect(driver?.explainedBy).toBeNull();
  });

  it('places symptoms directly beneath the cause they belong to', () => {
    const ordered = prioritise([
      finding('low-smash-factor', '7i'),
      finding('strike-scattered', '7i'),
      finding('carry-inconsistent', '7i'),
      finding('driver-negative-aoa', 'Dr'),
    ]);
    const ids = ordered.map((p) => p.finding.id);
    const rootIdx = ids.indexOf('strike-scattered');
    for (const symptom of ['low-smash-factor', 'carry-inconsistent']) {
      expect(ids.indexOf(symptom)).toBeGreaterThan(rootIdx);
    }
  });

  it('treats driver attack angle as upstream of driver spin', () => {
    const ordered = prioritise([
      finding('spin-too-high', 'Dr', { severity: 'major' }),
      finding('driver-negative-aoa', 'Dr'),
    ]);
    expect(ordered[0]?.finding.id).toBe('driver-negative-aoa');
    expect(ordered[1]?.explainedBy).toBe('driver-negative-aoa::Dr');
  });

  it('keeps a weak causal link from being called a symptom', () => {
    // Strike scatter nudges face-to-path (0.25) but does not explain it —
    // calling that a symptom would hide genuine face work.
    const ordered = prioritise([
      finding('strike-scattered', '7i'),
      finding('face-open-to-path', '7i'),
    ]);
    const face = ordered.find((p) => p.finding.id === 'face-open-to-path');
    expect(face?.explainedBy).toBeNull();
  });

  it('leaves an isolated finding as its own root', () => {
    const ordered = prioritise([finding('gap-overlap', null)]);
    expect(ordered[0]?.explainedBy).toBeNull();
    expect(ordered[0]?.resolves).toEqual([]);
  });
});

describe('impact estimates', () => {
  it('rates a calibration error above a cosmetic spin number', () => {
    const bias = impactOf(finding('target-short-bias', null));
    const spin = impactOf(finding('spin-too-low', '7i'));
    expect(bias.score).toBeGreaterThan(spin.score);
  });

  it('rewards fixes that pay off immediately', () => {
    expect(impactOf(finding('target-short-bias', null)).speed).toBe('immediate');
    expect(impactOf(finding('path-out-to-in', '7i')).speed).toBe('months');
  });

  it('discounts low-confidence findings', () => {
    const high = impactOf(finding('carry-inconsistent', '7i', { confidence: 'high' }));
    const low = impactOf(finding('carry-inconsistent', '7i', { confidence: 'low' }));
    expect(low.score).toBeLessThan(high.score);
  });
});

describe('strike before direction is a hard constraint', () => {
  it('holds even when the direction fault scores higher on its own', () => {
    const ordered = prioritise([
      finding('face-open-to-path', '7i', { severity: 'major' }),
      finding('path-out-to-in', '7i', { severity: 'major' }),
      finding('strike-toe-biased', '7i'),
    ]);
    const ids = ordered.map((p) => p.finding.id);
    expect(ids.indexOf('strike-toe-biased')).toBeLessThan(ids.indexOf('path-out-to-in'));
    expect(ids.indexOf('strike-toe-biased')).toBeLessThan(ids.indexOf('face-open-to-path'));
  });

  it('does not apply the constraint across different clubs', () => {
    // A driver strike problem has no bearing on 7-iron face control, so the
    // higher-impact 7-iron finding is free to come first. If the constraint
    // leaked across clubs, the driver strike would be dragged to the top.
    const ordered = prioritise([
      finding('face-inconsistent', '7i'),
      finding('strike-toe-biased', 'Dr'),
    ]);
    expect(ordered[0]?.finding.id).toBe('face-inconsistent');
    expect(ordered[0]?.finding.club).toBe('7i');
  });

  it('keeps a cause and its symptoms together when it reorders', () => {
    const ordered = prioritise([
      finding('face-inconsistent', '7i', { severity: 'major' }),
      finding('low-point-behind-ball', '7i'),
      finding('low-smash-factor', '7i'),
    ]);
    const ids = ordered.map((p) => p.finding.id);
    // The low-point cluster moves ahead of the face finding as one unit.
    expect(ids.indexOf('low-point-behind-ball')).toBeLessThan(ids.indexOf('face-inconsistent'));
    expect(ids.indexOf('low-smash-factor')).toBe(ids.indexOf('low-point-behind-ball') + 1);
  });
});

describe('total strokes available', () => {
  it('does not add symptoms on top of the cause that explains them', () => {
    const withSymptoms = prioritise([
      finding('strike-scattered', '7i'),
      finding('low-smash-factor', '7i'),
      finding('carry-inconsistent', '7i'),
    ]);
    const alone = prioritise([finding('strike-scattered', '7i')]);
    expect(estimateStrokesAvailable(withSymptoms)).toBeCloseTo(
      estimateStrokesAvailable(alone),
      5,
    );
  });

  it('treats the same fault on several clubs as largely one problem', () => {
    // One wandering strike across four clubs is one thing to fix, not four.
    const oneClub = prioritise([finding('strike-scattered', '7i')]);
    const fourClubs = prioritise([
      finding('strike-scattered', '7i'),
      finding('strike-scattered', '8i'),
      finding('strike-scattered', '9i'),
      finding('strike-scattered', 'PW'),
    ]);
    const single = estimateStrokesAvailable(oneClub);
    const many = estimateStrokesAvailable(fourClubs);
    expect(many).toBeGreaterThan(single);
    expect(many).toBeLessThan(single * 2.5);
  });

  it('keeps genuinely different faults additive', () => {
    const total = estimateStrokesAvailable(
      prioritise([finding('target-short-bias', null), finding('gap-oversized', '8i')]),
    );
    const bias = estimateStrokesAvailable(prioritise([finding('target-short-bias', null)]));
    const gap = estimateStrokesAvailable(prioritise([finding('gap-oversized', '8i')]));
    expect(total).toBeCloseTo(bias + gap, 5);
  });
});
