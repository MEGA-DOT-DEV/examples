// Heavy guidance: a 50-line procedure against a short goal
// Run: npx mex run heavy-guidance
//      [--question retention|escalation|reconciliation] [--raw]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { byId } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  plural,
  printJson,
  printRequest,
  section,
} from '#shared/print.ts'
import {
  chunks,
  headline,
  type ModeResult,
  QUESTIONS,
  type Question,
  runQuestion,
} from './compare.ts'

const MODE_NAMES = {
  procedure: '50-line procedure',
  goal: 'Short goal',
}

async function main() {
  const { flags, words } = cliArgs({
    question: { type: 'string' },
    raw: { type: 'boolean', default: false },
  })
  if (words.length) {
    throw new Error(`Unknown option: ${words[0]}`)
  }
  const selected = byId(QUESTIONS, flags.question, 'question')
  const questions = selected ? [selected] : QUESTIONS
  const options = { provider: flags.provider, model: flags.model }

  // Check the key before the first output.
  pickProvider(flags.provider)

  const count = plural(questions.length, 'question')
  console.log(
    `Two methods answer ${count} from two documents. The 50-line procedure summarizes ${chunks().length} chunks first. The short goal reads all chunks in one request.`,
  )

  let guided = 0
  let goal = 0
  for (const question of questions) {
    const result = await runQuestion(question.id, options)
    guided += Number(result.procedure.correct)
    goal += Number(result.goal.correct)

    printQuestion(question)
    printMode(result.procedure, flags.raw)
    printMode(result.goal, flags.raw)

    const finding = headline(result)
    console.log(`${bold(finding.lead)} ${finding.rest}`)
  }

  printScores(guided, goal, questions.length)
}

function printQuestion(question: Question) {
  const key = JSON.stringify(question.expected)

  section(`${question.label} · ${question.prompt}`)
  console.log(dim(`Answer key: ${key} · ${question.source}`))
}

function printMode(run: ModeResult, raw: boolean) {
  const verdict = run.correct ? 'correct' : 'incorrect'
  const requests = plural(run.calls.length, 'request')
  const seconds = `${(run.ms / 1000).toFixed(1)} s`
  const usage = formatUsage(run.usage)

  console.log(
    `${MODE_NAMES[run.mode]}: ${verdict} · ${requests} · ${usage} · ${seconds}`,
  )
  console.log(`Answer: ${JSON.stringify(run.answer) ?? '(not valid JSON)'}`)

  for (const call of run.calls) {
    console.log(
      dim(`  ${call.step} · ${formatUsage(call.usage)} · ${call.status}`),
    )
    if (raw) {
      printRequest({ ...call.request, headers: {}, body: call.request.body })
      printJson('Response', call.response)
    }
  }
}

function printScores(guided: number, goal: number, total: number) {
  section('Scores')
  console.log(
    `50-line procedure: ${guided} of ${total} correct. Short goal: ${goal} of ${total} correct.`,
  )
  console.log(
    dim(
      'A tie or a win for the procedure is also a valid result. Compare the requests, tokens and cost.',
    ),
  )
}

await runCli(main)
