import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
const threadSelect = document.getElementById('thread')
const notice = document.getElementById('notice')
const button = document.getElementById('run')
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const titleOf = (id) => setup.memories.find((memory) => memory.id === id).title
const list = (items) =>
  items.length < 3
    ? items.join(' and ')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

threadSelect.replaceChildren(
  ...setup.threads.map((thread) =>
    el('option', { value: thread.id }, thread.title),
  ),
)
document.getElementById('catalog-count').textContent = plural(
  setup.memories.length,
  'memory',
  'memories',
)
document
  .getElementById('catalog')
  .replaceChildren(
    el('p', {}, el('b', {}, 'User profile · '), setup.profile),
    ...setup.memories.map((memory) =>
      el(
        'p',
        { class: 'mx-small' },
        el('b', {}, `${memory.title} · `),
        memory.text,
      ),
    ),
  )

function showEmpty() {
  document.getElementById('empty').hidden = false
  document.getElementById('verdict').hidden = true
  document.getElementById('results').hidden = true
}

function renderThread() {
  const thread = setup.threads.find((item) => item.id === threadSelect.value)
  document
    .getElementById('conversation')
    .replaceChildren(
      ...thread.turns.map((turn) =>
        el(
          'p',
          { class: 'cr-turn' },
          el('b', {}, `${turn.role === 'user' ? 'User' : 'Assistant'} · `),
          turn.text,
        ),
      ),
    )

  showEmpty()
}
threadSelect.addEventListener('change', renderThread)
renderThread()

/** One plain sentence: which searches loaded every key memory. */
function verdict(modes, key) {
  const needed = list(key.documents.map((id) => `“${titleOf(id)}”`))
  const hit = modes.filter((mode) => mode.found.length === key.documents.length)
  const missed = modes.filter(
    (mode) => mode.found.length < key.documents.length,
  )

  if (!missed.length) {
    return `All three searches loaded ${needed}. This last message is clear enough on its own.`
  }
  if (!hit.length) {
    return `No search loaded ${needed}.`
  }
  if (missed.length === 1 && missed[0].mode === 'last-message') {
    return `The last message alone missed ${needed}. Both searches that use the whole conversation loaded it.`
  }

  return `Loaded ${needed}: ${list(hit.map((mode) => mode.label))}. Missed it: ${list(missed.map((mode) => mode.label))}.`
}

// The memory text is in the "User profile and memories" fold; a card shows the title.
function memoryRow(doc, similarity, key) {
  return el(
    'li',
    {},
    el('b', {}, doc.title),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `similarity ${similarity.toFixed(2)}`,
      key.documents.includes(doc.id)
        ? el('span', { class: 'mx-good' }, ' · key memory')
        : null,
    ),
  )
}

function modeCard(mode, key) {
  const score = (id) =>
    mode.candidates.find((candidate) => candidate.id === id).similarity
  const picked = new Set(mode.selected.map((doc) => doc.id))

  return el(
    'article',
    { class: 'mx-panel cr-mode' },
    el('h3', { class: 'mx-h3' }, mode.label),
    el(
      'div',
      { class: 'cr-part' },
      el('span', { class: 'mx-label' }, 'Search text'),
      el('p', {}, mode.query),
    ),
    el(
      'div',
      { class: 'cr-part' },
      el('span', { class: 'mx-label' }, 'Loaded memories'),
      el(
        'ul',
        { class: 'cr-loaded' },
        ...mode.selected.map((doc) => memoryRow(doc, score(doc.id), key)),
      ),
    ),
    mode.mode === 'reranked'
      ? el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, 'Candidates'),
            el(
              'span',
              { class: 'mx-small mx-muted' },
              `${mode.selected.length} of ${mode.candidates.length} picked`,
            ),
          ),
          el(
            'ol',
            { class: 'cr-candidates mx-small' },
            ...mode.candidates.map((candidate) =>
              el(
                'li',
                { class: picked.has(candidate.id) ? '' : 'mx-muted' },
                `${candidate.title} · ${candidate.similarity.toFixed(2)}${picked.has(candidate.id) ? ' · picked' : ''}`,
              ),
            ),
          ),
        )
      : null,
    el(
      'div',
      { class: 'cr-part' },
      el('span', { class: 'mx-label' }, 'Answer'),
      modelText(mode.answer),
    ),
  )
}

function render(result) {
  const { thread, modes } = result
  const key = thread.key

  document.getElementById('empty').hidden = true
  document.getElementById('verdict').hidden = false
  document.getElementById('verdict').textContent = verdict(modes, key)
  document.getElementById('results').hidden = false

  document
    .getElementById('scores')
    .replaceChildren(
      ...modes.map((mode) =>
        el(
          'div',
          { class: 'mx-readout' },
          el('span', { class: 'mx-label' }, mode.label),
          el(
            'b',
            {},
            `${mode.found.length} of ${plural(key.documents.length, 'key memory', 'key memories')}`,
          ),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            `${mode.namedFacts.length} of ${plural(key.facts.length, 'key fact')} in the answer`,
          ),
        ),
      ),
    )

  document.getElementById('key').textContent =
    `Answer key: ${list(key.facts.map((fact) => `“${fact}”`))}. A fact counts only when the answer uses these exact words. Code uses the key to score; the model never sees it.`
  document
    .getElementById('modes')
    .replaceChildren(...modes.map((mode) => modeCard(mode, key)))

  const calls = [...result.sharedCalls, ...modes.flatMap((mode) => mode.calls)]
  const sent = calls.filter((entry) => !entry.fromCache)
  const cost = sent.some((entry) => entry.usage.cost == null)
    ? null
    : sent.reduce((sum, entry) => sum + entry.usage.cost, 0)
  const tokens = sent
    .reduce((sum, entry) => sum + entry.usage.inputTokens, 0)
    .toLocaleString('en-US')
  const reused = calls[0].fromCache

  document.getElementById('usage').textContent =
    `${plural(sent.length, 'request')} · ${tokens} input tokens · ${cost == null ? 'cost unknown' : `${formatCost(cost)}${sent.some((entry) => entry.usage.costSource === 'estimate') ? ' est.' : ''}`} · ${reused ? 'memory vectors from an earlier run' : 'memories embedded on this run'}`
  document.getElementById('raw-count').textContent = plural(
    sent.length,
    'request',
  )

  document
    .getElementById('raw')
    .replaceChildren(
      ...sent.map((entry) =>
        el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, entry.step),
            el(
              'span',
              { class: 'mx-small mx-muted' },
              `${entry.usage.inputTokens.toLocaleString('en-US')} input tokens`,
            ),
          ),
          requestResponse(entry.request, entry.response),
        ),
      ),
    )
}

button.addEventListener('click', () =>
  busy(button, 'Searching…', async () => {
    if (!picker.hasKey()) {
      return missingKeyNote(notice)
    }

    showError(notice, null)
    try {
      render(
        await call('run', { ...picker.value(), thread: threadSelect.value }),
      )
    } catch (error) {
      showEmpty()
      showError(notice, error)
    }
  }),
)
