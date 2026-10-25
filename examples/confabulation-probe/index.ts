// Confabulation probe
// Run: npx mex run confabulation-probe ["your question"]
//      [--context "what the model should know"] [--package tailwindcss]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { costText, formatUsage, pickProvider, sumUsage } from '#shared/llm.ts'
import { bold, dim, green, red, section, yellow } from '#shared/print.ts'
import {
  type Answer,
  type AskOptions,
  aliceVerdict,
  ask,
  askLatest,
  FAKE_PACKAGE,
  type KeywordCheck,
  LATEST_PACKAGE,
  type LatestAnswer,
  PROBES,
  type Probe,
  type RegistryCheck,
  registryCheck,
  registryUrl,
  VERDICT_TEXT,
  type Verdict,
  type VersionVerdict,
  versionLine,
  versionSummary,
} from './probe.ts'

async function main() {
  const { flags, words } = cliArgs({
    context: { type: 'string', default: '' },
    package: { type: 'string', default: LATEST_PACKAGE },
  })
  const { provider, model } = flags

  // The key check and the package name check come before any network call.
  pickProvider(provider)
  registryUrl(flags.package)

  if (words.length) {
    await askYours({
      question: words.join(' '),
      context: flags.context,
      provider,
      model,
    })
  } else {
    await runProbes(flags.package, provider, model)
  }
}

/** Your own question: one answer and its two keyword checks. */
async function askYours(options: AskOptions) {
  const answer = await ask(options)

  printAnswer('Your question', answer)
  console.log(mark('Mentions the book character', answer.book, answer.book.hit))
  console.log(mark('Says it is not sure', answer.hedge, false))
  console.log(dim(formatUsage(answer.usage)))
}

function printAnswer(title: string, answer: Answer) {
  section(
    `${title} ${dim(`${answer.provider} · ${answer.model} · ${answer.ms} ms`)}`,
  )

  if (answer.context) {
    console.log(dim(`Context: ${answer.context}`))
  }

  console.log(`${bold('Q:')} ${answer.question}\n`)
  console.log(answer.text.trim() || dim('(no text)'))
  if (answer.incompleteReason) {
    console.log(yellow(`(cut: ${answer.incompleteReason})`))
  }

  console.log('')
}

/** One keyword check. `bad` paints the result red. */
function mark(label: string, check: KeywordCheck, bad: boolean) {
  const found = check.hit ? `yes · ${check.words.join(', ')}` : 'no'
  return `${dim(`${label} (keyword check):`)} ${(bad ? red : green)(found)}`
}

async function runProbes(name: string, provider?: string, model?: string) {
  // Five requests at once; they print in order.
  const [registry, ...answers] = await Promise.all([
    registryCheck(FAKE_PACKAGE),
    ...PROBES.map((probe) =>
      probe.check === 'version'
        ? askLatest({ name, provider, model })
        : ask({
            question: probe.question,
            context: probe.context,
            provider,
            model,
          }),
    ),
  ])

  PROBES.forEach((probe, i) => {
    printProbe(probe, answers[i], registry)
  })

  printResult(answers)
}

function printProbe(probe: Probe, answer: Answer, registry: RegistryCheck) {
  printAnswer(probe.label, answer)

  if (probe.check === 'book') {
    printVerdict(answer)
  } else if (probe.check === 'hedge') {
    printHedge(answer, registry)
  } else {
    printVersion(answer as LatestAnswer)
  }

  console.log(dim(formatUsage(answer.usage)))
}

function printVerdict(answer: Answer) {
  // Asking back is not a guess, even when the answer names the book as one option.
  const verdict = aliceVerdict(answer)
  const paint = verdict === 'guessed' ? red : green
  const words = verdict === 'asked' ? answer.asks.words : answer.book.words

  const found = words.length ? dim(` (keyword check: ${words.join(', ')})`) : ''
  console.log(`${paint(VERDICT_TEXT[verdict])}${found}`)
}

function printHedge(answer: Answer, registry: RegistryCheck) {
  const label = dim(`npm registry check for ${FAKE_PACKAGE}:`)
  console.log(`${label} ${registryState(registry)}`)

  console.log(mark('Says it is not sure', answer.hedge, !answer.hedge.hit))
}

function registryState(registry: RegistryCheck) {
  if (registry.exists === false) {
    return green('404, it does not exist')
  }

  if (registry.exists) {
    return red('it exists now; pick another name')
  }

  return yellow('check failed')
}

const VERSION_PAINT: Record<VersionVerdict, (text: string) => string> = {
  stale: red,
  ahead: red,
  current: green,
  unsure: green,
  'no-version': yellow,
  'no-registry': yellow,
}

function printVersion(answer: LatestAnswer) {
  const { registry, version } = answer
  const label = dim(`npm registry, latest ${registry.name}:`)
  console.log(`${label} ${registry.version ?? yellow('no answer')}`)

  console.log(VERSION_PAINT[version.verdict](versionLine(version)))

  // A warning matters when the version is wrong.
  const wrong = version.verdict === 'stale' || version.verdict === 'ahead'
  console.log(
    mark(
      'Warns that it can be out of date',
      version.warns,
      wrong && !version.warns.hit,
    ),
  )
}

const NO_CONTEXT_TEXT: Record<Verdict, string> = {
  asked: 'With no context, the model asked which Alice you mean.',
  guessed: 'With no context, the model guessed the book character.',
  'used-context': 'With no context, the model did not name the book character.',
}

function printResult(answers: Answer[]) {
  section('Result')
  const [none, ...withContext] = PROBES.flatMap((probe, i) =>
    probe.check === 'book' ? [aliceVerdict(answers[i])] : [],
  )

  console.log(NO_CONTEXT_TEXT[none])
  const used = withContext.filter((v) => v === 'used-context').length
  console.log(
    `With context, ${used} of ${withContext.length} answers used the context.`,
  )

  const npm = answers[PROBES.findIndex((p) => p.check === 'hedge')]
  console.log(
    npm.hedge.hit
      ? 'For the made-up package, the model said it is not sure.'
      : 'For the made-up package, the model did not say it is not sure. Read its answer.',
  )

  const latest = answers[PROBES.findIndex((p) => p.check === 'version')]
  console.log(versionSummary((latest as LatestAnswer).version))

  const cost = costText(sumUsage(answers.map((a) => a.usage)))
  console.log(dim(`${answers.length} requests · ${cost}`))
}

await runCli(main)
