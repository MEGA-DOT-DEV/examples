// Functions that the browser page (ui/) calls through `npx mex open`.
// The page runs the mornings itself: skill mornings in parallel, script
// mornings in order. The saved script stays on this side, in memory, under
// a run ID: the page never sends code to run.
import { randomUUID } from 'node:crypto'
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { LABELS, SCORED } from './brief.ts'
import {
  answerKey,
  checkDay,
  DATES,
  DAYS,
  RENAME,
  RENAME_DAY,
  snapshot,
} from './days.ts'
import { lineDiff } from './diff.ts'
import {
  checkRepeatDay,
  DEFAULT_EFFORT,
  DEFAULT_REPEAT_DAY,
  EFFORTS,
  REPEATS,
  SCRIPT_INSTRUCTIONS,
  SKILL,
  SKILL_INSTRUCTIONS,
  scriptDay,
  skillDay,
} from './week.ts'

/** Saved scripts by run ID. A few runs at a time; the oldest goes first. */
const scripts = new Map<string, string | null>()
const MAX_RUNS = 20

export function setup() {
  return {
    days: DAYS,
    dates: DATES,
    renameDay: RENAME_DAY,
    rename: RENAME,
    skill: SKILL,
    instructions: { skill: SKILL_INSTRUCTIONS, script: SCRIPT_INSTRUCTIONS },
    efforts: EFFORTS,
    effort: DEFAULT_EFFORT,
    repeats: REPEATS,
    repeatDay: DEFAULT_REPEAT_DAY,
    scored: SCORED,
    labels: LABELS,
    mornings: DATES.map((date, i) => ({
      day: i + 1,
      date,
      data: snapshot(i + 1),
      key: answerKey(i + 1),
    })),
  }
}

/** A. One morning with the skill. */
export function skill(input: {
  day?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  return skillDay(checkDay(input.day), {
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? DEFAULT_EFFORT,
    ...providerInput(input),
  })
}

/**
 * B. One morning with the saved script. Day 1 starts a run and returns its
 * ID; later days send the ID back and use the script that run saved.
 */
export async function script(input: {
  day?: unknown
  runId?: unknown
  repeatDay?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const day = checkDay(input.day)
  const repeatDay = checkRepeatDay(input.repeatDay)
  const options = {
    effort: oneOf(input.effort, EFFORTS, 'effort') ?? DEFAULT_EFFORT,
    ...providerInput(input),
    runs: day === repeatDay ? REPEATS : 1,
  }
  const { runId, before } =
    day === 1 ? { runId: randomUUID(), before: null } : savedRun(input.runId)

  const run = await scriptDay(day, before, options)
  keepScript(runId, run.code ?? null)

  return { ...run, runId, repair: repairDiff(before, run.code) }
}

/** The run that the page started on day 1, and the script it holds now. */
function savedRun(runId: unknown) {
  if (typeof runId !== 'string' || !scripts.has(runId)) {
    throw new Error(
      'This run is gone (the viewer restarted). Run the week again.',
    )
  }

  return { runId, before: scripts.get(runId) ?? null }
}

/** Keeps the run's script as the newest. The oldest runs go past MAX_RUNS. */
function keepScript(runId: string, code: string | null) {
  scripts.delete(runId)
  scripts.set(runId, code)
  for (const oldest of scripts.keys()) {
    if (scripts.size <= MAX_RUNS) {
      break
    }
    scripts.delete(oldest)
  }
}

/** Where a repair changed the script, or null when it did not change. */
function repairDiff(before: string | null, after: string | null | undefined) {
  if (before === null || !after || after === before) {
    return null
  }

  return lineDiff(before, after)
}
