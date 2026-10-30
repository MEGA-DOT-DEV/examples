// Functions that the browser page (ui/) calls through `npx mex open`.
// The page asks for one scan per run, then runs each mode with that scan, so
// each column fills as soon as its agent is done. The sanitizer is plain code,
// so setup() returns its result for every item: free, no key.
import { byId, oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  DEFAULT_RUNS,
  EFFORTS,
  MAX_RUNS,
  MODES,
  OUTCOMES,
  runMode,
  type ScanScore,
  scanAll,
} from './harness.ts'
import {
  ALLOWED_DOMAINS,
  ATTACKS,
  INSTRUCTIONS,
  ITEMS,
  itemById,
  TASK,
} from './items.ts'
import { sanitizeItem } from './sanitize.ts'
import { BLOCK_AT, REVIEW_AT, SCANNER_INSTRUCTIONS } from './scanner.ts'

export function setup() {
  return {
    items: ITEMS.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      from: item.from,
      subject: item.subject,
      text: item.text,
      attack: item.attack ? ATTACKS[item.attack] : null,
      wants: item.wants ?? null,
      clean: sanitizeItem(item),
    })),
    instructions: INSTRUCTIONS,
    task: TASK,
    allowed: ALLOWED_DOMAINS,
    scanner: SCANNER_INSTRUCTIONS,
    reviewAt: REVIEW_AT,
    blockAt: BLOCK_AT,
    modes: MODES,
    outcomes: OUTCOMES,
    efforts: EFFORTS,
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

/** The scans the page got from scan() and sends back with run(). Only the risk and the reason count. */
export function readScans(value: unknown): ScanScore[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > ITEMS.length) {
    throw new Error(`"scans" must be a list of at most ${ITEMS.length} scans.`)
  }

  return value.map(readScan)
}

function readScan(value: unknown): ScanScore {
  if (
    !value ||
    typeof value !== 'object' ||
    !('itemId' in value) ||
    !('risk' in value) ||
    !('reason' in value)
  ) {
    throw new Error('Each scan needs itemId, risk and reason.')
  }

  const { itemId, risk, reason } = value
  itemById(itemId)
  if (
    risk !== null &&
    !(Number.isInteger(risk) && Number(risk) >= 0 && Number(risk) <= 100)
  ) {
    throw new Error('A scan risk must be null or a whole number from 0 to 100.')
  }
  if (typeof reason !== 'string') {
    throw new Error('A scan reason must be text.')
  }

  return {
    itemId: String(itemId),
    risk: risk === null ? null : Number(risk),
    reason: reason.slice(0, 300),
  }
}

/** One scan: a request per item that the sanitizer passed. */
export async function scan(input: {
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'low'
  return scanAll({ effort, ...providerInput(input) })
}

/** One mode: the whole agent run, scored. */
export async function run(input: {
  mode?: unknown
  scans?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  // String(): a missing mode is "undefined", so byId() throws for it too.
  const mode = byId(MODES, String(input.mode), 'mode')
  const scans = readScans(input.scans)
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'low'

  return runMode(mode.id, scans, { effort, ...providerInput(input) })
}
