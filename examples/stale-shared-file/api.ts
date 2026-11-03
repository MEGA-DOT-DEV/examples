// Functions that the browser page (ui/) calls through `npx mex open`.
import { wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  SOURCE_IDS,
  SOURCES,
  TODAY,
  YESTERDAY,
  YESTERDAY_FILE,
} from './morning.ts'
import {
  BRIEF_INSTRUCTIONS,
  BRIEF_TASK,
  BRIEF_TOOLS,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  RESEARCH_INSTRUCTIONS,
  RESEARCH_TASK,
  RESEARCH_TOOLS,
  RESEARCH_TRIGGER,
  runTrials,
  triggerText,
} from './schedule.ts'

export function setup() {
  return {
    today: TODAY,
    yesterday: YESTERDAY,
    sources: SOURCE_IDS.map((id) => ({
      id,
      text: SOURCES[id].text,
      minutes: SOURCES[id].minutes,
    })),
    yesterdayFile: YESTERDAY_FILE,
    research: {
      trigger: triggerText(RESEARCH_TRIGGER),
      instructions: RESEARCH_INSTRUCTIONS,
      task: RESEARCH_TASK,
      tools: RESEARCH_TOOLS,
    },
    brief: {
      instructions: BRIEF_INSTRUCTIONS,
      task: BRIEF_TASK,
      tools: BRIEF_TOOLS,
    },
    modes: MODES.map((m) => ({
      id: m.id,
      label: m.label,
      brief: m.brief,
      trigger: triggerText(m.trigger),
    })),
    maxRuns: MAX_RUNS,
    defaultRuns: DEFAULT_RUNS,
  }
}

/** Runs research and both briefs, `runs` times side by side. */
export async function run(input: {
  runs?: unknown
  provider?: unknown
  model?: unknown
}) {
  const runs = wholeNumber(input.runs, 'Runs', 1, MAX_RUNS) ?? DEFAULT_RUNS

  return runTrials(runs, providerInput(input))
}
