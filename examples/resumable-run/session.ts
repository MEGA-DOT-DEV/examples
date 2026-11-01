// One session of a job, run as its own OS process. Only the saved files
// cross from one session to the next.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NO_USAGE } from '#shared/llm.ts'
import { CRASH_EXIT_CODE, JOBS, MODES, Session, type Trace } from './run.ts'

const [directory, jobId, modeId, phaseText, provider, model] =
  process.argv.slice(2)
const job = JOBS.find((item) => item.id === jobId)
const mode = MODES.find((item) => item === modeId)
if (
  !directory ||
  !job ||
  !mode ||
  !['1', '2', '3'].includes(phaseText) ||
  !['openai', 'openrouter'].includes(provider)
) {
  throw new Error('Invalid saved session parameters.')
}

const phase = Number(phaseText)
const trace: Trace[] = [
  { session: phase, event: 'process', detail: String(process.pid) },
]
const usage = { total: { ...NO_USAGE }, model: '' }
const session = new Session(
  directory,
  job,
  mode,
  phase,
  { provider, model: model || undefined },
  trace,
  usage,
)

let finished = false
if (phase === 1) {
  await session.begin()
}
if (phase === 2) {
  await session.approveAndCrash()
}
if (phase === 3) {
  finished = await session.resume()
}

await writeFile(
  join(directory, `session-${phase}.json`),
  JSON.stringify({ trace, usage, finished }),
)
// A crash is an abnormal exit after the effect, while its result is absent
// from the thread.
if (phase === 2) {
  process.exitCode = CRASH_EXIT_CODE
}
