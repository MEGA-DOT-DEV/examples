import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const queryBox = document.getElementById('query')
const splitBox = document.getElementById('split')
const button = document.getElementById('go')

const METHODS = [
  {
    id: 'keyword',
    name: 'Keyword',
    about:
      'BM25. It finds exact words, and a rare word counts more. Bar: score as a share of the top score.',
  },
  {
    id: 'semantic',
    name: 'Semantic',
    about:
      'Cosine similarity of the embeddings. Bar: the similarity, from 0 to 1.',
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    about:
      'RRF. Each list adds 1 / (60 + rank). Bar: score as a share of the best possible score.',
  },
]
const SHOWN = 5
const noteById = new Map(setup.notes.map((n) => [n.id, n]))
const number = (n) => n.toLocaleString('en-US')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// The latest search, and the query whose rankings are shown.
let result = null
let selected = setup.presets[0].id

// ── Settings ───────────────────────────────────────────────────────────

// Your own query: typed, and not a preset's query. Run searches every preset, and this one too.
function ownQuery() {
  const query = queryBox.value.trim()

  return setup.presets.some((p) => p.query === query) ? '' : query
}

function renderButton() {
  const count = setup.presets.length + (ownQuery() ? 1 : 0)
  button.textContent = `Run ${count} queries`
}

function costText(usage) {
  if (usage.cost == null) {
    return 'cost unknown'
  }

  return `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`
}

// ── The board: one row per preset ──────────────────────────────────────

// "Keyword, semantic and hybrid": method names in a sentence.
function names(methods) {
  const words = methods.map((m) => m.name.toLowerCase())
  const text =
    words.length > 1
      ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
      : words[0]

  return text[0].toUpperCase() + text.slice(1)
}

function verdict(ranks) {
  const winners = METHODS.filter((m) => ranks[m.id] === 1)
  if (winners.length === METHODS.length) {
    return 'All three win.'
  }
  if (!winners.length) {
    return 'No method wins.'
  }

  return `${names(winners)} win${winners.length === 1 ? 's' : ''}.`
}

// What the board means, from the board: a sentence shows only when the ranks hold it.
function meaning(ranks) {
  const rows = setup.presets.map((p) => ranks[p.id])
  const always = METHODS.filter((m) => rows.every((r) => r[m.id] === 1))
  const keywordAlone = rows.some((r) => r.keyword === 1 && r.semantic !== 1)
  const semanticAlone = rows.some((r) => r.semantic === 1 && r.keyword !== 1)

  // A safe middle: hybrid's rank is never worse than both other ranks. Not found counts as last.
  const middle = rows.every(
    (r) =>
      (r.hybrid ?? Infinity) <=
      Math.max(r.keyword ?? Infinity, r.semantic ?? Infinity),
  )

  // Fusion keeps what one list ranks high, wrong notes too: a wrong first keyword hit can stay first.
  const keepsKeyword = setup.presets.some((p) => {
    const first = result.presets[p.id].hybrid[0]?.noteId
    return (
      first !== undefined &&
      !p.relevant.includes(first) &&
      first === result.presets[p.id].keyword[0]?.noteId
    )
  })

  return [
    always.length
      ? `${names(always)} win${always.length === 1 ? 's' : ''} every query.`
      : 'No method wins every query.',
    keywordAlone && semanticAlone
      ? 'Keyword search wins on exact words, semantic search on meaning.'
      : keywordAlone
        ? 'Keyword search wins on exact words.'
        : semanticAlone
          ? 'Semantic search wins on meaning.'
          : null,
    middle && keepsKeyword
      ? 'Hybrid search is a safe middle: it is never behind both other methods, but it puts some wrong keyword hits first.'
      : middle
        ? 'Hybrid search is a safe middle: it is never behind both other methods.'
        : keepsKeyword
          ? 'Hybrid search puts some wrong keyword hits first.'
          : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function renderBoard() {
  const { ranks, wins } = result.scoreboard

  document.getElementById('board').replaceChildren(
    ...setup.presets.map((p) =>
      el(
        'tr',
        { class: selected === p.id ? 'hs-selected' : '' },
        el(
          'td',
          {},
          el('span', { class: 'hs-label' }, p.label),
          el(
            'span',
            { class: 'hs-why' },
            el('span', { class: 'hs-verdict' }, verdict(ranks[p.id])),
            ` ${p.about}`,
          ),
        ),
        ...METHODS.map((m) => {
          const rank = ranks[p.id][m.id]
          // Text, not only color: a win reads "1 ✓".
          if (rank === 1) {
            return el('td', { class: 'num mx-good' }, '1 ✓')
          }

          return el(
            'td',
            { class: 'num' },
            rank === null ? 'not found' : String(rank),
          )
        }),
      ),
    ),
  )

  document
    .getElementById('wins')
    .replaceChildren(
      el(
        'tr',
        {},
        el('td', {}, 'Wins'),
        ...METHODS.map((m) =>
          el(
            'td',
            { class: 'num' },
            `${wins[m.id]} of ${setup.presets.length}`,
          ),
        ),
      ),
    )

  document.getElementById('meaning').textContent = meaning(ranks)
}

// ── The three rankings of one query ────────────────────────────────────

function barWidth(method, hit, hits) {
  if (method === 'semantic') {
    return Math.max(0, hit.score)
  }
  if (method === 'hybrid') {
    return hit.score / (2 / 61)
  }

  return hit.score / hits[0].score
}

function hitRow(method, hit, i, hits, relevant) {
  const note = noteById.get(hit.noteId)
  const isRelevant = relevant.includes(hit.noteId)
  const digits = method === 'hybrid' ? 4 : method === 'semantic' ? 3 : 2

  return el(
    'li',
    { class: `hs-hit${isRelevant ? ' hs-hit--relevant' : ''}` },
    el('span', { class: 'hs-rank' }, String(i + 1)),
    el(
      'div',
      { class: 'hs-hit-body' },
      el(
        'div',
        { class: 'hs-hit-title' },
        el('span', {}, note.title),
        hit.part
          ? el(
              'span',
              { class: 'mx-muted mx-small' },
              ` · paragraph ${hit.part}`,
            )
          : null,
        isRelevant ? el('span', { class: 'hs-tag' }, 'relevant') : null,
      ),
      el(
        'div',
        { class: 'hs-score' },
        el(
          'span',
          { class: `mx-meter${isRelevant ? ' mx-meter--accent' : ''}` },
          el('i', {
            style: {
              width: `${Math.round(barWidth(method, hit, hits) * 100)}%`,
            },
          }),
        ),
        el('span', { class: 'hs-num' }, hit.score.toFixed(digits)),
      ),
    ),
  )
}

function column(method, rankings, relevant) {
  const hits = rankings[method.id]
  const missed = relevant
    .map((id) => ({ id, rank: hits.findIndex((h) => h.noteId === id) + 1 }))
    .filter((m) => m.rank === 0 || m.rank > SHOWN)

  return el(
    'section',
    { class: 'mx-panel hs-column' },
    el(
      'div',
      { class: 'hs-column-head' },
      el('h3', { class: 'hs-method' }, method.name),
      el('p', { class: 'mx-small mx-muted' }, method.about),
    ),
    hits.length
      ? el(
          'ol',
          { class: 'hs-hits' },
          hits
            .slice(0, SHOWN)
            .map((hit, i) => hitRow(method.id, hit, i, hits, relevant)),
        )
      : el(
          'p',
          { class: 'mx-muted mx-small' },
          'No note has a word of the query.',
        ),
    missed.map((m) =>
      el(
        'p',
        { class: 'mx-small mx-bad' },
        `Missed: ${noteById.get(m.id).title} · ${m.rank ? `rank ${m.rank}` : 'not found'}`,
      ),
    ),
  )
}

// The tabs only pick which query to show: every query was ranked in the same run.
function renderQuery() {
  const preset = setup.presets.find((p) => p.id === selected)
  const tabs = [
    ...setup.presets,
    ...(result.custom ? [{ id: 'custom', label: 'Your query' }] : []),
  ]

  document.getElementById('presets').replaceChildren(
    ...tabs.map((t) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(t.id === selected),
          onclick: () => {
            selected = t.id
            renderBoard()
            renderQuery()
          },
        },
        t.label,
      ),
    ),
  )

  document
    .getElementById('query-about')
    .replaceChildren(
      el('b', {}, `“${preset ? preset.query : result.custom.query}”`),
      el(
        'span',
        { class: 'mx-muted' },
        preset
          ? ` Answer key: ${preset.relevant.map((id) => noteById.get(id).title).join(' and ')}.`
          : ' No answer key, so no note is marked relevant.',
      ),
    )

  const rankings = preset ? result.presets[preset.id] : result.custom.rankings
  document
    .getElementById('columns')
    .replaceChildren(
      ...METHODS.map((m) => column(m, rankings, preset ? preset.relevant : [])),
    )
}

// ── Cost and the raw requests ──────────────────────────────────────────

function renderRaw() {
  const { corpus, queries } = result
  const sent = corpus.fromCache ? [queries] : [corpus, queries]
  const tokens = sent.reduce((sum, r) => sum + r.usage.inputTokens, 0)
  const costs = sent.map((r) => r.usage.cost)
  const cost = costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0)
  const estimate = sent.some((r) => r.usage.costSource === 'estimate')

  // Where the vectors came from and how long it took: an embedding request
  // generates no text, so it returns in a fraction of a second.
  const ms = sent.reduce((sum, r) => sum + r.ms, 0)
  const host = new URL(queries.request.url).host

  document.getElementById('meta').textContent =
    [
      `Semantic and hybrid search: ${plural(sent.length, 'embedding request')} to ${host} (${result.model}), ${number(tokens)} tokens, ${costText({ cost, costSource: estimate ? 'estimate' : 'provider' })}, ${(ms / 1000).toFixed(1)} s`,
      corpus.fromCache
        ? 'The notes come from an earlier search and were not sent again'
        : null,
      result.split ? `Long notes split: ${result.docs} texts` : null,
      'Keyword search runs locally, with no request',
    ]
      .filter(Boolean)
      .join('. ') + '.'

  document.getElementById('raw-count').textContent = corpus.fromCache
    ? '2 requests · 1 from an earlier search'
    : '2 requests'

  document
    .getElementById('raw')
    .replaceChildren(
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'p',
          { class: 'mx-small' },
          el('b', {}, `Notes · ${plural(corpus.count, 'text')}`),
          el(
            'span',
            { class: 'mx-muted' },
            corpus.fromCache
              ? ' · from cache: an earlier search with these settings sent them'
              : ` · ${number(corpus.usage.inputTokens)} tokens · ${costText(corpus.usage)}`,
          ),
        ),
        requestResponse(corpus.request, corpus.response),
      ),
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'p',
          { class: 'mx-small' },
          el('b', {}, `Queries · ${plural(queries.count, 'text')}`),
          el(
            'span',
            { class: 'mx-muted' },
            ` · ${number(queries.usage.inputTokens)} tokens · ${costText(queries.usage)}`,
          ),
        ),
        requestResponse(queries.request, queries.response),
      ),
    )
}

function renderResults() {
  document.getElementById('results').hidden = false
  document.getElementById('empty').hidden = true

  renderBoard()
  renderQuery()
  renderRaw()
}

// ── Run ────────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const query = ownQuery()

  try {
    result = await busy(button, 'Searching…', () =>
      call('search', { query, split: splitBox.checked, ...picker.value() }),
    )

    // Your own query shows at once. Without one, the query on show stays.
    if (query) {
      selected = 'custom'
    } else if (selected === 'custom') {
      selected = setup.presets[0].id
    }

    renderResults()
  } catch (error) {
    showError(notice, error)
  }

  // The query box may have changed while the search ran.
  renderButton()
}

function renderNotes() {
  document.getElementById('notes-count').textContent =
    `${setup.notes.length} notes`

  document.getElementById('notes').replaceChildren(
    ...setup.notes.map((n) =>
      el(
        'li',
        {},
        el('b', {}, n.title),
        n.body.split(/\n\s*\n/).map((p) => el('p', {}, p)),
      ),
    ),
  )
}

const picker = await providerPicker(document.getElementById('picker'), {
  purpose: 'embedding',
})
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

renderButton()
renderNotes()
document.getElementById('lead').textContent =
  `The page searches the ${setup.notes.length} notes of a team wiki in three ways: keyword, semantic and hybrid. Code checks each ranking against an answer key: the notes that answer the query.`
document.getElementById('split-hint').textContent =
  `A note over ${setup.splitOver} characters becomes one text per paragraph. Try it with the Long note query.`
document.getElementById('empty-text').textContent =
  `Press Run. It searches with each query below. Up to 2 embedding requests (about ${number(setup.approxTokens)} tokens), under 0.01 cent.`
document
  .getElementById('queries')
  .replaceChildren(
    ...setup.presets.map((p) =>
      el('li', {}, el('b', {}, p.label), ` “${p.query}”`),
    ),
  )

queryBox.addEventListener('input', () => {
  if (!button.disabled) {
    renderButton()
  }
})
queryBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (!button.disabled) {
      start()
    }
  }
})
button.addEventListener('click', start)
