import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const $ = (id) => document.getElementById(id)
const mode = $('mode')
const notice = $('notice')
const summary = $('summary')
const { changes, info, turns } = await call('setup')
const empty = `Press Run. ${turns * 2} requests, under 1 cent.`
summary.textContent = empty
mode.replaceChildren(
  ...changes.map((name) => el('option', { value: name }, info[name].name)),
)
mode.value = 'fact-on-top'
const describe = () => {
  $('does').textContent = info[mode.value].does
}
describe()
mode.addEventListener('change', describe)
const picker = await providerPicker($('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const n = (value) => value.toLocaleString('en-US')
const ratio = (value, base) =>
  value === null || !base ? '' : ` · ${(value / base).toFixed(1)}×`

function statusCell(row, firstLost) {
  if (row.status === 'cold') {
    return el('span', { class: 'mx-muted' }, 'Cold start')
  }
  if (row.status === 'kept') {
    return el('span', { class: 'mx-good' }, 'Kept')
  }

  return el(
    row.turn === firstLost ? 'b' : 'span',
    { class: 'mx-bad' },
    row.turn === firstLost ? 'Cache lost here' : 'Lost',
  )
}

function reusedCell({ cachedTokens, inputTokens }) {
  const share = inputTokens ? cachedTokens / inputTokens : 0

  return el(
    'div',
    { class: 'cache-reused' },
    el(
      'span',
      { class: 'mx-meter' },
      el('i', { style: `width: ${(share * 100).toFixed(1)}%` }),
    ),
    el('span', { class: 'mx-mono' }, `${n(cachedTokens)} of ${n(inputTokens)}`),
  )
}

// Two rows per turn: the steady prefix, then the change with its cost and time against it.
function turnRows(steady, changed, firstLost) {
  return steady.rows.flatMap((base, i) => {
    const row = changed.rows[i]

    return [
      el(
        'tr',
        { class: 'cache-steady' },
        el('td', { class: 'num', rowspan: '2' }, String(base.turn)),
        el('td', {}, info.steady.name),
        el('td', {}, statusCell(base, null)),
        el('td', {}, reusedCell(base.usage)),
        el('td', { class: 'num' }, formatCost(base.usage.cost)),
        el('td', { class: 'num' }, `${n(base.ms)} ms`),
      ),
      el(
        'tr',
        { class: row.status === 'lost' ? 'cache-lost' : '' },
        el('td', {}, info[changed.mode].name),
        el('td', {}, statusCell(row, firstLost)),
        el('td', {}, reusedCell(row.usage)),
        el(
          'td',
          { class: 'num' },
          `${formatCost(row.usage.cost)}${ratio(row.usage.cost, base.usage.cost)}`,
        ),
        el('td', { class: 'num' }, `${n(row.ms)} ms${ratio(row.ms, base.ms)}`),
      ),
    ]
  })
}

function answers(steady, changed) {
  const cell = (row) =>
    el(
      'td',
      { class: row.correct ? 'mx-good' : 'mx-bad' },
      row.answer ?? '(not in FACT format)',
    )

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Answers · ${steady.rows.length * 2}, one per request`,
      ),
    ),
    el(
      'div',
      { class: 'mx-table-wrap' },
      el(
        'table',
        { class: 'mx-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { class: 'num' }, 'Turn'),
            el('th', {}, 'Current branch'),
            el('th', {}, info.steady.name),
            el('th', {}, info[changed.mode].name),
          ),
        ),
        el(
          'tbody',
          {},
          steady.rows.map((row, i) =>
            el(
              'tr',
              {},
              el('td', { class: 'num' }, String(row.turn)),
              el('td', { class: 'mx-mono' }, row.expected),
              cell(row),
              cell(changed.rows[i]),
            ),
          ),
        ),
      ),
    ),
  )
}

// The part of turns 1 and 2 where the change sits: the tool order and the first lines of the system prompt.
function requestStart(changed) {
  const text = changed.rows
    .slice(0, 2)
    .map(({ turn, request }) =>
      [
        `Turn ${turn}`,
        `tools: ${request.body.tools.map((tool) => tool.name).join(', ')}`,
        ...request.body.instructions
          .split('\n')
          .slice(0, 2)
          .map((line) => (line.length > 150 ? `${line.slice(0, 150)}…` : line)),
      ].join('\n'),
    )
    .join('\n\n')

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Start of the request · ${info[changed.mode].name}, turns 1 and 2`,
      ),
    ),
    codeBlock(text),
  )
}

function requests(steady, changed) {
  const all = [steady, changed].flatMap((version) =>
    version.rows.map((row) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el(
            'span',
            { class: 'mx-label' },
            `${info[version.mode].name} · turn ${row.turn}`,
          ),
        ),
        requestResponse(row.request, row.response),
      ),
    ),
  )

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Requests and responses · ${all.length}`,
      ),
    ),
    el('div', { class: 'mx-stack' }, all),
  )
}

$('run').addEventListener('click', () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  busy($('run'), 'Running…', async () => {
    notice.replaceChildren()
    $('verdict').hidden = true
    $('table-box').hidden = true
    $('details').replaceChildren()
    summary.textContent = `Running ${turns} turns for each version, both at the same time…`

    try {
      const { steady, changed, verdict } = await call('compare', {
        mode: mode.value,
        ...picker.value(),
      })

      $('verdict').className =
        `mx-callout${verdict.warn ? ' mx-callout--warn' : ''}`
      $('verdict-title').textContent = verdict.title
      $('verdict-text').textContent = verdict.text
      $('verdict').hidden = false

      summary.textContent =
        'Turn 1 starts cold in both versions. A turn keeps the cache when it reuses at least half of the previous request.'

      const estimated = steady.estimated || changed.estimated
      $('table-box').querySelector('th:nth-child(5)').textContent = estimated
        ? 'Cost (est.)'
        : 'Cost'

      $('rows').replaceChildren(
        ...turnRows(
          steady,
          changed,
          changed.rows.find((row) => row.status === 'lost')?.turn ?? null,
        ),
      )
      $('table-box').hidden = false

      $('details').replaceChildren(
        answers(steady, changed),
        requestStart(changed),
        requests(steady, changed),
      )
    } catch (error) {
      showError(notice, error)
      summary.textContent = empty
    }
  })
})
