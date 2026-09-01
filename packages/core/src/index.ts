/**
 * @swinglab/core
 *
 * Pure TypeScript. No network, no filesystem, no platform APIs — so the same
 * engine runs in the desktop shell, the mobile PWA and the test suite without
 * modification, and costs nothing to run because it runs entirely on the
 * player's own device.
 */

export * from './schema.js';
export * from './clubs.js';
export * from './units.js';

export * from './ingest/types.js';
export { parseCsv, sniffDelimiter } from './ingest/csv.js';
export { trackmanCsvAdapter, detectSessionKind } from './ingest/trackman-csv.js';
export { ADAPTERS, adapterFor, ingest } from './ingest/registry.js';

export * from './stats/robust.js';
export * from './stats/outliers.js';
export * from './stats/dispersion.js';

export * from './stats/trends.js';

export * from './benchmarks/tour.js';
export * from './benchmarks/personal.js';
export * from './analysis/index.js';

export * from './practice/modes.js';
export {
  prescribePractice,
  type Prescription,
  type PracticeSession,
  type PracticeDuration,
} from './practice/prescribe.js';

export { impactOf, rankByImpact, type Impact, type FixSpeed } from './diagnose/impact.js';
export { prioritise, CAUSAL_LINKS, type Prioritised, type CausalLink } from './diagnose/causes.js';
export {
  findingKey,
  estimateStrokesAvailable,
  diagnoseSession,
  diagnoseShots,
  buildPracticePlan,
  type SessionReport,
  type PracticeItem,
  type DiagnoseOptions,
} from './diagnose/index.js';
export type { Finding, Severity, Confidence, Evidence } from './diagnose/types.js';
export { DRILLS, drill, type Drill } from './diagnose/drills.js';
