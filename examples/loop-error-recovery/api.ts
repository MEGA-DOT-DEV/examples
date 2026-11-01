// What the Try it page calls: the faults and modes to pick from, and one run
// of the audit in one mode.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  EVENT_LABELS,
  FAULT_LABELS,
  FAULTS,
  MODE_LABELS,
  MODES,
  runRecovery,
} from './recovery.ts'

export function setup() {
  return {
    faults: FAULTS.map((id) => ({ id, label: FAULT_LABELS[id] })),
    modes: MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
    events: EVENT_LABELS,
  }
}

export async function run(input: {
  fault?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const fault = oneOf(input?.fault, FAULTS, 'fault')
  const mode = oneOf(input?.mode, MODES, 'mode')
  if (!fault || !mode) {
    throw new Error('Select a fault and a mode.')
  }

  return runRecovery({ fault, mode, ...providerInput(input) })
}
