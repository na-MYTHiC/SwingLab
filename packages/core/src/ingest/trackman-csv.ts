import type { Handedness, Maybe, SessionKind, Shot, ShotSession } from '../schema.js';
import { normaliseClub } from '../clubs.js';
import {
  isLinearUnit,
  isSpeedUnit,
  parseNumber,
  parseUnitToken,
  toMillimetres,
  toMph,
  toYards,
} from '../units.js';
import { parseCsv } from './csv.js';
import type { IngestAdapter, IngestOptions, IngestResult, IngestWarning, RawInput } from './types.js';
import { parseConditions, type Conditions } from '../benchmarks/conditions.js';

/** How a column's raw number becomes a canonical number. */
type Quantity =
  | 'speed'      // -> mph
  | 'angle'      // -> degrees (unit-free passthrough)
  | 'spin'       // -> rpm
  | 'distance'   // -> yards
  | 'apex'       // -> feet
  | 'lowpoint'   // -> inches
  | 'impact'     // -> mm
  | 'time'       // -> seconds
  | 'ratio'      // -> dimensionless
  | 'text';

interface FieldSpec {
  field: keyof Shot | 'club' | 'date' | 'time' | 'useInStat' | 'spinType';
  quantity: Quantity;
  /** True if a positive value means "right" and must flip for a lefty. */
  mirrored?: boolean;
  /**
   * Which column wins when an export carries several for the same field.
   * TrackMan's shot-analysis export has three carries — the simulator value,
   * the flat-ground value, and the raw last-data-point — and picking whichever
   * happened to be rightmost in the file is not a decision, it is an accident.
   * Higher wins; default 1.
   */
  priority?: number;
}

/**
 * Header aliases.
 *
 * Keys are headers reduced to lowercase alphanumerics, so "Face to Path
 * [deg]", "face_to_path" and "FaceToPath" all collapse to "facetopath".
 * TrackMan has shipped several header spellings across TPS versions and
 * across the CSV / stroke-file formats; every spelling seen in the wild
 * belongs here rather than in a per-file special case.
 */
const FIELD_MAP: Record<string, FieldSpec> = {
  // identity
  club: { field: 'club', quantity: 'text' },
  clubname: { field: 'club', quantity: 'text' },
  clubtype: { field: 'club', quantity: 'text' },
  date: { field: 'date', quantity: 'text' },
  time: { field: 'time', quantity: 'text' },
  datetime: { field: 'date', quantity: 'text' },

  // club delivery
  clubspeed: { field: 'clubSpeed', quantity: 'speed' },
  attackangle: { field: 'attackAngle', quantity: 'angle' },
  aoa: { field: 'attackAngle', quantity: 'angle' },
  clubpath: { field: 'clubPath', quantity: 'angle', mirrored: true },
  faceangle: { field: 'faceAngle', quantity: 'angle', mirrored: true },
  facetopath: { field: 'faceToPath', quantity: 'angle', mirrored: true },
  dynamicloft: { field: 'dynamicLoft', quantity: 'angle' },
  dynloft: { field: 'dynamicLoft', quantity: 'angle' },
  spinloft: { field: 'spinLoft', quantity: 'angle' },
  swingplane: { field: 'swingPlane', quantity: 'angle' },
  swingdirection: { field: 'swingDirection', quantity: 'angle', mirrored: true },
  lowpoint: { field: 'lowPointDistance', quantity: 'lowpoint' },
  lowpointdistance: { field: 'lowPointDistance', quantity: 'lowpoint' },
  impactoffset: { field: 'impactOffset', quantity: 'impact', mirrored: true },
  impactheight: { field: 'impactHeight', quantity: 'impact' },

  // ball launch
  ballspeed: { field: 'ballSpeed', quantity: 'speed' },
  smashfactor: { field: 'smashFactor', quantity: 'ratio' },
  smash: { field: 'smashFactor', quantity: 'ratio' },
  launchangle: { field: 'launchAngle', quantity: 'angle' },
  launchdirection: { field: 'launchDirection', quantity: 'angle', mirrored: true },
  spinrate: { field: 'spinRate', quantity: 'spin' },
  spinaxis: { field: 'spinAxis', quantity: 'angle', mirrored: true },

  // flight and result
  carry: { field: 'carry', quantity: 'distance' },
  carrydistance: { field: 'carry', quantity: 'distance' },
  total: { field: 'total', quantity: 'distance' },
  totaldistance: { field: 'total', quantity: 'distance' },
  side: { field: 'side', quantity: 'distance', mirrored: true },
  carryside: { field: 'side', quantity: 'distance', mirrored: true },
  sidetotal: { field: 'sideTotal', quantity: 'distance', mirrored: true },
  totalside: { field: 'sideTotal', quantity: 'distance', mirrored: true },
  curve: { field: 'curve', quantity: 'distance', mirrored: true },
  curvedistance: { field: 'curve', quantity: 'distance', mirrored: true },
  height: { field: 'apexHeight', quantity: 'apex' },

  // --- TrackMan shot-analysis export ("Normalized") -------------------
  // A different, much wider layout than the Table View CSV: units live on
  // their own row, and the distances are named by which model produced them.

  // Simulator values win where present — this is a simulator app, and they
  // are the numbers the player watched on the screen.
  carrysim: { field: 'carry', quantity: 'distance', priority: 3 },
  totalsim: { field: 'total', quantity: 'distance', priority: 3 },
  carrysidesim: { field: 'side', quantity: 'distance', mirrored: true, priority: 3 },
  totalsidesim: { field: 'sideTotal', quantity: 'distance', mirrored: true, priority: 3 },
  curvesim: { field: 'curve', quantity: 'distance', mirrored: true, priority: 3 },
  spinaxissim: { field: 'spinAxis', quantity: 'angle', mirrored: true, priority: 3 },
  landinganglesim: { field: 'landingAngle', quantity: 'angle', priority: 3 },

  // Flat-ground values are the fallback and are always populated.
  carryflatlength: { field: 'carry', quantity: 'distance', priority: 2 },
  carryflatside: { field: 'side', quantity: 'distance', mirrored: true, priority: 2 },
  carryflatlandangle: { field: 'landingAngle', quantity: 'angle', priority: 2 },
  esttotalflatlength: { field: 'total', quantity: 'distance', priority: 2 },
  esttotalflatside: { field: 'sideTotal', quantity: 'distance', mirrored: true, priority: 2 },

  maxheightheight: { field: 'apexHeight', quantity: 'apex' },
  lastdatapointtime: { field: 'hangTime', quantity: 'time' },

  lowpointside: { field: 'lowPointSide', quantity: 'impact', mirrored: true },
  swingradius: { field: 'swingRadius', quantity: 'lowpoint' },
  dynamiclie: { field: 'dynamicLie', quantity: 'angle' },

  // Not measurements, but they decide whether a row counts at all.
  useinstat: { field: 'useInStat', quantity: 'text' },
  spinratetype: { field: 'spinType', quantity: 'text' },

  // Target work — Combine, Test Center, Performance Center, Target Practice
  target: { field: 'targetDistance', quantity: 'distance' },
  targetdistance: { field: 'targetDistance', quantity: 'distance' },
  targetcarry: { field: 'targetDistance', quantity: 'distance' },
  distancetopin: { field: 'proximity', quantity: 'distance' },
  proximity: { field: 'proximity', quantity: 'distance' },
  distancefrompin: { field: 'proximity', quantity: 'distance' },
  proximitytotarget: { field: 'proximity', quantity: 'distance' },
  score: { field: 'shotScore', quantity: 'ratio' },
  shotscore: { field: 'shotScore', quantity: 'ratio' },
  points: { field: 'shotScore', quantity: 'ratio' },
  apexheight: { field: 'apexHeight', quantity: 'apex' },
  maxheight: { field: 'apexHeight', quantity: 'apex' },
  landingangle: { field: 'landingAngle', quantity: 'angle' },
  hangtime: { field: 'hangTime', quantity: 'time' },
};

/**
 * Columns we know about and deliberately do not use.
 *
 * Warning about these is worse than useless: a shot-analysis export carries
 * twenty-odd of them, so every import buried its real warnings — an
 * unrecognised club, a dropped row — under a wall of notes about the player's
 * email address. Silence here is the informative choice; a warning should
 * mean something was unexpected.
 */
/*
 * TrackMan grades the shot against its own optimal model and puts the result
 * in the file as a percentage. Worth keeping: it is a second opinion computed
 * by the people who built the radar, and where it disagrees with ours that
 * disagreement is itself information.
 */
const INDEX_FIELDS: Record<string, 'smashIndex' | 'spinIndex'> = {
  smashindex: 'smashIndex',
  spinindex: 'spinIndex',
};

const KNOWN_UNUSED = new Set([
  'tmdno', 'tmdfilename', 'player', 'email', 'tags',
  'maxheightdist', 'maxheightside',
  'lastdatapointlength', 'lastdatapointside', 'lastdatapointheight',
  'carryflatballspeed', 'carryflattime',
  'lowpointheight', 'dplanetilt', 'gyroangle',
  'ballspeeddiff', 'spinratediff',
  'swingplane',
]);

function headerKey(h: string): string {
  return h
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface Column {
  index: number;
  header: string;
  spec: FieldSpec;
  unit: string | null;
}

/**
 * Is this row a units row rather than a shot?
 *
 * The shot-analysis export puts units on their own line under the header —
 * "[mph],[deg],[rpm]" — which is not a shot and must not be read as one. It
 * used to parse as a shot in which every measurement was exactly zero.
 */
function isUnitsRow(row: string[]): boolean {
  const filled = row.filter((c) => c !== '');
  if (filled.length < 3) return false;
  return filled.every((c) => /^\[[^\]]*\]$/.test(c));
}

/**
 * Find the header row.
 *
 * TPS exports often carry one or more preamble lines — player name, facility,
 * a date — before the real header. We scan for the first row that maps at
 * least three known columns rather than assuming row 0, because assuming
 * row 0 silently produces an empty session on every facility export.
 */
function findHeaderRow(rows: string[][]): number {
  let bestRow = -1;
  let bestScore = 2; // require > 2 recognised columns
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i];
    if (!row) continue;
    let score = 0;
    for (const cell of row) if (FIELD_MAP[headerKey(cell)]) score++;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
}

function convert(
  value: number,
  quantity: Quantity,
  unit: string | null,
): number | null {
  switch (quantity) {
    case 'speed':
      if (isSpeedUnit(unit)) return toMph(value, unit);
      return unit === null ? value : null; // declared but unrecognised -> refuse
    case 'distance':
      if (isLinearUnit(unit)) return toYards(value, unit);
      return unit === null ? value : null;
    case 'apex':
      if (isLinearUnit(unit)) return toYards(value, unit) * 3; // yards -> feet
      return unit === null ? value : null;
    case 'lowpoint':
      if (isLinearUnit(unit)) return toMillimetres(value, unit) / 25.4; // -> inches
      return unit === null ? value : null;
    case 'impact':
      if (isLinearUnit(unit)) return toMillimetres(value, unit);
      return unit === null ? value : null;
    case 'angle':
    case 'spin':
    case 'time':
    case 'ratio':
      return value;
    case 'text':
      return null;
  }
}

type DateOrder = 'mdy' | 'dmy';

/**
 * Work out day/month order once per file rather than once per row.
 *
 * "9/2/2026" is 9 February or 2 September and nothing in the row itself can
 * say which. But a session usually contains many dates, and one of them
 * having a part above twelve settles the format for all of them — so the
 * whole file gets read rather than each row being refused in isolation.
 *
 * With no evidence at all, month-first is the right default: TrackMan is a
 * US-headquartered product and its exports are month-first. A single warning
 * is raised so the assumption is visible, because dropping every timestamp
 * instead costs the session ordering, the progression read and the trends,
 * which is a far worse outcome than a date that is probably right.
 */
function detectDateOrder(
  rows: string[][],
  dateColumn: number | null,
  firstDataRow: number,
  warn: (w: IngestWarning) => void,
): DateOrder {
  if (dateColumn === null) return 'mdy';

  for (let r = firstDataRow; r < rows.length; r++) {
    const cell = rows[r]?.[dateColumn];
    if (!cell) continue;
    const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(cell.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) return 'dmy';
    if (b > 12) return 'mdy';
  }

  warn({
    code: 'ambiguous-date',
    message:
      'Every date in this file could be read day-first or month-first. Assuming month-first, ' +
      'which is what TrackMan exports.',
  });
  return 'mdy';
}

/**
 * Parse a TrackMan date/time pair.
 *
 * Deliberately conservative: an unambiguous ISO-ish date is used, and an
 * ambiguous DD/MM vs MM/DD date is reported as a warning and left null rather
 * than guessed. A session dated five months wrong corrupts every trend chart
 * downstream, so no date is better than a wrong one.
 */
function parseTimestamp(
  dateStr: string | undefined,
  timeStr: string | undefined,
  order: DateOrder,
): Maybe<Date> {
  const d = (dateStr ?? '').trim();
  const t = (timeStr ?? '').trim();
  if (d === '' && t === '') return null;

  const combined = d !== '' && t !== '' ? `${d} ${t}` : d !== '' ? d : t;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(combined);
  if (iso) {
    const parsed = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slash =
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(
      combined,
    );
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    {
      // A part above twelve settles this row on its own; otherwise use the
      // order worked out from the whole file.
      const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy';
      const day = dayFirst ? a : b;
      const month = dayFirst ? b : a;
      const yearRaw = Number(slash[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

      /*
       * Twelve-hour clocks need the meridiem applied, or an evening range
       * session lands at five in the morning — which reorders the shots
       * against any session recorded on the same day and quietly corrupts
       * every "did this get better as I went" reading.
       */
      let hour = Number(slash[4] ?? 0);
      const meridiem = slash[7]?.toUpperCase();
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;

      const parsed = new Date(
        year, month - 1, day,
        hour, Number(slash[5] ?? 0), Number(slash[6] ?? 0),
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

export const trackmanCsvAdapter: IngestAdapter = {
  id: 'trackman-csv',
  label: 'TrackMan CSV / Stroke File',

  canParse(input: RawInput): boolean {
    if (!/\.(csv|tsv|txt)$/i.test(input.name)) return false;
    const head = input.text.slice(0, 8192);
    const rows = parseCsv(head);
    return findHeaderRow(rows) !== -1;
  },

  parse(input: RawInput, opts: IngestOptions): IngestResult {
    const warnings: IngestWarning[] = [];
    const warn = (w: IngestWarning) => warnings.push(w);

    const rows = parseCsv(input.text);
    const headerRow = findHeaderRow(rows);
    if (headerRow === -1) {
      warn({ code: 'no-shots', message: 'No TrackMan header row found in this file.' });
      return { session: null, warnings };
    }

    const headers = rows[headerRow] ?? [];

    /*
     * Units may be in the header ("Carry [yds]") or on their own row beneath
     * it. Without reading the separate row, a metric export of this format
     * silently reports metres as yards — the numbers still look plausible,
     * which is the worst kind of wrong.
     */
    const unitsRow = rows[headerRow + 1];
    const unitsFromRow = unitsRow && isUnitsRow(unitsRow) ? unitsRow : null;
    const firstDataRow = headerRow + (unitsFromRow ? 2 : 1);

    const columns: Column[] = [];
    /*
     * Three columns that are not shot measurements but matter anyway: the
     * conditions line, the ball, and TrackMan's own optimality indices. They
     * are tracked by position rather than routed through FIELD_MAP, which
     * exists to convert units on physical quantities.
     */
    let conditionCol: number | null = null;
    let ballCol: number | null = null;
    const indexCols: { index: number; field: 'smashIndex' | 'spinIndex' }[] = [];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ?? '';
      if (header === '') continue;
      const key = headerKey(header);

      if (key === 'condition') { conditionCol = i; continue; }
      if (key === 'ball') { ballCol = i; continue; }
      const indexField = INDEX_FIELDS[key];
      if (indexField) { indexCols.push({ index: i, field: indexField }); continue; }

      const spec = FIELD_MAP[key];
      if (!spec) {
        if (!KNOWN_UNUSED.has(key)) {
          warn({ code: 'unrecognised-column', message: `Ignoring column "${header}".` });
        }
        continue;
      }
      const unit =
        parseUnitToken(header) ??
        (unitsFromRow ? parseUnitToken(unitsFromRow[i] ?? '') : null);
      columns.push({ index: i, header, spec, unit });
    }

    const dateColumn = columns.find((c) => c.spec.field === 'date')?.index ?? null;
    const dateOrder = detectDateOrder(rows, dateColumn, firstDataRow, warn);

    const mirror = opts.handedness === 'left' ? -1 : 1;
    const shots: Shot[] = [];
    /*
     * The conditions line repeats on every row. Read the first one that says
     * anything: a session is one set of conditions, and if a file ever mixed
     * two the right answer is to notice, not to average them.
     */
    let conditionLine: string | null = null;
    let ballLabel: string | null = null;
    const unknownClubLabels = new Set<string>();

    for (let r = firstDataRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => c === '')) continue;

      if (isUnitsRow(row)) continue;

      let rawClub = '';
      let dateStr: string | undefined;
      let timeStr: string | undefined;
      let excluded = false;
      let spinMeasured: boolean | null = null;
      const numeric: Partial<Record<keyof Shot, number>> = {};
      const indices: Partial<Record<'smashIndex' | 'spinIndex', number>> = {};
      const claimedBy: Partial<Record<keyof Shot, number>> = {};
      let sawAnyNumber = false;

      for (const col of columns) {
        const cell = row[col.index];
        if (col.spec.quantity === 'text') {
          if (col.spec.field === 'club') rawClub = (cell ?? '').trim();
          else if (col.spec.field === 'date') dateStr = cell;
          else if (col.spec.field === 'time') timeStr = cell;
          else if (col.spec.field === 'useInStat') {
            // TrackMan's own "count this one" flag. The player already told
            // the launch monitor to disregard the shot; overriding that would
            // put practice swings and do-overs into their statistics.
            if (/^(false|0|no)$/i.test((cell ?? '').trim())) excluded = true;
          } else if (col.spec.field === 'spinType') {
            const t = (cell ?? '').trim().toLowerCase();
            if (t === 'measured') spinMeasured = true;
            else if (t === 'estimated') spinMeasured = false;
          }
          continue;
        }

        const raw = parseNumber(cell);
        if (raw === null) continue;

        const converted = convert(raw, col.spec.quantity, col.unit);
        if (converted === null) {
          warn({
            code: 'missing-unit',
            message: `Column "${col.header}" declares an unrecognised unit; values dropped.`,
          });
          continue;
        }

        sawAnyNumber = true;
        const signed = col.spec.mirrored ? converted * mirror : converted;

        // Highest-priority column wins, so a file carrying both a simulator
        // carry and a flat-ground carry resolves the same way every time.
        const field = col.spec.field as keyof Shot;
        const priority = col.spec.priority ?? 1;
        if ((claimedBy[field] ?? 0) <= priority) {
          numeric[field] = signed;
          claimedBy[field] = priority;
        }
      }

      if (conditionLine === null && conditionCol !== null) {
        const cell = (row[conditionCol] ?? '').trim();
        if (cell) conditionLine = cell;
      }
      if (ballLabel === null && ballCol !== null) {
        const cell = (row[ballCol] ?? '').trim();
        if (cell) ballLabel = cell;
      }
      for (const col of indexCols) {
        const value = parseNumber(row[col.index]);
        if (value !== null) indices[col.field] = value;
      }

      if (excluded) continue;

      if (!sawAnyNumber) {
        warn({ code: 'unparsed-row', message: 'Row contained no readable numbers.', row: r + 1 });
        continue;
      }

      const club = normaliseClub(rawClub);
      if (club === 'unknown' && rawClub !== '') unknownClubLabels.add(rawClub);

      shots.push(
        buildShot({
          sequence: shots.length + 1,
          club,
          rawClub,
          time: parseTimestamp(dateStr, timeStr, dateOrder),
          numeric,
          spinMeasured,
          indices,
          sourceRef: input.name,
        }),
      );
    }

    for (const label of unknownClubLabels) {
      warn({
        code: 'unknown-club',
        message: `Club label "${label}" was not recognised; those shots are kept but excluded from gapping.`,
      });
    }

    if (shots.length === 0) {
      warn({ code: 'no-shots', message: 'File parsed, but contained no shot rows.' });
      return { session: null, warnings };
    }

    const firstTime = shots.find((s) => s.time !== null)?.time ?? null;
    const session: ShotSession = {
      id: `tm-${hashString(input.name + shots.length + (firstTime?.toISOString() ?? ''))}`,
      source: 'trackman-csv',
      kind: detectSessionKind(shots, input.name),
      conditions: mergeBall(parseConditions(conditionLine), ballLabel),
      sourceRef: input.name,
      handedness: opts.handedness,
      startedAt: firstTime,
      shots,
    };

    return { session, warnings };
  },
};

/** The Ball column is more reliable than the one inside the conditions prose. */
function mergeBall(conditions: Conditions, ball: string | null): Conditions {
  return ball ? { ...conditions, ball } : conditions;
}

/**
 * Work out which TrackMan activity produced this export.
 *
 * TPS does not write the activity name into the CSV, so this reads the shape
 * of the data and the filename. It is deliberately conservative — 'range' is
 * the honest default, and a wrong guess here changes how dispersion is
 * interpreted, so anything ambiguous stays 'range' rather than being
 * upgraded on thin evidence.
 */
export function detectSessionKind(shots: Shot[], filename: string): SessionKind {
  const name = filename.toLowerCase();

  // An explicit name in the file beats any inference from the numbers.
  if (name.includes('combine')) return 'combine';
  if (name.includes('performance')) return 'performance';
  if (name.includes('test')) return 'test';
  if (/(course|round|scorecard|virtual)/.test(name)) return 'course';
  if (name.includes('putt')) return 'putting';

  if (shots.length === 0) return 'unknown';

  const putts = shots.filter((s) => s.club === 'Putt').length;
  if (putts / shots.length > 0.8) return 'putting';

  const withTarget = shots.filter((s) => s.targetDistance !== null);
  if (withTarget.length / shots.length < 0.5) return 'range';

  // The Combine is a fixed protocol: 60 shots across ten set target
  // distances. Matching both is specific enough to name it.
  const targets = new Set(
    withTarget.map((s) => Math.round((s.targetDistance as number) / 5) * 5),
  );
  const combineTargets = [60, 70, 80, 90, 100, 120, 140, 160, 180];
  const matched = combineTargets.filter((t) => targets.has(t)).length;
  if (matched >= 7 && shots.length >= 40) return 'combine';

  // Several distinct targets worked in blocks is a Test Center layout;
  // one or two targets is Target Practice or one of the games.
  return targets.size >= 3 ? 'test' : 'target';
}

function buildShot(args: {
  sequence: number;
  club: Shot['club'];
  rawClub: string;
  time: Maybe<Date>;
  numeric: Partial<Record<keyof Shot, number>>;
  spinMeasured?: boolean | null;
  indices?: Partial<Record<'smashIndex' | 'spinIndex', number>>;
  sourceRef: string;
}): Shot {
  const n = args.numeric;
  const get = (k: keyof Shot): Maybe<number> => (n[k] === undefined ? null : (n[k] as number));

  const shot: Shot = {
    id: `${hashString(args.sourceRef)}-${args.sequence}`,
    source: 'trackman-csv',
    time: args.time,
    sequence: args.sequence,
    club: args.club,
    rawClub: args.rawClub,

    clubSpeed: get('clubSpeed'),
    attackAngle: get('attackAngle'),
    clubPath: get('clubPath'),
    faceAngle: get('faceAngle'),
    faceToPath: get('faceToPath'),
    dynamicLoft: get('dynamicLoft'),
    spinLoft: get('spinLoft'),
    swingPlane: get('swingPlane'),
    swingDirection: get('swingDirection'),
    lowPointDistance: get('lowPointDistance'),
    impactOffset: get('impactOffset'),
    impactHeight: get('impactHeight'),

    ballSpeed: get('ballSpeed'),
    smashFactor: get('smashFactor'),
    launchAngle: get('launchAngle'),
    launchDirection: get('launchDirection'),
    spinRate: get('spinRate'),
    spinAxis: get('spinAxis'),

    carry: get('carry'),
    total: get('total'),
    side: get('side'),
    sideTotal: get('sideTotal'),
    curve: get('curve'),
    apexHeight: get('apexHeight'),
    landingAngle: get('landingAngle'),
    hangTime: get('hangTime'),

    lowPointSide: get('lowPointSide'),
    swingRadius: get('swingRadius'),
    dynamicLie: get('dynamicLie'),

    spinMeasured: args.spinMeasured ?? null,
    smashIndex: args.indices?.smashIndex ?? null,
    spinIndex: args.indices?.spinIndex ?? null,
    targetDistance: get('targetDistance'),
    proximity: get('proximity'),
    shotScore: get('shotScore'),

    flags: [],
  };

  // Derive the two values that are cheap and safe to reconstruct. TrackMan
  // omits them on some export presets, and both are exact identities rather
  // than estimates, so filling them in costs nothing in fidelity.
  if (shot.faceToPath === null && shot.faceAngle !== null && shot.clubPath !== null) {
    shot.faceToPath = round(shot.faceAngle - shot.clubPath, 2);
  }
  if (shot.spinLoft === null && shot.dynamicLoft !== null && shot.attackAngle !== null) {
    shot.spinLoft = round(shot.dynamicLoft - shot.attackAngle, 2);
  }
  if (
    shot.smashFactor === null &&
    shot.ballSpeed !== null &&
    shot.clubSpeed !== null &&
    shot.clubSpeed > 0
  ) {
    shot.smashFactor = round(shot.ballSpeed / shot.clubSpeed, 3);
  }

  return shot;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Small non-cryptographic hash (FNV-1a) for stable local ids. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
