import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')

let question = setup.questions[0]
let runs = setup.defaultRuns
// One batch at a time: { question, runs, results: { [modeId]: (run | { error } | null)[] } }.
let batch = null
let batchId = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (path) => path.replace(/\.md$/, '')
const factNotes = (q) => new Set(q.facts.map((f) => f.note))
const finished = (modeId) =>
  (batch?.results[modeId] ?? []).filter((r) => r && !r.error)

// ── Settings ───────────────────────────────────────────────────────────

function seg(container, values, label, current, onPick) {
  container.replaceChildren(
    ...values.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event) => {
            onPick(value)
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }
          },
        },
        label(value),
      ),
    ),
  )
}

function renderEmpty() {
  // A run takes about 3 requests of a few thousand input tokens each.
  const total = runs * setup.modes.length
  document.getElementById('empty').textContent =
    `Press Run all modes. ${plural(total, 'agent run')}, about ${total * 3} requests, under 1 cent with the default model.`
}

function renderQuestion() {
  document.getElementById('question-hint').textContent =
    `A search for its words finds ${short(question.matched)}. A correct answer names ${plural(question.facts.length, 'fact')}.`
}

document.getElementById('note-count').textContent = String(setup.notes.length)
seg(
  document.getElementById('questions'),
  setup.questions,
  (q) => q.text,
  question,
  (q) => {
    question = q
    renderQuestion()
  },
)
seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  String,
  runs,
  (n) => {
    runs = n
    renderEmpty()
  },
)
document
  .getElementById('mode-list')
  .replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'un-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
      ),
    ),
  )
document.getElementById('map-size').textContent =
  `${plural(setup.map.split('\n').length, 'line')} · in the instructions of “With a map” and “Map and links”`
document.getElementById('map').replaceChildren(codeBlock(setup.map, 'md'))
document.getElementById('tools-size').textContent =
  `${plural(setup.tools.length, 'tool')} · the same in each mode`
document
  .getElementById('tools')
  .replaceChildren(
    el(
      'div',
      { class: 'mx-stack un-pad' },
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Instructions. “With a map” and “Map and links” add the map below them.',
      ),
      codeBlock(setup.instructions),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Tools. Without links, the descriptions do not mention related notes, and the results do not include them.',
      ),
      codeBlock(prettyJson(setup.tools), 'json'),
    ),
  )
renderQuestion()
renderEmpty()

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The headline: facts covered per mode ───────────────────────────────

function covered(modeId) {
  const done = finished(modeId)

  return {
    n: done.reduce((s, r) => s + r.score.covered, 0),
    of: done.length * batch.question.facts.length,
    runs: done.length,
  }
}

/** One sentence on what the numbers mean. Says so when this batch does not show the effect. */
function meaning() {
  const rate = (id) => {
    const c = covered(id)
    return c.of ? c.n / c.of : null
  }

  const [plain, map, links, both] = ['search', 'map', 'links', 'both'].map(rate)
  if (plain === null || map === null) {
    return ''
  }

  const mapPart =
    map > plain
      ? 'The map raised the share of facts. It sent the agent to notes that its search did not reach.'
      : 'In these runs, the map did not raise the share of facts.'
  const linkPart =
    links === null
      ? ''
      : links > map
        ? ' Links alone helped more than the map here.'
        : links > plain
          ? ' Links alone helped less. The agent saw the related notes by name, but often did not open them.'
          : ' Links alone did not help here. The agent saw the related notes by name and did not open them.'
  // The sentence follows the numbers of this batch, so it can also say that the combination did not win.
  const bothPart =
    both === null
      ? ''
      : both > Math.max(map, links ?? 0)
        ? ' Map and links together covered the most facts. The map says where to start, and the links lead on from there.'
        : both === map
          ? ' Map and links together covered as many facts as the map alone.'
          : both < map
            ? ' Map and links together covered fewer facts than the map alone.'
            : ' Map and links together did not cover the most facts.'
  const vary =
    map > plain && (both === null || both >= map)
      ? ''
      : ' Agents vary. Add runs under Advanced and run again.'

  return `${mapPart}${linkPart}${bothPart}${vary}`
}

function renderResult() {
  const q = batch.question
  document.getElementById('result').hidden = false
  document.getElementById('readouts').replaceChildren(
    ...setup.modes.map((m) => {
      const c = covered(m.id)
      return el(
        'div',
        { class: 'mx-readout' },
        el('span', { class: 'mx-label' }, m.label),
        el('b', {}, c.of ? `${c.n} of ${c.of}` : '…'),
      )
    }),
  )
  document.getElementById('meaning').textContent = meaning()

  // Each fact: in how many runs of each mode the answer named it.
  document
    .getElementById('facts-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Fact'),
        el('th', {}, 'Note'),
        ...setup.modes.map((m) => el('th', { class: 'num' }, m.label)),
      ),
    )
  document.getElementById('facts').replaceChildren(
    ...q.facts.map((f) =>
      el(
        'tr',
        {},
        el('td', {}, f.label),
        el('td', { class: 'un-path' }, short(f.note)),
        ...setup.modes.map((m) => {
          const done = finished(m.id)
          const n = done.filter(
            (r) => r.score.facts.find((s) => s.id === f.id)?.covered,
          ).length
          return el(
            'td',
            { class: 'num' },
            done.length
              ? el(
                  'span',
                  { class: n === done.length ? 'mx-good' : n ? '' : 'mx-bad' },
                  `${n}/${done.length}`,
                )
              : '…',
          )
        }),
      ),
    ),
  )

  const all = setup.modes.flatMap((m) => finished(m.id))
  const usage = all.reduce(
    (t, r) =>
      t
        ? {
            inputTokens: t.inputTokens + r.usage.inputTokens,
            outputTokens: t.outputTokens + r.usage.outputTokens,
            reasoningTokens: t.reasoningTokens + r.usage.reasoningTokens,
            cost:
              t.cost == null || r.usage.cost == null
                ? null
                : t.cost + r.usage.cost,
            costSource:
              t.costSource === 'estimate' || r.usage.costSource === 'estimate'
                ? 'estimate'
                : r.usage.costSource,
          }
        : { ...r.usage },
    null,
  )

  const requests = all.reduce((n, r) => n + r.steps.length, 0)
  document.getElementById('total').textContent = usage
    ? `${plural(all.length, 'run')} · ${plural(requests, 'request')} · ${usageText(usage)} · ${all[0].model}`
    : ''
}

// ── The reach map, as in the lesson's figure ───────────────────────────

const BANDS = [
  { id: 'read', label: 'Read' },
  {
    id: 'seen',
    label: 'Seen, not read',
    hint: 'a search result, a folder list or a link named it',
  },
  { id: 'never', label: 'Never reached' },
]

function reachOf(path, done) {
  const read = done.filter((r) => r.read.includes(path)).length
  const seen = done.filter((r) => r.seen.includes(path)).length

  return { read, seen, band: read ? 'read' : seen ? 'seen' : 'never' }
}

function noteBox(note, reach, holds, total) {
  // A count only when there is more than one run: "2/3" means 2 of 3 runs.
  const count =
    total > 1 && reach.band !== 'never'
      ? `${reach.band === 'read' ? reach.read : reach.seen}/${total}`
      : null

  return el(
    'div',
    {
      class: `un-note is-${reach.band}${holds ? ' is-fact' : ''}`,
      title: note.path,
    },
    el(
      'span',
      { class: 'un-note-title' },
      holds
        ? el('i', { class: 'un-fact', 'aria-label': 'holds required facts' })
        : null,
      note.title,
    ),
    el(
      'span',
      { class: 'un-note-meta' },
      note.folder,
      count ? el('b', {}, count) : null,
    ),
  )
}

function renderMaps() {
  const holds = factNotes(batch.question)
  document.getElementById('reach').hidden = false
  document.getElementById('maps').replaceChildren(
    ...setup.modes.map((m) => {
      const done = finished(m.id)
      const placed = setup.notes.map((n) => ({
        note: n,
        reach: reachOf(n.path, done),
      }))
      // Fact notes first in each band, so they are easy to find.
      placed.sort(
        (a, b) =>
          Number(holds.has(b.note.path)) - Number(holds.has(a.note.path)),
      )

      return el(
        'section',
        { class: 'mx-plate un-map' },
        el(
          'div',
          { class: 'mx-spread' },
          el('h3', { class: 'mx-h3' }, m.label),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            done.length
              ? `${plural(done.length, 'run')}${done.length > 1 ? ` · a count is runs out of ${done.length}` : ''}`
              : 'running…',
          ),
        ),
        ...BANDS.map((band) => {
          const items = placed.filter((p) => p.reach.band === band.id)

          return el(
            'div',
            { class: `un-band is-${band.id}` },
            el(
              'div',
              { class: 'un-band-head' },
              el(
                'span',
                { class: 'mx-label' },
                `${band.label} · ${items.length}`,
              ),
              band.hint ? el('span', { class: 'mx-hint' }, band.hint) : null,
            ),
            items.length
              ? el(
                  'div',
                  { class: 'un-notes' },
                  items.map((p) =>
                    noteBox(
                      p.note,
                      p.reach,
                      holds.has(p.note.path),
                      done.length,
                    ),
                  ),
                )
              : el('p', { class: 'mx-small mx-muted' }, 'None.'),
          )
        }),
      )
    }),
  )
}

// ── Answers: one card per run, every answer open ───────────────────────

function factList(score) {
  return el(
    'ul',
    { class: 'un-checks' },
    score.facts.map((f) =>
      el(
        'li',
        { class: f.covered ? 'is-hit' : 'is-miss' },
        el(
          'span',
          { class: f.covered ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
          f.covered ? '✓' : '✗',
        ),
        el(
          'span',
          {},
          f.label,
          f.covered && !f.noteRead
            ? el(
                'span',
                { class: 'mx-muted' },
                ' · the agent did not read its note',
              )
            : null,
        ),
      ),
    ),
  )
}

function callView(c) {
  let output = c.output
  try {
    output = prettyJson(JSON.parse(c.output))
  } catch {}

  const block = codeBlock(output, 'json')
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: `un-call${c.error ? ' is-error' : ''}` },
    el(
      'div',
      { class: 'un-call-head' },
      el('code', { class: 'un-call-name' }, c.name),
      el('code', {}, c.arguments),
    ),
    block,
  )
}

function stepsBlock(run) {
  const calls = run.steps.reduce((n, s) => n + s.calls.length, 0)

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Steps'),
      ' ',
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(run.steps.length, 'request')} · ${plural(calls, 'tool call')}`,
      ),
    ),
    el(
      'ol',
      { class: 'un-steps' },
      run.steps.map((s) =>
        el(
          'li',
          { class: 'mx-stack' },
          el(
            'div',
            { class: 'mx-spread' },
            el(
              'span',
              { class: 'mx-small' },
              `Request ${s.number} · ${s.calls.length ? plural(s.calls.length, 'tool call') : 'the answer'}`,
            ),
            el('span', { class: 'mx-small mx-muted' }, usageText(s.usage)),
          ),
          s.calls.map(callView),
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el('span', { class: 'mx-label' }, 'Request and response'),
              ' ',
              el('span', { class: 'mx-small mx-muted' }, `step ${s.number}`),
            ),
            el(
              'div',
              { class: 'un-pad' },
              requestResponse(s.request, s.response),
            ),
          ),
        ),
      ),
    ),
  )
}

function runCard(modeId, i) {
  const r = batch.results[modeId][i]
  const head = el(
    'div',
    { class: 'mx-spread' },
    el('span', { class: 'un-run' }, `Run ${i + 1}`),
    !r
      ? el('span', { class: 'mx-small mx-muted' }, 'running…')
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : el(
            'b',
            { class: r.score.covered === r.score.total ? 'mx-good' : '' },
            `${r.score.covered} of ${r.score.total} facts`,
          ),
  )

  if (!r) {
    return el('article', { class: 'mx-panel un-card' }, head)
  }

  if (r.error) {
    return el(
      'article',
      { class: 'mx-panel un-card' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  return el(
    'article',
    { class: 'mx-panel un-card' },
    head,
    factList(r.score),
    r.end === 'step_limit'
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          `No answer. The agent reached the limit of ${setup.maxSteps} requests.`,
        )
      : modelText(r.answer || '(no text)', 'mx-output un-answer'),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `Read: ${r.read.map(short).join(', ') || 'nothing'}`,
    ),
    stepsBlock(r),
  )
}

// Built once per batch; a card is replaced when its run ends, so open folds in other cards stay open.
function renderAnswers() {
  document.getElementById('answers-box').hidden = false
  document.getElementById('answers').replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'un-col' },
        el('h3', { class: 'mx-h3 un-col-head' }, m.label),
        ...batch.results[m.id].map((_, i) =>
          el(
            'div',
            {
              class: 'un-slot',
              'data-slot': `${m.id}-${i}`,
              style: { '--row': String(i + 2) },
            },
            runCard(m.id, i),
          ),
        ),
      ),
    ),
  )
}

function renderCard(modeId, i) {
  document
    .querySelector(`[data-slot="${modeId}-${i}"]`)
    ?.replaceChildren(runCard(modeId, i))
}

// ── Running: every mode × runs, at most 4 runs at the same time ─────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true
  const id = ++batchId
  batch = {
    question,
    runs,
    results: Object.fromEntries(
      setup.modes.map((m) => [m.id, new Array(runs).fill(null)]),
    ),
  }

  renderResult()
  renderMaps()
  renderAnswers()

  // Run 1 of every mode first, so the modes fill at the same pace.
  const units = []
  for (let i = 0; i < runs; i++) {
    for (const m of setup.modes) {
      units.push({ mode: m.id, i })
    }
  }

  const input = { question: question.id, ...picker.value() }
  let next = 0
  const worker = async () => {
    while (next < units.length && id === batchId) {
      const unit = units[next++]
      let result
      try {
        result = await call('run', { ...input, mode: unit.mode })
      } catch (error) {
        if (error.missingKey) {
          showError(notice, error)
        }
        result = { error: error.message }
      }

      if (id !== batchId) {
        return
      }

      batch.results[unit.mode][unit.i] = result
      renderResult()
      renderMaps()
      renderCard(unit.mode, unit.i)
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

button.addEventListener('click', start)
