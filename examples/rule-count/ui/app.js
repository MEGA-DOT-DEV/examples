import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const { modes, diff, rules, principles, errorLabels, testOrders } =
  await call('setup')
const picker = await providerPicker(document.getElementById('provider'))
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const runsSelect = document.getElementById('runs')
const empty = document.getElementById('empty')

// The split mode sends 4 requests per run, every other mode sends 1.
const requestsPerRun = modes.reduce(
  (n, mode) => n + (mode.id === 'split' ? 4 : 1),
  0,
)
runsSelect.addEventListener('change', () => {
  const runs = Number(runsSelect.value)
  // Measured in October 2026: about $0.004 per run of the 6 modes with the default model.
  empty.textContent = `Press Compare 6 modes. ${requestsPerRun * runs} paid requests, ${runs === 3 ? 'about 1 cent' : 'under 1 cent'} with the default model, ${runs} to ${runs * 2} minutes.`
})

// A rule names code in backticks: show those parts as code.
const ruleText = (id) =>
  rules[id - 1]
    .split('`')
    .map((part, i) => (i % 2 ? el('code', {}, part) : part))

document.getElementById('diff').append(codeBlock(diff, 'diff'))
document.getElementById('rules').append(
  el(
    'ol',
    {},
    rules.map((_rule, i) => el('li', {}, ruleText(i + 1))),
  ),
)
document.getElementById('principles').replaceWith(
  el(
    'ol',
    {},
    principles.split(/(?<=\.) /).map((line) => el('li', {}, line)),
  ),
)

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cost: 0,
  costSource: null,
}

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cost: a.cost === null || b.cost === null ? null : a.cost + b.cost,
    costSource:
      a.costSource === 'estimate' || b.costSource === 'estimate'
        ? 'estimate'
        : (a.costSource ?? b.costSource),
  }
}

const sum = (list, value) => list.reduce((n, item) => n + value(item), 0)
const fixCorrect = (entry) => entry.fix.correct === entry.fix.total

/** The numbers of one mode. Runs that ended in an error count only as errors. */
function statsOf(mode, entries) {
  const answered = entries.filter((e) => !e.error)

  return {
    mode,
    entries,
    answered,
    errors: entries.filter((e) => e.error),
    given: sum(answered, (e) => e.rulesGiven.length),
    broken: sum(answered, (e) => e.rulesBroken.length),
    clean: answered.filter((e) => e.rulesBroken.length === 0).length,
    fixed: answered.filter(fixCorrect).length,
    usage: entries.reduce((u, e) => addUsage(u, e.usage), ZERO),
  }
}

// What the numbers mean, in words. The numbers themselves are in the table.
function headline(stats) {
  const by = (id) => stats.find((s) => s.mode.id === id)
  const compare = (a, b) => (a > b ? 'more' : a < b ? 'less' : 'same')
  const sentences = []

  const [few, many] = [by('3'), by('50')]
  if (few?.given && many?.given) {
    const share = compare(many.broken / many.given, few.broken / few.given)
    sentences.push(
      share === 'more'
        ? 'More rules, more broken: the model broke a larger share of its rules with 50 rules than with 3.'
        : share === 'less'
          ? 'In this run the model broke a smaller share of its rules with 50 rules than with 3.'
          : many.broken
            ? 'The model broke the same share of its rules with 50 rules as with 3.'
            : 'The model kept every rule it got with 3 and with 50 rules.',
    )
  }

  const [guided, listed] = [by('principles'), by('50')]
  if (guided?.answered.length && listed?.answered.length) {
    const fix = compare(
      guided.fixed / guided.answered.length,
      listed.fixed / listed.answered.length,
    )
    sentences.push(
      fix === 'more'
        ? 'With 5 principles the fix was correct more often than with 50 rules.'
        : fix === 'less'
          ? 'With 5 principles the fix was correct less often than with 50 rules.'
          : 'With 5 principles and with 50 rules the fix was correct equally often.',
    )
  }

  return sentences.length
    ? el('div', { class: 'mx-callout' }, el('p', {}, sentences.join(' ')))
    : null
}

function row(s, runs) {
  const n = s.answered.length
  const cells = [
    s.mode.rules === 0
      ? el('span', { class: 'mx-muted' }, 'No rules given')
      : n
        ? el(
            'span',
            { class: s.broken ? 'mx-bad' : '' },
            `${s.broken} of ${s.given} · ${Math.round((s.broken * 100) / s.given)}%`,
          )
        : '—',
    runs > 1 ? (s.mode.rules === 0 || !n ? '—' : `${s.clean} of ${n}`) : null,
    !n ? '—' : runs > 1 ? `${s.fixed} of ${n}` : s.fixed ? 'Yes' : 'No',
    s.errors.length
      ? el(
          'span',
          { class: 'mx-bad' },
          `${s.errors.length} of ${s.entries.length} · ${[...new Set(s.errors.map((e) => errorLabels[e.error.kind]))].join(', ')}`,
        )
      : 'None',
    usageText(s.usage),
  ]

  return el(
    'tr',
    {},
    el('th', {}, s.mode.label),
    cells.filter((c) => c !== null).map((c) => el('td', {}, c)),
  )
}

function requestsFold(entry) {
  if (!entry.requests.length) {
    return null
  }

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${entry.requests.length} ${entry.requests.length === 1 ? 'request' : 'requests'}`,
      ),
    ),
    entry.requests.map(({ request, response }, i) =>
      el(
        'div',
        {},
        entry.requests.length > 1 ? el('h5', {}, `Request ${i + 1}`) : null,
        requestResponse(request, response),
      ),
    ),
  )
}

function card(entry, mode, runs) {
  const title = el(
    'h4',
    { class: 'mx-h3' },
    runs > 1 ? `${mode.label} · run ${entry.run}` : mode.label,
  )

  if (entry.error) {
    return el(
      'article',
      { class: 'mx-plate answer' },
      title,
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('p', {}, `${errorLabels[entry.error.kind]}. ${entry.error.message}`),
        el('p', { class: 'mx-small' }, 'Not counted as broken rules.'),
      ),
      requestsFold(entry),
    )
  }

  const given = entry.rulesGiven.length
  const ruleResult = !given
    ? el('p', { class: 'mx-muted' }, 'No rules given. Only the fix is tested.')
    : !entry.rulesBroken.length
      ? el('p', { class: 'mx-good' }, `Kept all ${given} rules.`)
      : // The broken rules are the result: open when a few, folded when the list is long.
        el(
          'details',
          { class: 'mx-details', open: entry.rulesBroken.length <= 6 },
          el(
            'summary',
            {},
            el(
              'span',
              { class: 'mx-bad' },
              `Broke ${entry.rulesBroken.length} of ${given} rules`,
            ),
          ),
          el(
            'ol',
            { class: 'broken' },
            entry.rulesBroken.map((id) =>
              el('li', { value: id, class: 'mx-bad' }, ruleText(id)),
            ),
          ),
        )

  const { correct, total, defectsLeft } = entry.fix
  const defects = defectsLeft.length
    ? ` The defect on line ${defectsLeft.join(' and ')} is still there.`
    : ''
  const fixResult =
    correct === total
      ? el(
          'p',
          { class: 'mx-good' },
          `Fix correct on all ${total} test orders.`,
        )
      : el(
          'p',
          { class: 'mx-bad' },
          `Fix wrong on ${total - correct} of ${total} test orders.${defects}`,
        )

  const lines = entry.code.split('\n').length
  return el(
    'article',
    { class: 'mx-plate answer' },
    title,
    ruleResult,
    fixResult,
    entry.findings.length
      ? modelText(
          entry.findings.map((f) => `Line ${f.line}: ${f.reason}`).join('\n\n'),
        )
      : el('p', { class: 'mx-muted' }, 'No findings.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Fixed function'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${lines} ${lines === 1 ? 'line' : 'lines'}`,
        ),
      ),
      codeBlock(entry.code, 'js'),
    ),
    requestsFold(entry),
  )
}

// Every failed run in one list, with its mode and run number, so no error hides another.
function errorList(stats, failedModes, runs) {
  const items = [
    ...failedModes.map(({ mode, message }) => `${mode.label}: ${message}`),
    ...stats.flatMap((s) =>
      s.errors.map(
        (e) =>
          `${s.mode.label}${runs > 1 ? ` · run ${e.run}` : ''}: ${errorLabels[e.error.kind]}. ${e.error.message}`,
      ),
    ),
  ]

  if (!items.length) {
    return null
  }

  return el(
    'div',
    { class: 'mx-callout mx-callout--warn' },
    el(
      'span',
      { class: 'mx-label' },
      `${items.length} ${items.length === 1 ? 'run' : 'runs'} failed`,
    ),
    el('p', {}, 'They have no rule score and are not counted as broken rules.'),
    el(
      'ul',
      { class: 'errors' },
      items.map((text) => el('li', {}, text)),
    ),
  )
}

async function compare() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  for (const id of ['headline', 'head', 'rows', 'answers']) {
    document.getElementById(id).replaceChildren()
  }
  document.getElementById('summary').textContent = ''
  empty.hidden = true

  const runs = Number(runsSelect.value)
  const results = new Map()
  const failedModes = []
  let missingKey = null

  await busy(button, 'Comparing…', async () => {
    let done = 0
    // The 6 modes run at the same time; each one runs its runs in order.
    await Promise.all(
      modes.map(async (mode) => {
        try {
          results.set(
            mode.id,
            await call('run', { mode: mode.id, runs, ...picker.value() }),
          )
        } catch (error) {
          if (error.missingKey || error.restart) {
            missingKey = error
          } else {
            failedModes.push({ mode, message: error.message })
          }
        }
        button.textContent = `Comparing… ${++done} of ${modes.length} modes done`
      }),
    )
  })

  if (missingKey) {
    return showError(notice, missingKey)
  }

  const stats = modes
    .filter((m) => results.has(m.id))
    .map((m) => statsOf(m, results.get(m.id)))

  const errors = errorList(stats, failedModes, runs)
  if (errors) {
    notice.replaceChildren(errors)
  }

  if (!stats.length) {
    return
  }

  document.getElementById('result').hidden = false
  document
    .getElementById('headline')
    .replaceChildren(...[headline(stats)].filter(Boolean))

  document.getElementById('head').replaceChildren(
    el(
      'tr',
      {},
      [
        'Mode',
        'Rules broken',
        runs > 1 ? 'Runs that kept every rule' : null,
        runs > 1 ? 'Correct fixes' : 'Correct fix',
        'Errors',
        'Tokens and cost',
      ]
        .filter(Boolean)
        .map((t) => el('th', {}, t)),
    ),
  )

  document.getElementById('rows').replaceChildren(
    ...modes.map((mode) => {
      const s = stats.find((item) => item.mode.id === mode.id)
      return s
        ? row(s, runs)
        : el(
            'tr',
            {},
            el('th', {}, mode.label),
            el(
              'td',
              { colspan: runs > 1 ? 5 : 4, class: 'mx-bad' },
              'This mode failed. See the list above.',
            ),
          )
    }),
  )

  const requests = sum(stats, (s) => sum(s.entries, (e) => e.requests.length))
  document.getElementById('summary').textContent =
    `A correct fix gives the right receipt on all ${testOrders} test orders. ${requests} requests · ${usageText(stats.reduce((u, s) => addUsage(u, s.usage), ZERO))}`

  document
    .getElementById('answers')
    .replaceChildren(
      ...stats.flatMap((s) =>
        s.entries.map((entry) => card(entry, s.mode, runs)),
      ),
    )
}

button.addEventListener('click', compare)
