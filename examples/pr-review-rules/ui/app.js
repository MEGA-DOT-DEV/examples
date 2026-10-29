import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('provider'))
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')
const runs = new Map()
const total = setup.cases.length * setup.modes.length
const seeded = setup.cases.filter((pr) => pr.seed).length
const kindName = (kind) => kind.replace('_', ' ')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const isClean = (row) => !setup.cases.find((pr) => pr.id === row.caseId).seed

// ── Inputs ─────────────────────────────────────────────────────────────

document.getElementById('rules-note').textContent = plural(
  setup.rules.split('\n').filter((line) => line.startsWith('- ')).length,
  'rule',
)
document.getElementById('rules').append(codeBlock(setup.rules))
document
  .getElementById('cases')
  .append(
    ...setup.cases.map((pr) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, pr.title),
          el(
            'span',
            { class: 'mx-muted mx-small' },
            `diff · ${plural(Object.keys(pr.files).length, 'base file')}`,
          ),
        ),
        el(
          'div',
          { class: 'pr-pad mx-stack' },
          codeBlock(pr.diff, 'diff'),
          ...Object.entries(pr.files).map(([path, text]) =>
            el(
              'details',
              { class: 'mx-details' },
              el(
                'summary',
                {},
                el('span', { class: 'mx-label' }, 'Base file'),
                el('span', { class: 'mx-muted mx-small' }, path),
              ),
              codeBlock(text, 'ts'),
            ),
          ),
        ),
      ),
    ),
  )

// ── Result ─────────────────────────────────────────────────────────────

function totalsOf(mode) {
  const rows = [...runs.values()].filter(
    (row) => !row.error && row.mode === mode.id,
  )
  const sum = (pick) => rows.reduce((n, row) => n + pick(row), 0)
  const priced = rows.every((row) => row.usage?.cost != null)

  return {
    mode,
    reviews: rows.length,
    caught: sum((row) => row.caught),
    cleanAlarms: sum((row) => (isClean(row) ? row.falseAlarms : 0)),
    alarms: sum((row) => row.falseAlarms),
    unverified: sum((row) => row.unverified),
    words: rows.length
      ? (sum((row) => row.commentWords) / rows.length).toFixed(1)
      : '—',
    cost:
      rows.length && priced
        ? `${formatCost(sum((row) => row.usage.cost))}${rows.some((row) => row.usage.costSource === 'estimate') ? ' est.' : ''}`
        : '—',
  }
}

function renderHeadline(list) {
  const failed = [...runs.values()].filter((row) => row.error).length
  if (runs.size < total) {
    return headline.replaceChildren(`${runs.size} of ${total} reviews done.`)
  }

  headline.className = 'mx-lead'

  if (failed) {
    return headline.replaceChildren(
      el('strong', {}, `${failed} of ${total} reviews failed.`),
      ' The totals count only the reviews that returned.',
    )
  }

  const [diff, context] = list
  if (context.caught === diff.caught) {
    return headline.replaceChildren(
      el(
        'strong',
        {},
        `Both modes caught ${diff.caught} of ${seeded} seeded problems.`,
      ),
    )
  }

  const [more, less] =
    context.caught > diff.caught ? [context, diff] : [diff, context]

  headline.replaceChildren(
    el(
      'strong',
      {},
      `With the ${more.mode.label.toLowerCase()}, the reviewer caught ${more.caught} of ${seeded} seeded problems.`,
    ),
    ` With the ${less.mode.label.toLowerCase()}, it caught ${less.caught}.`,
  )
}

function findingView(finding) {
  return el(
    'div',
    { class: 'pr-finding' },
    el(
      'b',
      { class: finding.outcome === 'caught' ? 'mx-good' : 'mx-bad' },
      `${setup.outcomes[finding.outcome]} · ${kindName(finding.kind)}`,
    ),
    el('p', {}, `${finding.file}:${finding.line} · ${finding.reason}`),
    el('code', {}, finding.evidence),
  )
}

function reviewView(pr, mode) {
  const row = runs.get(`${pr.id}/${mode.id}`)
  const head = el('h4', {}, mode.label)

  if (!row) {
    return el(
      'section',
      { class: 'pr-mode' },
      head,
      el('p', { class: 'mx-muted' }, 'Waiting'),
    )
  }

  if (row.error) {
    return el(
      'section',
      { class: 'pr-mode' },
      head,
      el('p', { class: 'mx-bad' }, row.error),
    )
  }

  const verdict = row.caught ? 'Caught' : row.missed ? 'Missed' : 'Clean change'

  return el(
    'section',
    { class: 'pr-mode mx-stack' },
    head,
    el(
      'p',
      { class: row.caught ? 'mx-good' : row.missed ? 'mx-bad' : 'mx-muted' },
      `${verdict} · ${plural(row.falseAlarms, 'false alarm')} · ${row.unverified} unverified`,
    ),
    modelText(row.comment),
    ...row.findings.map(findingView),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${row.commentWords} words · ${row.ms} ms · ${usageText(row.usage)}`,
    ),
    requestResponse(row.request, row.response),
  )
}

function render() {
  const list = setup.modes.map(totalsOf)
  renderHeadline(list)

  document
    .getElementById('scores')
    .replaceChildren(
      ...list.map((t) =>
        el(
          'tr',
          {},
          el('td', {}, t.mode.label),
          el('td', { class: 'num' }, String(t.caught)),
          el('td', { class: 'num' }, String(t.cleanAlarms)),
          el('td', { class: 'num' }, String(t.alarms)),
          el('td', { class: 'num' }, String(t.unverified)),
          el('td', { class: 'num' }, t.words),
          el('td', { class: 'num' }, t.cost),
        ),
      ),
    )

  document
    .getElementById('results')
    .replaceChildren(
      ...setup.cases.map((pr) =>
        el(
          'article',
          { class: 'pr-case mx-stack' },
          el(
            'div',
            { class: 'mx-spread' },
            el('h4', {}, pr.title),
            el(
              'span',
              { class: 'mx-muted mx-small' },
              pr.seed
                ? `Answer key: ${kindName(pr.seed.kind)}`
                : 'Answer key: clean',
            ),
          ),
          el(
            'div',
            { class: 'pr-modes' },
            ...setup.modes.map((mode) => reviewView(pr, mode)),
          ),
        ),
      ),
    )
}

if (!picker.hasKey()) {
  missingKeyNote(notice)
}

button.addEventListener('click', () =>
  busy(button, 'Reviewing…', async () => {
    if (!picker.hasKey()) {
      return missingKeyNote(notice)
    }

    showError(notice, null)
    runs.clear()
    headline.className = 'mx-muted'
    document.getElementById('totals').hidden = false
    document.getElementById('reviews').hidden = false
    render()

    const options = picker.value()
    for (const pr of setup.cases) {
      for (const mode of setup.modes) {
        const key = `${pr.id}/${mode.id}`
        try {
          runs.set(
            key,
            await call('run', { ...options, caseId: pr.id, mode: mode.id }),
          )
        } catch (error) {
          runs.set(key, { error: error.message })
          showError(notice, error)
        }
        render()
      }
    }
  }),
)
