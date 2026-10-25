// Context compaction
// Run: npx mex run context-compaction [--words 100] [--rounds 1-3]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { wholeNumber } from '#shared/input.ts'
import { formatUsage, pickProvider, sumUsage, type Usage } from '#shared/llm.ts'
import { bold, dim, green, plural, red, section } from '#shared/print.ts'
import {
  type CompactResult,
  compact,
  type Fact,
  MAX_WORDS,
  MIN_WORDS,
  type ProbeResult,
  probe,
  ROUNDS,
  type ThreadInfo,
  threadInfo,
} from './compaction.ts'

async function main() {
  const { flags, words } = cliArgs({
    words: { type: 'string' },
    rounds: { type: 'string', default: String(ROUNDS) },
  })
  if (words.length) {
    throw new Error(`Unknown argument "${words[0]}".`)
  }

  const budget = wholeNumber(flags.words, '--words', MIN_WORDS, MAX_WORDS)
  const rounds = wholeNumber(flags.rounds, '--rounds', 1, ROUNDS)
  const { provider, model } = flags
  const info = threadInfo()

  // Fails here, before any request, when no key is set.
  pickProvider(provider)
  printThread(info, budget ?? info.words.default)

  section('Full thread (control)')
  const control = await probe({ round: 0, provider, model })
  printProbe(control)

  const probes = [control]
  const usages = [control.usage]
  const summaries: string[] = []

  for (let round = 1; round <= rounds; round++) {
    section(`Round ${round}`)
    const result = await compact({
      round,
      previousSummary: summaries.at(-1),
      words: budget,
      provider,
      model,
    })
    summaries.push(result.summary)
    printCompact(result)

    const after = await probe({
      round,
      summary: result.summary,
      provider,
      model,
    })
    printProbe(after)

    probes.push(after)
    usages.push(result.usage, after.usage)
  }

  // The result first: which facts each round lost.
  printResult(probes)
  printFacts(info.facts, probes)
  printSummaries(summaries)
  printTotal(control, usages)
}

function printThread(info: ThreadInfo, budget: number) {
  section(`Thread: ${info.title}`)
  console.log(
    `${info.messages} messages, ${info.fullTokens} tokens (o200k_base). The first message sets a rule: "Never log secrets."`,
  )

  for (const s of info.segments) {
    const size = `${s.messages.length} messages, ${s.tokens} tokens`
    console.log(dim(`  round ${s.round}: ${size}`))
  }
  console.log(dim(`Summary length: ${budget} words. Prompt: compact.md.`))
}

function printCompact(result: CompactResult) {
  const what =
    result.round === 1
      ? `${result.added} messages`
      : `last summary + ${result.added} new messages`
  const sizes = `${result.contextTokens} tokens → summary of ${result.summaryTokens} tokens`
  console.log(
    `Compact: ${what}, ${sizes} ${dim(`· ${formatUsage(result.usage)}`)}`,
  )
}

function keptText(p: ProbeResult) {
  return `${p.answers.filter((a) => a.kept).length} of ${p.answers.length}`
}

function printProbe(result: ProbeResult) {
  const usage = dim(`· ${formatUsage(result.usage)}`)
  console.log(`Questions: ${keptText(result)} facts kept ${usage}`)
  for (const a of result.answers.filter((a) => !a.kept)) {
    console.log(
      red(`  lost  ${a.label}`) + dim(`  answer: ${JSON.stringify(a.answer)}`),
    )
  }
}

function printResult(probes: ProbeResult[]) {
  const [full, ...compacted] = probes
  const after = plural(compacted.length, 'round')
  const kept = keptText(compacted.at(-1) ?? full)

  section('Result')
  console.log(
    `After ${after}, the summary keeps ${kept} facts. The full thread keeps ${keptText(full)}.`,
  )

  for (const p of compacted) {
    const lost = p.answers.filter((a) => !a.kept).map((a) => a.label)
    const verdict = lost.length
      ? red(`Lost: ${lost.join(', ')}.`)
      : 'Nothing lost.'
    console.log(`  Round ${p.round}: ${keptText(p)} kept. ${verdict}`)
  }
}

function printFacts(facts: Fact[], probes: ProbeResult[]) {
  section('Facts by round')
  const columns = probes
    .map((p) => (p.round ? `round ${p.round}` : 'full').padEnd(9))
    .join('')
  const width = Math.max(...facts.map((f) => f.label.length)) + 2
  console.log(dim(`${''.padEnd(width)}${columns}`))

  for (const fact of facts) {
    const cells = probes.map((p) => {
      const answer = p.answers.find((a) => a.id === fact.id)
      if (!answer) {
        return dim('—'.padEnd(9))
      }
      return answer.kept ? green('kept'.padEnd(9)) : red('lost'.padEnd(9))
    })
    console.log(`${fact.label.padEnd(width)}${cells.join('')}`)
  }

  console.log(dim('— means that the fact is not in the thread yet.'))
}

function printSummaries(summaries: string[]) {
  section('Summaries')
  summaries.forEach((s, i) => {
    console.log(`${bold(`Round ${i + 1}`)}\n${dim(s)}\n`)
  })
}

function printTotal(control: ProbeResult, usages: Usage[]) {
  const requests = `${usages.length} requests`
  const total = formatUsage(sumUsage(usages))
  console.log(
    dim(`${control.provider} · ${control.model} · ${requests} · ${total}`),
  )

  console.log(
    bold(
      '\nEach summary is the only memory of the messages before it. A detail that one summary leaves out does not come back.',
    ),
  )
}

await runCli(main)
