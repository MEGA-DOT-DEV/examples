// Self-querying
// Run: npx mex run self-querying [Fe Au W K] [--runs 5] [--effort none|low]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { MissingKeyError } from '#shared/env.ts'
import { oneOf, wholeNumber } from '#shared/input.ts'
import { costText, sumUsage, type Usage } from '#shared/llm.ts'
import { bold, dim, errorText, green, red, section } from '#shared/print.ts'
import { type Grading, grade, type RunText } from './grader.ts'
import {
  type Comparison,
  compare,
  EFFORTS,
  MAX_RUNS,
  type ModeRun,
  type Notes,
  rate,
  type SelfQuestion,
} from './selfquery.ts'

type Settled = PromiseSettledResult<ModeRun>

async function main() {
  const { flags, words } = cliArgs({
    runs: { type: 'string', default: '5' },
    effort: { type: 'string', default: 'none' },
  })
  const runs = wholeNumber(flags.runs, '--runs', 1, MAX_RUNS)
  const effort = oneOf(flags.effort, EFFORTS, 'effort')
  const { provider, model } = flags
  const symbols = words.length ? words : undefined

  // compare() checks the key before the first request.
  const result = await compare({ symbols, effort, provider, model, runs })
  const all = finished([...result.direct, ...result.selfQuerying])
  const sample = all[0]?.answer

  console.log(`${bold('Question:')} ${result.task.question}`)
  const where = sample ? ` · ${sample.provider} · ${sample.model}` : ''
  console.log(dim(`Effort ${effort}${where}`))

  printResult(result)
  printNotes(result.selfQuerying)

  const grading = await secondCheck(result, provider)
  printTotals(all, grading)
}

function finished(runs: Settled[]) {
  return runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}

const runName = (id: string) =>
  `${id[0] === 'A' ? 'Direct' : 'Self-querying'} ${id.slice(1)}`

// The result first: code reads the number in each reply and compares it with
// the periodic table.
function printResult(result: Comparison) {
  section('Result')
  const modes = [
    ['Direct', result.direct],
    ['Self-querying', result.selfQuerying],
  ] as const

  for (const [label, modeRuns] of modes) {
    const r = rate(modeRuns)
    const score = bold(`${r.right} of ${modeRuns.length} right`)
    console.log(`  ${label.padEnd(14)} ${score}   ${replies(modeRuns)}`)

    // Reasoning tokens come before the reply, like step 1, but hidden.
    const reasoning = finished(modeRuns).reduce(
      (sum, x) =>
        sum +
        x.answer.usage.reasoningTokens +
        (x.notes?.usage.reasoningTokens ?? 0),
      0,
    )

    if (reasoning) {
      const perRun = Math.round(reasoning / r.done)
      const note = `about ${perRun} hidden reasoning tokens per run`
      console.log(dim(`  ${''.padEnd(14)} ${note}, before the reply`))
    }
  }

  const { facts, sum } = result.task
  const terms = facts.map((f) => `${f.symbol} ${f.number}`).join(' + ')
  console.log(
    dim(`  Right answer: ${terms} = ${sum}, from the periodic table.`),
  )

  printFailures('A', result.direct)
  printFailures('B', result.selfQuerying)
}

// Every reply as a number: right in green, wrong in red.
function replies(runs: Settled[]) {
  return runs
    .map((r) => {
      if (r.status === 'rejected') {
        return red('failed')
      }

      const { answer, right } = r.value.answer.check
      const text = answer === null ? 'no number' : String(answer)

      return (right ? green : red)(text)
    })
    .join(' ')
}

function printFailures(letter: 'A' | 'B', runs: Settled[]) {
  runs.forEach((r, i) => {
    if (r.status === 'rejected') {
      const name = runName(`${letter}${i + 1}`)
      console.log(red(`  ${name} failed: ${errorText(r.reason)}`))
    }
  })
}

// Step 1, once: the notes that step 2 read before it replied.
function printNotes(runs: Settled[]) {
  section('What self-querying put into the context')
  const groups = groupNotes(runs)

  for (const { notes, runs: ids } of groups) {
    const whole = groups.length === 1 && ids.length === runs.length
    console.log(dim(`  ${groupLabel(ids, whole)}:`))

    if (notes.questions.length) {
      for (const q of notes.questions) {
        console.log(`    ${q.question}  ${answerText(q)}`)
      }
    } else {
      console.log(`    ${notes.text.trim().replace(/\n/g, '\n    ')}`)
    }
  }
}

// Runs with the same questions and answers in step 1 print as one group.
function groupNotes(runs: Settled[]) {
  const groups = new Map<string, { notes: Notes; runs: number[] }>()
  runs.forEach((r, i) => {
    const notes = r.status === 'fulfilled' ? r.value.notes : undefined
    if (!notes) {
      return
    }

    const key = notes.questions.length
      ? JSON.stringify(notes.questions)
      : notes.text.trim()

    if (!groups.has(key)) {
      groups.set(key, { notes, runs: [] })
    }

    groups.get(key)?.runs.push(i + 1)
  })

  return [...groups.values()]
}

function groupLabel(ids: number[], whole: boolean) {
  if (whole) {
    return `All ${ids.length} runs`
  }

  const word = ids.length === 1 ? 'Run' : 'Runs'
  return `${word} ${ids.join(', ')}`
}

/** The model's own answer, or what the table says when it is wrong. */
function answerText(q: SelfQuestion) {
  if (q.fact?.wrong) {
    return red(`${q.answer}, the table says ${q.fact.table}`)
  }

  return bold(q.answer || '(no answer)')
}

// Then one more request: a second model reads every finished run.
async function secondCheck(result: Comparison, provider?: string) {
  const texts = runTexts(result)

  section('Second check')
  console.log(
    dim(
      '  A second model (a grader) reads each run: its final number and the facts before it.',
    ),
  )

  let grading: Grading | null = null
  try {
    if (texts.length) {
      grading = await grade({ symbols: result.symbols, runs: texts, provider })
    }
  } catch (error) {
    if (error instanceof MissingKeyError) {
      throw error
    }
    console.log(
      red(
        `  The second check failed: ${errorText(error)} The result above does not need it.`,
      ),
    )
  }

  if (grading) {
    printGrading(grading)
  }

  return grading
}

function runTexts(result: Comparison) {
  const texts: RunText[] = []

  result.direct.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      texts.push({
        id: `A${i + 1}`,
        mode: 'direct',
        reply: r.value.answer.text,
      })
    }
  })

  result.selfQuerying.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.notes) {
      texts.push({
        id: `B${i + 1}`,
        mode: 'self-querying',
        notes: r.value.notes.text,
        reply: r.value.answer.text,
      })
    }
  })

  return texts
}

function printGrading(grading: Grading) {
  const { agree, runs } = grading
  console.log(
    `  It agrees with the code check in ${agree} of ${runs.length} runs.`,
  )

  for (const r of runs) {
    if (r.issues.length) {
      console.log(red(`  ${runName(r.id)}: ${r.issues.join('; ')}.`))
    }
  }

  for (const r of runs) {
    if (r.problems.length) {
      const problems = r.problems.join(' ')
      console.log(red(`  ${runName(r.id)}, where they disagree: ${problems}`))
    }
  }

  if (agree < runs.length) {
    console.log(dim('  The code check decides the score.'))
  }
}

function printTotals(all: ModeRun[], grading: Grading | null) {
  const usages: Usage[] = [
    ...all.flatMap((r) =>
      r.notes ? [r.notes.usage, r.answer.usage] : [r.answer.usage],
    ),
    ...(grading ? [grading.usage] : []),
  ]

  const total = sumUsage(usages)
  const also = grading ? ', the second check too' : ''
  const requests = `${usages.length} requests${also}`
  const tokens = `${total.outputTokens} output tokens`

  console.log(dim(`\n${requests} · ${tokens} · ${costText(total)}`))
}

await runCli(main)
