import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const {
  BOOK_WORDS,
  CLARIFY_WORDS,
  FAKE_PACKAGE,
  HEDGE_WORDS,
  INSTRUCTIONS,
  LATEST_PACKAGE,
  PROBES,
  aliceVerdict,
  ask,
  askLatest,
  keywordCheck,
  registryCheck,
  statedVersion,
  versionCheck,
  versionSummary,
} = await import('./probe.ts')

let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  undo()
  await mock.close()
})
beforeEach(() => {
  undo()
  mock.requests.length = 0
  mock.respond = undefined
})

// A model that knows only what the message says: no context, so it guesses.
const confabulator: NonNullable<MockLlm['respond']> = (request, m) => {
  const text = lastUserText(request.body)
  if (text.includes(FAKE_PACKAGE)) {
    return m.text(
      request,
      `Install it with npm i ${FAKE_PACKAGE}, then wrap fetch: ledger(fetch, { retries: 3 }).`,
    )
  }
  if (text.includes('side project')) {
    return m.text(
      request,
      'Alice is your desktop AI assistant. What stage is it at?',
    )
  }
  if (text.includes('friend from work')) {
    return m.text(
      request,
      'Alice is your colleague. I only know what you tell me about her.',
    )
  }
  return m.text(
    request,
    'Alice is the curious girl in Lewis Carroll’s book who falls down the rabbit hole into Wonderland.',
  )
}

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    ask({ question: 'Tell me about Alice.' }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  let fetched = 0
  await assert.rejects(
    askLatest({}, (async () => {
      fetched++
      return Response.json({})
    }) as typeof fetch),
    MissingKeyError,
  )
  assert.equal(mock.requests.length, 0)
  assert.equal(fetched, 0)
})

test('the request: context before the question, short-answer instructions, effort low, a limit', async () => {
  undo = useMockEnv(mock)
  await ask({ question: PROBES[1].question, context: PROBES[1].context })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(
    lastUserText(sent.body),
    'Alice is my side project: a desktop AI assistant I am building.\n\nTell me about Alice.',
  )
  assert.equal(sent.body.instructions, INSTRUCTIONS)
  assert.deepEqual(sent.body.reasoning, { effort: 'low' })
  assert.equal(sent.body.max_output_tokens, 800)
  assert.equal(sent.body.store, false)
})

test('no context sends the question alone', async () => {
  undo = useMockEnv(mock, ['openai'])
  const answer = await ask({
    question: '  Tell me about Alice. ',
    context: '   ',
  })
  assert.equal(mock.requests[0].provider, 'openai')
  assert.equal(mock.requests[0].body.model, 'gpt-6-luna')
  assert.equal(lastUserText(mock.requests[0].body), 'Tell me about Alice.')
  assert.equal(answer.context, '')
})

test('the gap gets filled: only the answer with no context talks about the book', async () => {
  undo = useMockEnv(mock)
  mock.respond = confabulator
  const answers = await Promise.all(
    PROBES.filter((p) => p.check === 'book').map((p) =>
      ask({ question: p.question, context: p.context }),
    ),
  )
  assert.deepEqual(
    answers.map((a) => a.book.hit),
    [true, false, false],
  )
  assert.deepEqual(answers[0].book.words, [
    'wonderland',
    'lewis carroll',
    'rabbit hole',
  ])
})

test('a made-up package: a confident guide is not a hedge, "could not find" is', async () => {
  undo = useMockEnv(mock)
  const npm = PROBES.find((p) => p.check === 'hedge')!
  assert.ok(npm.question.includes(FAKE_PACKAGE))
  mock.respond = confabulator
  assert.equal((await ask({ question: npm.question })).hedge.hit, false)
  mock.respond = (request, m) =>
    m.text(
      request,
      `I couldn’t find a package called ${FAKE_PACKAGE}. It may not exist.`,
    )
  const hedged = await ask({ question: npm.question })
  assert.equal(hedged.hedge.hit, true)
  assert.deepEqual(hedged.hedge.words, ["couldn't find", 'may not exist'])
})

test('keyword checks are case-insensitive and list what matched', () => {
  assert.deepEqual(keywordCheck('Down the RABBIT HOLE', BOOK_WORDS), {
    hit: true,
    words: ['rabbit hole'],
  })
  assert.deepEqual(keywordCheck('I am not aware of it.', HEDGE_WORDS), {
    hit: true,
    words: ['not aware'],
  })
  assert.deepEqual(keywordCheck('Alice is a project.', BOOK_WORDS), {
    hit: false,
    words: [],
  })
})

test('the registry check reads 404 as "does not exist", and never throws on a network error', async () => {
  const seen: string[] = []
  const fake = (status: number) =>
    (async (url: string | URL | Request) => {
      seen.push(String(url))
      return new Response(null, { status })
    }) as typeof fetch
  assert.equal((await registryCheck(FAKE_PACKAGE, fake(404))).exists, false)
  assert.equal((await registryCheck('react', fake(200))).exists, true)
  assert.equal(
    (await registryCheck('@scope/pkg', fake(200))).url,
    'https://registry.npmjs.org/@scope%2Fpkg',
  )
  assert.equal(seen[0], `https://registry.npmjs.org/${FAKE_PACKAGE}`)
  const offline = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  assert.deepEqual(await registryCheck(FAKE_PACKAGE, offline), {
    name: FAKE_PACKAGE,
    url: `https://registry.npmjs.org/${FAKE_PACKAGE}`,
    exists: null,
    status: null,
  })
  await assert.rejects(
    registryCheck('../etc', fake(200)),
    /not a valid npm package name/,
  )
})

test('bad input fails before any request', async () => {
  undo = useMockEnv(mock)
  await assert.rejects(ask({ question: ' ' }), /Give a question/)
  await assert.rejects(ask({ question: 'x'.repeat(1001) }), /under 1000/)
  await assert.rejects(
    ask({ question: 'x', context: 'y'.repeat(2001) }),
    /under 2000/,
  )
  assert.equal(mock.requests.length, 0)
})

test('asking back is not a guess, even when it names the book as one option', () => {
  // What gpt-6-luna answered in a real run on 5 October 2026.
  const real =
    'Which Alice do you mean—for example, Alice in *Alice’s Adventures in Wonderland*, a historical figure, or someone you know?'
  const verdict = (text: string) =>
    aliceVerdict({
      book: keywordCheck(text, BOOK_WORDS),
      asks: keywordCheck(text, CLARIFY_WORDS),
    })
  assert.equal(verdict(real), 'asked')
  assert.equal(
    verdict(
      'Alice is the girl who falls down the rabbit hole into Wonderland.',
    ),
    'guessed',
  )
  assert.equal(
    verdict('Alice is your friend from work. I do not know more about her.'),
    'used-context',
  )
})

test('the hedge check knows the phrasings real answers used', () => {
  // Two real gpt-6-luna answers about the made-up package (5 October 2026).
  assert.equal(
    keywordCheck(
      "I can't verify `fetch-retry-ledger`'s exported API, so I don't want to guess.",
      HEDGE_WORDS,
    ).hit,
    true,
  )
  assert.equal(
    keywordCheck(
      'I can’t reliably confirm `fetch-retry-ledger`’s API, so I don’t want to invent an import or method name.',
      HEDGE_WORDS,
    ).hit,
    true,
  )
  assert.equal(
    keywordCheck(
      'Install it with npm i fetch-retry-ledger, then call ledger.retry().',
      HEDGE_WORDS,
    ).hit,
    false,
  )
})

// The npm registry, faked: the `latest` document of a package, or no network.
const npmLatest = (version: string) =>
  (async (url: string | URL | Request) => {
    assert.equal(
      String(url),
      `https://registry.npmjs.org/${LATEST_PACKAGE}/latest`,
    )
    return Response.json({ name: LATEST_PACKAGE, version })
  }) as typeof fetch
const noNetwork = (async () => {
  throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
}) as typeof fetch

test('the latest version: stale, current or not sure, against the registry', async () => {
  undo = useMockEnv(mock)
  // What gpt-6-luna answered in a real run on 10 October 2026, when npm had 4.3.3.
  mock.respond = (request, m) =>
    m.text(
      request,
      'Latest: **Tailwind CSS 4.1.17**  \nInstall: `npm install tailwindcss@4.1.17`',
    )
  const stale = await askLatest({}, npmLatest('4.3.3'))
  assert.equal(
    lastUserText(mock.requests[0].body),
    `Which version of ${LATEST_PACKAGE} is the latest? Answer with the version number and the install command.`,
  )
  assert.deepEqual(
    [
      stale.version.verdict,
      stale.version.said,
      stale.version.current,
      stale.version.warns.hit,
    ],
    ['stale', '4.1.17', '4.3.3', false],
  )
  assert.equal(
    versionSummary(stale.version),
    'Asked for the latest version of tailwindcss, the model said 4.1.17 with no warning. The current version is 4.3.3.',
  )

  mock.respond = (request, m) =>
    m.text(
      request,
      'Tailwind CSS v4.3 is the latest.\n\n```bash\nnpm install tailwindcss\n```',
    )
  assert.equal(
    (await askLatest({}, npmLatest('4.3.3'))).version.verdict,
    'current',
  )

  mock.respond = (request, m) =>
    m.text(
      request,
      'I can’t verify npm’s live registry here. Run `npm view tailwindcss version`, then `npm install tailwindcss@latest`.',
    )
  const unsure = await askLatest({}, npmLatest('4.3.3'))
  assert.equal(unsure.version.verdict, 'unsure')
  assert.deepEqual(unsure.version.warns.words, ["can't verify", 'npm view'])
})

test('registry offline: the answer still shows, with nothing to compare', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(request, 'The latest version is 4.1.11.')
  const answer = await askLatest({}, noNetwork)
  assert.equal(answer.text, 'The latest version is 4.1.11.')
  assert.deepEqual(
    [
      answer.registry.version,
      answer.registry.status,
      answer.version.verdict,
      answer.version.said,
    ],
    [null, null, 'no-registry', '4.1.11'],
  )
  assert.equal(
    versionSummary(answer.version),
    'Asked for the latest version of tailwindcss, the model said 4.1.11. The npm registry did not answer, so the script cannot compare.',
  )
  // A registry error page is not a version either.
  const broken = (async () =>
    new Response('Service Unavailable', { status: 503 })) as typeof fetch
  assert.equal((await askLatest({}, broken)).version.verdict, 'no-registry')
})

test('the stated version: what the answer calls the latest, not other numbers', () => {
  const said = (text: string, name = 'tailwindcss') =>
    statedVersion(text, name)?.text ?? null
  // Real gpt-6-luna answers (10 October 2026).
  assert.equal(
    said(
      'The latest Tailwind CSS version is **4.1.18**.\n\n```bash\nnpm install tailwindcss@latest @tailwindcss/cli\n```',
    ),
    '4.1.18',
  )
  assert.equal(
    said(
      'The latest major version is **Tailwind CSS 4**. Install it with:\n\n```bash\nnpm install tailwindcss @tailwindcss/cli\n```',
    ),
    '4.x',
  )
  assert.equal(
    said('As of my knowledge cutoff, the latest stable version is v3.4.x.'),
    '3.4.x',
  )
  // Versions of other tools, pre-releases, dates and counts do not count.
  assert.equal(said('Tailwind CSS 4.1 needs Node.js 20.11 or newer.'), '4.1')
  assert.equal(
    said('For Vite 7.0, run npm install tailwindcss@4.3.3 @tailwindcss/vite.'),
    '4.3.3',
  )
  assert.equal(
    said('The latest stable release is 3.4.17. Tailwind CSS v4.0 is in beta.'),
    '3.4.17',
  )
  assert.equal(
    said(
      'Install the latest with npm install tailwindcss@latest. Released in 2025; 80 words max.',
    ),
    null,
  )
  assert.equal(said('Next.js 16.1 is the latest.', 'next'), '16.1')
})

test('the version check compares only the numbers that the answer gives', () => {
  const verdict = (text: string, current: string) =>
    versionCheck(text, 'tailwindcss', current).verdict
  assert.equal(verdict('The latest is Tailwind CSS 4.', '4.3.3'), 'current')
  assert.equal(verdict('The latest is 4.3.', '4.3.3'), 'current')
  assert.equal(verdict('The latest is 4.3.1.', '4.3.3'), 'stale')
  assert.equal(verdict('The latest is 4.3.0-rc.1.', '4.3.0'), 'stale')
  assert.equal(verdict('The latest is 4.10.0.', '4.9.2'), 'ahead')
  assert.equal(
    verdict('The latest is 4.1.11. Check npm to confirm.', '4.3.3'),
    'stale',
  )
  assert.equal(
    versionCheck(
      'The latest is 4.1.11. Check npm to confirm.',
      'tailwindcss',
      '4.3.3',
    ).warns.hit,
    true,
  )
  assert.equal(verdict('Use npm install tailwindcss.', '4.3.3'), 'no-version')
})
