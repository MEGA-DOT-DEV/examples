import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  showError,
  usageText,
} from '../../kit/kit.js'

const { probes, fakePackage, latestPackage } = await call('probes')

const button = document.getElementById('go')
const notice = document.getElementById('notice')
const aliceBox = document.getElementById('alice')
const npmBox = document.getElementById('npm')
const latestBox = document.getElementById('latest')
const ownBox = document.getElementById('own')
// Answers of the five questions, by question id, for the headline and the total line.
const answers = new Map()

function addUsage(total, u) {
  if (!total) {
    return { ...u }
  }

  return {
    inputTokens: total.inputTokens + u.inputTokens,
    outputTokens: total.outputTokens + u.outputTokens,
    reasoningTokens: total.reasoningTokens + u.reasoningTokens,
    cost: total.cost == null || u.cost == null ? null : total.cost + u.cost,
    costSource:
      total.costSource === 'estimate' || u.costSource === 'estimate'
        ? 'estimate'
        : u.costSource,
  }
}

function renderTotal() {
  let total = null
  for (const answer of answers.values()) {
    total = addUsage(total, answer.usage)
  }

  document.getElementById('total').textContent = total
    ? `Total for ${answers.size} ${answers.size === 1 ? 'answer' : 'answers'}: ${usageText(total)}`
    : ''
}

/** The headline, one line per part: the Alice cards, the made-up package, the latest version. */
function renderHeadline() {
  const lines = []
  const alice = []

  const none = answers.get('alice-none')
  if (none) {
    alice.push(
      {
        asked: 'With no context, the model asked which Alice you mean.',
        guessed: 'With no context, the model guessed the book character.',
        'used-context':
          'With no context, the model did not name the book character.',
      }[none.verdict],
    )
  }

  const withContext = aliceCards
    .filter((c) => c.probe.context && answers.has(c.probe.id))
    .map((c) => answers.get(c.probe.id))
  if (withContext.length) {
    const used = withContext.filter((a) => a.verdict === 'used-context').length
    alice.push(
      `With context, ${used} of ${withContext.length} answers used the context.`,
    )
  }

  if (alice.length) {
    lines.push(alice.join(' '))
  }

  const npm = answers.get(npmProbe.id)
  if (npm) {
    lines.push(
      npm.hedge.hit
        ? 'For the made-up package, the model said it is not sure.'
        : 'For the made-up package, the model did not say it is not sure. Read its answer.',
    )
  }

  const latest = answers.get(latestProbe.id)
  if (latest) {
    lines.push(latest.summary)
  }

  document.getElementById('headline').hidden = !lines.length
  document
    .getElementById('headline-text')
    .replaceChildren(
      ...lines.flatMap((line, i) => (i ? [el('br'), line] : [line])),
    )
}

/** A keyword check result, marked red when `bad`. */
function checkLine(label, check, bad) {
  return el(
    'p',
    { class: 'cf-check' },
    el('i', {
      class: bad ? 'mx-dot cf-dot--bad' : 'mx-dot',
      'aria-hidden': 'true',
    }),
    el(
      'span',
      {},
      `${label}: `,
      el('b', { class: bad ? 'mx-bad' : 'mx-good' }, check.hit ? 'yes' : 'no'),
      check.hit
        ? el(
            'span',
            { class: 'mx-muted' },
            ` (matched: ${check.words.join(', ')})`,
          )
        : null,
    ),
  )
}

/** For an Alice card: asked back, guessed the book character, or used the context. */
function verdictLine(answer) {
  const bad = answer.verdict === 'guessed'
  const words =
    answer.verdict === 'asked' ? answer.asks.words : answer.book.words

  return el(
    'p',
    { class: 'cf-check' },
    el('i', {
      class: bad ? 'mx-dot cf-dot--bad' : 'mx-dot',
      'aria-hidden': 'true',
    }),
    el(
      'span',
      {},
      el('b', { class: bad ? 'mx-bad' : 'mx-good' }, answer.verdictText),
      words.length
        ? el('span', { class: 'mx-muted' }, ` (matched: ${words.join(', ')})`)
        : null,
    ),
  )
}

/** For the latest-version card: stale, current, or not sure, against the registry. */
function versionLines(answer) {
  const { verdict, warns } = answer.version
  const wrong = verdict === 'stale' || verdict === 'ahead'
  const sure = verdict === 'current' || verdict === 'unsure'

  return [
    el(
      'p',
      { class: 'cf-check' },
      el('i', {
        class: wrong
          ? 'mx-dot cf-dot--bad'
          : sure
            ? 'mx-dot'
            : 'mx-dot mx-dot--missing',
        'aria-hidden': 'true',
      }),
      el(
        'span',
        {},
        el(
          'b',
          { class: wrong ? 'mx-bad' : sure ? 'mx-good' : 'mx-muted' },
          answer.versionLine,
        ),
      ),
    ),
    // A warning matters when the version is wrong.
    checkLine('Warns that it can be out of date', warns, wrong && !warns.hit),
  ]
}

/** A card: title, the exact message sent, then the answer. */
function card(title, context, question, options = {}) {
  return el(
    'article',
    { class: 'mx-panel cf-card' },
    el(
      'h3',
      { class: `cf-title${options.mono ? ' cf-title--mono' : ''}` },
      title,
    ),
    el(
      'div',
      { class: 'cf-prompt' },
      el('span', { class: 'mx-label' }, 'The message'),
      // The page sends the context and the question as one user message.
      el('p', {}, context ? [context, el('br'), el('br'), question] : question),
      context === ''
        ? el('span', { class: 'mx-hint' }, 'No context, only the question.')
        : null,
    ),
    el(
      'div',
      { class: 'cf-body' },
      el('p', { class: 'mx-muted mx-small' }, 'Not asked yet.'),
    ),
  )
}

function fill(cardNode, answer, checks) {
  cardNode
    .querySelector('.cf-body')
    .replaceChildren(
      answer.text.trim()
        ? modelText(answer.text, 'mx-output cf-answer')
        : el('p', { class: 'mx-muted' }, '(no text)'),
      ...(answer.incompleteReason
        ? [
            el(
              'p',
              { class: 'mx-bad mx-small' },
              `Cut: ${answer.incompleteReason}`,
            ),
          ]
        : []),
      ...checks,
      el(
        'p',
        { class: 'mx-hint' },
        `${answer.model} · ${usageText(answer.usage)}`,
      ),
      rawFold(answer),
    )
}

/** One fold per card, so four cards do not show eight closed boxes. */
function rawFold(answer) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
    ),
    el(
      'div',
      { class: 'cf-raw' },
      el('span', { class: 'mx-label' }, 'Request sent'),
      codeBlock(prettyJson(answer.request), 'json'),
      el('span', { class: 'mx-label' }, 'Response received'),
      codeBlock(prettyJson(answer.response), 'json'),
    ),
  )
}

function failed(cardNode, error) {
  cardNode
    .querySelector('.cf-body')
    .replaceChildren(el('p', { class: 'mx-bad mx-small' }, error.message))

  if (error.missingKey) {
    showError(notice, error)
  }
}

/** "npm registry: …" under a package card's title, until the registry answers. */
function registryLine(cardNode) {
  const line = el(
    'p',
    { class: 'cf-check cf-registry' },
    el('i', { class: 'mx-dot mx-dot--missing', 'aria-hidden': 'true' }),
    el(
      'span',
      {},
      'npm registry: ',
      el('b', { class: 'mx-muted' }, 'checked when you ask'),
    ),
  )

  cardNode.insertBefore(line, cardNode.querySelector('.cf-body'))
  return line
}

function markRegistry(line, text, ok) {
  line.querySelector('b').className =
    ok === null ? 'mx-muted' : ok ? 'mx-good' : 'mx-bad'
  line.querySelector('b').textContent = text
  line.querySelector('i').className = ok ? 'mx-dot' : 'mx-dot mx-dot--missing'
}

const aliceCards = probes
  .filter((p) => p.check === 'book')
  .map((p) => ({ probe: p, node: card(p.label, p.context, p.question) }))
const npmProbe = probes.find((p) => p.check === 'hedge')
const npmCard = {
  probe: npmProbe,
  node: card(fakePackage, null, npmProbe.question, { mono: true }),
}
const npmRegistry = registryLine(npmCard.node)
const latestProbe = probes.find((p) => p.check === 'version')
const latestCard = card(latestPackage, null, latestProbe.question, {
  mono: true,
})
const latestRegistry = registryLine(latestCard)

aliceBox.replaceChildren(...aliceCards.map((c) => c.node))
npmBox.replaceChildren(npmCard.node)
latestBox.replaceChildren(latestCard)

async function askOne({ probe, node }) {
  node
    .querySelector('.cf-body')
    .replaceChildren(el('p', { class: 'mx-muted mx-small' }, 'Asking…'))

  try {
    const answer = await call('ask', {
      question: probe.question,
      context: probe.context,
      ...picker.value(),
    })

    const check =
      probe.check === 'book'
        ? verdictLine(answer)
        : checkLine('Says it is not sure', answer.hedge, !answer.hedge.hit)

    fill(node, answer, [check])
    answers.set(probe.id, answer)
    renderTotal()
    renderHeadline()
  } catch (error) {
    failed(node, error)
  }
}

async function checkRegistry() {
  const result = await call('registry').catch(() => ({ exists: null }))
  if (result.exists === false) {
    markRegistry(npmRegistry, '404 · does not exist', true)
  } else if (result.exists) {
    markRegistry(npmRegistry, 'exists now · this probe needs a new name', false)
  } else {
    markRegistry(npmRegistry, 'check failed', null)
  }
}

/** One call asks the model and reads the registry, so the card can compare the two. */
async function askLatest() {
  latestCard
    .querySelector('.cf-body')
    .replaceChildren(el('p', { class: 'mx-muted mx-small' }, 'Asking…'))

  markRegistry(latestRegistry, 'checked when you ask', null)

  try {
    const answer = await call('latest', picker.value())
    const current = answer.registry.version

    markRegistry(
      latestRegistry,
      current
        ? `${current} is the latest`
        : 'did not answer · nothing to compare',
      current ? true : null,
    )

    fill(latestCard, answer, versionLines(answer))
    answers.set(latestProbe.id, answer)
    renderTotal()
    renderHeadline()
  } catch (error) {
    failed(latestCard, error)
  }
}

async function askAll() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  answers.clear()
  renderTotal()
  renderHeadline()
  document.getElementById('empty').hidden = true

  // One call per question: each card fills when its answer arrives.
  await busy(button, 'Asking…', () =>
    Promise.all([
      checkRegistry(),
      ...[...aliceCards, npmCard].map(askOne),
      askLatest(),
    ]),
  )
}

async function askOwn() {
  const question = document.getElementById('own-question').value.trim()
  const context = document.getElementById('own-context').value.trim()

  if (!question) {
    return showError(notice, new Error('Type a question first.'))
  }

  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  const node = card('Your question', context, question)
  ownBox.replaceChildren(node)

  await busy(document.getElementById('own-go'), 'Asking…', async () => {
    try {
      const answer = await call('ask', { question, context, ...picker.value() })
      fill(node, answer, [
        checkLine('Mentions the book character', answer.book, answer.book.hit),
        checkLine('Says it is not sure', answer.hedge, !answer.hedge.hit),
      ])
    } catch (error) {
      failed(node, error)
    }
  })
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

button.addEventListener('click', askAll)
document.getElementById('own-go').addEventListener('click', askOwn)
document.getElementById('own-question').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    askOwn()
  }
})
