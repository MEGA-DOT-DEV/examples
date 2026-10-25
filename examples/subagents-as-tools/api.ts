// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs both main threads itself, one step() call per step, so the
// chart grows as each step ends. The conversation travels with each call.
// A step that calls spawn_subagent runs whole subagent threads before it
// returns.
import { oneOf, wholeNumber } from '#shared/input.ts'
import { providerInput, readInputItems } from '#shared/llm.ts'
import {
  contractOf,
  expected,
  FIELD_NAMES,
  tierPrice,
  VENDORS,
  type Vendor,
} from './contracts.ts'
import {
  EFFORTS,
  MAIN_INSTRUCTIONS,
  MAIN_MAX_STEPS,
  MODES,
  mainStep,
  mainThread,
  SINGLE_INSTRUCTIONS,
  SUBAGENT_INSTRUCTIONS,
  TASK,
} from './extract.ts'
import { stepLimitText } from './loop.ts'
import { ERROR_LABELS } from './score.ts'
import { FOLDER } from './tools.ts'

// The one agent's conversation holds all sixteen contracts.
const ITEM_LIMITS = { items: 120, chars: 600_000 }

export function setup() {
  return {
    task: TASK,
    efforts: EFFORTS,
    maxSteps: MAIN_MAX_STEPS,
    folder: FOLDER,
    fields: FIELD_NAMES,
    errorLabels: ERROR_LABELS,
    contracts: VENDORS.map((vendor) => ({
      file: vendor.file,
      vendor: vendor.name,
      lines: contractOf(vendor).split('\n').length,
      traps: traps(vendor),
    })),
    instructions: {
      single: SINGLE_INSTRUCTIONS,
      main: MAIN_INSTRUCTIONS,
      subagent: SUBAGENT_INSTRUCTIONS,
    },
    tools: {
      single: mainThread('single', {}).tools.map((t) => t.definition),
      subagents: mainThread('subagents', {}).tools.map((t) => t.definition),
    },
  }
}

/** What can mislead a reader in each contract: the later order form and the amendments. */
function traps(vendor: Vendor): string[] {
  const list: string[] = []
  if (vendor.addedSeats) {
    list.push(orderFormTrap(vendor))
  }
  if (vendor.amendedNoticeDays) {
    const days = `${vendor.noticeDays} → ${vendor.amendedNoticeDays} days`
    list.push(`Amendment: notice ${days}`)
  }
  if (vendor.amendedTermEnd) {
    const end = `${vendor.termEnd} → ${vendor.amendedTermEnd}`
    list.push(`Amendment: term end ${end}`)
  }

  return list
}

function orderFormTrap(vendor: Vendor) {
  const want = expected(vendor)
  const seats = `${vendor.seats} → ${want.seats}`
  const newTier = want.price_per_seat_eur !== tierPrice(vendor, vendor.seats)
  const tier = newTier ? ', a new price tier' : ''

  return `Order Form No. 2 adds ${vendor.addedSeats} seats: ${seats}${tier}`
}

type StepInput = {
  mode?: unknown
  items?: unknown
  number?: unknown
  provider?: unknown
  model?: unknown
  subagentModel?: unknown
  effort?: unknown
}

export async function step(input: StepInput) {
  const mode = oneOf(input.mode, MODES, 'mode')
  const number = wholeNumber(input.number, 'number', 1, MAIN_MAX_STEPS)
  if (!mode || !number) {
    throw new Error('Send a mode and a step number.')
  }

  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? 'none'
  const subagentModel =
    typeof input.subagentModel === 'string'
      ? input.subagentModel.trim().slice(0, 200)
      : ''

  const result = await mainStep(
    mode,
    { ...providerInput(input), subagentModel, effort },
    readInputItems(input.items, ITEM_LIMITS),
    number,
  )

  return {
    ...result,
    stopText:
      result.end === 'step_limit' ? stepLimitText(MAIN_MAX_STEPS) : null,
  }
}
