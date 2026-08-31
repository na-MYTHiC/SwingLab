import type { Finding } from './types.js';
import { impactOf, type Impact } from './impact.js';

/**
 * Causal structure between faults.
 *
 * Ranking purely by cost treats every finding as separate work, and that is
 * not how a golf swing behaves. A strike that moves around the face lowers
 * smash factor, widens carry, and tilts the spin axis — so it shows up as
 * four findings that are really one fault wearing four hats. Fix the strike
 * and the other three improve without ever being worked on directly.
 *
 * That makes root causes worth more than their own cost: they carry the cost
 * of everything downstream. It also means the downstream findings should not
 * be presented as separate jobs, because sending someone to practise a
 * symptom is how practice time gets wasted.
 *
 * The strengths below are the likelihood that fixing the cause substantially
 * resolves the effect. Like the impact estimates, they are informed judgement
 * about how these faults relate, not measurements — deliberately conservative,
 * because wrongly calling something a symptom hides real work.
 */

export interface CausalLink {
  cause: string;
  effect: string;
  /** 0-1: how likely fixing the cause resolves the effect. */
  strength: number;
}

export const CAUSAL_LINKS: CausalLink[] = [
  // --- Strike is the deepest root. It corrupts everything measured after it.
  { cause: 'strike-scattered', effect: 'low-smash-factor', strength: 0.8 },
  { cause: 'strike-scattered', effect: 'carry-inconsistent', strength: 0.7 },
  { cause: 'strike-scattered', effect: 'high-mishit-rate', strength: 0.6 },
  { cause: 'strike-scattered', effect: 'target-distance-spread', strength: 0.5 },
  { cause: 'strike-scattered', effect: 'spin-too-low', strength: 0.4 },
  { cause: 'strike-scattered', effect: 'spin-too-high', strength: 0.3 },
  // Face and path numbers taken off a scattered strike are describing the
  // mishits rather than the swing, so some of the "direction problem" is not
  // a direction problem at all.
  { cause: 'strike-scattered', effect: 'face-inconsistent', strength: 0.35 },
  { cause: 'strike-scattered', effect: 'face-open-to-path', strength: 0.25 },
  { cause: 'strike-scattered', effect: 'face-closed-to-path', strength: 0.25 },

  // --- Low point drives contact quality on everything off the turf.
  { cause: 'low-point-behind-ball', effect: 'low-smash-factor', strength: 0.75 },
  { cause: 'low-point-behind-ball', effect: 'high-mishit-rate', strength: 0.65 },
  { cause: 'low-point-behind-ball', effect: 'carry-inconsistent', strength: 0.6 },
  { cause: 'low-point-behind-ball', effect: 'strike-scattered', strength: 0.35 },
  { cause: 'low-point-inconsistent', effect: 'carry-inconsistent', strength: 0.6 },
  { cause: 'low-point-inconsistent', effect: 'high-mishit-rate', strength: 0.5 },
  { cause: 'low-point-inconsistent', effect: 'target-distance-spread', strength: 0.45 },

  // --- Off-centre contact. Gear effect makes this look like a face fault.
  { cause: 'strike-toe-biased', effect: 'low-smash-factor', strength: 0.7 },
  { cause: 'strike-toe-biased', effect: 'carry-inconsistent', strength: 0.4 },
  { cause: 'strike-toe-biased', effect: 'face-closed-to-path', strength: 0.3 },
  { cause: 'strike-heel-biased', effect: 'low-smash-factor', strength: 0.7 },
  { cause: 'strike-heel-biased', effect: 'carry-inconsistent', strength: 0.4 },
  { cause: 'strike-heel-biased', effect: 'face-open-to-path', strength: 0.3 },

  // --- Path sets the frame the face is measured against.
  { cause: 'path-out-to-in', effect: 'face-open-to-path', strength: 0.5 },
  { cause: 'path-in-to-out', effect: 'face-closed-to-path', strength: 0.5 },

  // --- Driver: attack angle is upstream of driver spin, not the reverse.
  { cause: 'driver-negative-aoa', effect: 'spin-too-high', strength: 0.75 },
  { cause: 'driver-negative-aoa', effect: 'low-smash-factor', strength: 0.4 },

  // --- Irons hit on the up bottom out early; same family as low point.
  { cause: 'iron-positive-aoa', effect: 'low-point-behind-ball', strength: 0.6 },
  { cause: 'iron-positive-aoa', effect: 'high-mishit-rate', strength: 0.5 },
  { cause: 'iron-positive-aoa', effect: 'low-smash-factor', strength: 0.45 },

  // --- Calibration is upstream of how a scored test reads.
  { cause: 'target-short-bias', effect: 'weak-target-distance', strength: 0.4 },
  { cause: 'target-long-bias', effect: 'weak-target-distance', strength: 0.4 },

  // --- An unrepeatable carry is what makes gapping look broken.
  { cause: 'carry-inconsistent', effect: 'gap-overlap', strength: 0.35 },
  { cause: 'carry-inconsistent', effect: 'gap-oversized', strength: 0.25 },
];

export interface Prioritised {
  finding: Finding;
  impact: Impact;
  /** Keys of findings this one would likely resolve as a side effect. */
  resolves: string[];
  /** Key of the root cause that likely explains this finding, if any. */
  explainedBy: string | null;
  /**
   * Own impact plus the weighted impact of everything it would resolve. This
   * is what the ordering actually uses.
   */
  leverage: number;
  /** Strokes per round, own plus what it unlocks downstream. */
  leverageStrokes: number;
}

function key(finding: Finding): string {
  return `${finding.id}::${finding.club ?? 'bag'}`;
}

/**
 * A link applies when both findings concern the same club, or when either is
 * bag-wide. A scattered strike with the 7-iron says nothing about the driver.
 */
function linkApplies(cause: Finding, effect: Finding): boolean {
  if (cause.club === null || effect.club === null) return true;
  return cause.club === effect.club;
}

/**
 * Order findings by leverage: what fixing this actually unlocks.
 *
 * Two faults that cost the same are not equally worth doing when one of them
 * is upstream of three others. The player asked which work produces the
 * fastest improvement, and that is this number rather than raw cost.
 *
 * Findings explained by a higher-ranked cause are kept — they are real, and
 * hiding them would misrepresent the session — but marked as symptoms and
 * placed directly beneath their cause, so the plan does not send anyone to
 * practise the same fault three times under three names.
 */
export function prioritise(findings: Finding[]): Prioritised[] {
  const byKey = new Map<string, Finding>();
  for (const finding of findings) byKey.set(key(finding), finding);

  const impacts = new Map<string, Impact>();
  for (const finding of findings) impacts.set(key(finding), impactOf(finding));

  // Which present findings does each present finding explain?
  const resolves = new Map<string, { key: string; strength: number }[]>();
  for (const finding of findings) {
    const causeKey = key(finding);
    const downstream: { key: string; strength: number }[] = [];
    for (const link of CAUSAL_LINKS) {
      if (link.cause !== finding.id) continue;
      for (const candidate of findings) {
        if (candidate.id !== link.effect) continue;
        if (candidate === finding) continue;
        if (!linkApplies(finding, candidate)) continue;
        downstream.push({ key: key(candidate), strength: link.strength });
      }
    }
    resolves.set(causeKey, downstream);
  }

  const entries: Prioritised[] = findings.map((finding) => {
    const k = key(finding);
    const own = impacts.get(k) as Impact;
    const downstream = resolves.get(k) ?? [];

    let bonus = 0;
    let bonusStrokes = 0;
    for (const d of downstream) {
      const dImpact = impacts.get(d.key);
      if (!dImpact) continue;
      bonus += dImpact.score * d.strength;
      bonusStrokes += dImpact.courseStrokes * d.strength;
    }

    return {
      finding,
      impact: own,
      resolves: downstream.map((d) => d.key),
      explainedBy: null,
      leverage: own.score + bonus,
      leverageStrokes: own.courseStrokes + bonusStrokes,
    };
  });

  entries.sort((a, b) => b.leverage - a.leverage);

  // Mark symptoms, resolving to the strongest cause that outranks them.
  const rank = new Map<string, number>();
  entries.forEach((e, i) => rank.set(key(e.finding), i));

  for (const entry of entries) {
    const myRank = rank.get(key(entry.finding)) as number;
    let best: { key: string; strength: number; rank: number } | null = null;

    for (const other of entries) {
      const otherKey = key(other.finding);
      const otherRank = rank.get(otherKey) as number;
      if (otherRank >= myRank) continue;
      const link = other.resolves.find((r) => r === key(entry.finding));
      if (!link) continue;
      const strength =
        CAUSAL_LINKS.find(
          (l) => l.cause === other.finding.id && l.effect === entry.finding.id,
        )?.strength ?? 0;
      // Only call it a symptom when the link is strong enough to act on.
      if (strength < 0.5) continue;
      if (!best || strength > best.strength) {
        best = { key: otherKey, strength, rank: otherRank };
      }
    }

    if (best) entry.explainedBy = best.key;
  }

  // Group each root with the symptoms it explains, so the constraint pass
  // below can move a whole cluster without splitting a cause from its effects.
  const clusters: Prioritised[][] = [];
  const placed = new Set<string>();

  for (const entry of entries) {
    const k = key(entry.finding);
    if (placed.has(k) || entry.explainedBy !== null) continue;
    const cluster = [entry];
    placed.add(k);
    for (const other of entries) {
      const ok = key(other.finding);
      if (placed.has(ok)) continue;
      if (other.explainedBy === k) {
        cluster.push(other);
        placed.add(ok);
      }
    }
    clusters.push(cluster);
  }
  // Anything whose cause never got placed (a cycle, or a filtered-out cause).
  for (const entry of entries) {
    if (!placed.has(key(entry.finding))) {
      clusters.push([entry]);
      placed.add(key(entry.finding));
    }
  }

  return flattenWithStrikeFirst(clusters);
}

/**
 * Strike before direction, on the same club. A hard constraint, not a weight.
 *
 * Face angle and club path measured off a strike that wanders around the face
 * are not describing the swing — they are describing where the ball happened
 * to hit. Sending someone to rebuild a path from those numbers is worse than
 * useless, because the numbers will move on their own once the strike
 * settles. So no matter what the leverage arithmetic says, a strike fault
 * outranks a direction fault *for the same club*.
 *
 * Across different clubs there is no such dependency and leverage decides.
 */
function flattenWithStrikeFirst(clusters: Prioritised[][]): Prioritised[] {
  const STRIKE = new Set([
    'strike-scattered',
    'strike-toe-biased',
    'strike-heel-biased',
    'low-point-behind-ball',
    'low-point-inconsistent',
    'iron-positive-aoa',
  ]);
  const DIRECTION = new Set([
    'face-open-to-path',
    'face-closed-to-path',
    'face-inconsistent',
    'path-out-to-in',
    'path-in-to-out',
  ]);

  const clubsIn = (cluster: Prioritised[], ids: Set<string>): Set<string> => {
    const out = new Set<string>();
    for (const entry of cluster) {
      if (entry.finding.club && ids.has(entry.finding.id)) out.add(entry.finding.club);
    }
    return out;
  };

  const result = [...clusters];

  // Repeatedly pull a strike cluster ahead of the earliest direction cluster
  // that shares a club. Bounded so a pathological input cannot spin here.
  for (let pass = 0; pass < result.length; pass++) {
    let moved = false;

    for (let i = 0; i < result.length && !moved; i++) {
      const directionClubs = clubsIn(result[i] as Prioritised[], DIRECTION);
      if (directionClubs.size === 0) continue;

      for (let j = i + 1; j < result.length; j++) {
        const strikeClubs = clubsIn(result[j] as Prioritised[], STRIKE);
        const shares = [...strikeClubs].some((club) => directionClubs.has(club));
        if (!shares) continue;

        const [cluster] = result.splice(j, 1);
        result.splice(i, 0, cluster as Prioritised[]);
        moved = true;
        break;
      }
    }

    if (!moved) break;
  }

  return result.flat();
}

export { key as findingKeyOf };
