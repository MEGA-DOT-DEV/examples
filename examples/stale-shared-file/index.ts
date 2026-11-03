// Subscribe to another schedule
// Run: npx mex run stale-shared-file [--runs 1-5]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId, wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { bold, dim, plural, red, section } from '#shared/print.ts'
import { SOURCE_IDS } from './morning.ts'
import {
  type BriefRun,
  clockText,
  DEFAULT_RUNS,
  MAX_RUNS,
  MODES,
  runTrials,
  type Trial,
} from './schedule.ts'

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: String(DEFAULT_RUNS) },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}". Use --runs 1-${MAX_RUNS}.`)
  }
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)

  // Check the key before the first output.
  pickProvider(flags.provider)

  const what =
    'research, then the clock brief and the subscribed brief on the same research.md.'
  console.log(dim(`${plural(runs, 'run')}: ${what}`))

  const { trials, summary } = await runTrials(runs, flags)
  trials.forEach(printTrial)

  section('Result')
  console.log(summary.headline)
  console.log(summary.detail)
  console.log(
    dim(`${summary.requests} requests · ${formatUsage(summary.usage)}`),
  )
}

function printTrial(trial: Trial, index: number) {
  section(`Run ${index + 1}`)
  const delays = SOURCE_IDS.map((id) => `${id} ${trial.delays[id]} min`)
  console.log(dim(`Source delays, drawn for this run: ${delays.join(', ')}`))

  const { research } = trial
  // The newest version of research.md. Yesterday's version has no time.
  const written = trial.file.at(-1)?.at ?? null
  const span = `${clockText(research.start)} to ${clockText(research.done)}`
  const wrote =
    written === null
      ? 'did not write research.md'
      : `wrote research.md at ${clockText(written)}`
  console.log(`${bold('Research')} (${research.trigger}): ${span}, ${wrote}`)

  for (const brief of trial.briefs) {
    printBrief(brief)
  }
}

function printBrief(brief: BriefRun) {
  const sent = brief.sends[0]
  const label = byId(MODES, brief.mode, 'mode').label
  console.log(`\n${bold(label)} (brief: ${brief.trigger})`)

  const read = brief.read ? `${brief.read}'s research.md` : 'no file'
  const when = sent ? `sent ${clockText(sent.at)}` : 'sent nothing'
  console.log(`  Started ${clockText(brief.start)}, read ${read}, ${when}.`)

  // Code marks each sentence that carries a fact from yesterday's file.
  const text = brief.check.segments
    .map((segment) => (segment.stale ? red(segment.text) : segment.text))
    .join('')
  if (text) {
    console.log(`  ${text.replace(/\n/g, '\n  ')}`)
  }
  if (brief.read === 'yesterday') {
    console.log(saidOldText(brief.saidOld))
  }
  if (!sent) {
    console.log(dim(`  Last answer: ${brief.answer}`))
  }

  console.log(
    dim(`  ${brief.steps.length} requests · ${formatUsage(brief.usage)}`),
  )
}

/** Does Angie learn that the research is from yesterday? */
function saidOldText(said: BriefRun['saidOld']) {
  const notSaid =
    '  The brief does not say that the research is from yesterday.'
  if (!said) {
    return dim(notSaid)
  }
  if (said.in === 'brief') {
    return '  The brief says that the research is from yesterday.'
  }

  return `${notSaid} Only the agent's last reply does: "${said.text}"`
}

await runCli(main)
