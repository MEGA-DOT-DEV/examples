import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'
import { RENDERERS, renderNote } from './components.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')

let runs = setup.defaultRuns
let topic = setup.topics[0]
// One batch at a time: { runs, results: { [modeId]: { [topicId]: (run | { error } | null)[] } } }.
let batch = null
let batchId = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const lines = (text) => plural(text.split('\n').length, 'line')
// About $0.0002 per note with the default model (README: 36 notes for $0.007); rounded up.
const NOTE_COST = 0.0003
const libraryFor = (kind) => setup.library.find((c) => c.kind === kind)
const finished = (modeId, topicId) =>
  (topicId
    ? batch.results[modeId][topicId]
    : Object.values(batch.results[modeId]).flat()
  ).filter((r) => r && !r.error)

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
  const total = runs * setup.topics.length * setup.modes.length
  const cents = Math.max(1, Math.ceil(total * NOTE_COST * 100))

  document.getElementById('empty').textContent =
    `Press Write all notes. About ${plural(total, 'request')}, under ${plural(cents, 'cent')}.`
}

document.getElementById('topic-count').textContent = String(setup.topics.length)
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
        { class: 'gc-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
      ),
    ),
  )

document.getElementById('library-size').textContent =
  `${plural(setup.library.length, 'component')}: ${setup.library.map((c) => c.name).join(', ')} · each with a props schema and a preview`
document
  .getElementById('library')
  .replaceChildren(
    ...setup.library.map((c) =>
      el(
        'div',
        { class: 'mx-stack gc-lib' },
        el(
          'div',
          {},
          el('code', { class: 'gc-lib-name' }, `<${c.name} />`),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            ` for ${c.kind}. ${c.useFor}`,
          ),
        ),
        RENDERERS[c.name](c.sample),
        codeBlock(prettyJson(c.schema), 'json'),
      ),
    ),
  )

document.getElementById('template-size').textContent =
  `${lines(setup.template)} · guided mode only`
document
  .getElementById('template')
  .replaceChildren(codeBlock(setup.template, 'md'))

document.getElementById('instructions-size').textContent = setup.modes
  .map((m) => `${m.label} · ${lines(m.instructions)}`)
  .join(', ')
document
  .getElementById('instructions')
  .replaceChildren(
    ...setup.modes.flatMap((m) => [
      el('p', { class: 'mx-small mx-muted' }, m.label),
      codeBlock(m.instructions, 'md'),
    ]),
  )

document.getElementById('topics-size').textContent =
  `${plural(setup.topics.length, 'brief')} · two of each kind of content`
document
  .getElementById('topics')
  .replaceChildren(
    ...setup.topics.map((t) =>
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'p',
          { class: 'mx-small mx-muted' },
          `${t.kind} · key points: ${t.points.map((p) => p.label).join(', ')}`,
        ),
        codeBlock(t.brief, 'md'),
      ),
    ),
  )

renderEmpty()

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── Results ────────────────────────────────────────────────────────────

function stats(modeId) {
  const done = finished(modeId)
  const tags = done.flatMap((r) => r.check.tags)
  const known = tags.filter((t) => t.known)

  return {
    done: done.length,
    parsed: done.filter((r) => r.check.parsed).length,
    unknown: tags.length - known.length,
    known: known.length,
    valid: known.filter((t) => !t.errors.length).length,
    points: done.reduce(
      (n, r) => n + r.points.filter((p) => p.covered).length,
      0,
    ),
    possible: done.reduce((n, r) => n + r.points.length, 0),
    kinds: setup.library.map((c) => {
      const ofKind = done.filter((r) => r.kind === c.kind)
      return {
        runs: ofKind.length,
        used: ofKind.filter((r) => r.check.expectedUsed).length,
        names: [...new Set(ofKind.flatMap((r) => r.check.components))].sort(),
      }
    }),
    names: new Set(tags.map((t) => t.name)),
    shapes: [...new Set(tags.map((t) => t.shape))].sort(),
    usage: done.length
      ? done
          .map((r) => r.usage)
          .reduce((a, b) => ({
            inputTokens: a.inputTokens + b.inputTokens,
            outputTokens: a.outputTokens + b.outputTokens,
            reasoningTokens: a.reasoningTokens + b.reasoningTokens,
            cost: a.cost == null || b.cost == null ? null : a.cost + b.cost,
            costSource:
              a.costSource === 'estimate' || b.costSource === 'estimate'
                ? 'estimate'
                : b.costSource,
          }))
      : null,
    ms: done.reduce((n, r) => n + r.ms, 0),
  }
}

const share = (n, of) => (of ? n / of : 0)
const usedLibrary = (s) => s.kinds.reduce((n, k) => n + k.used, 0)

/** What the readouts mean, without their numbers. It follows this batch, also when the batch does not show the effect. */
function meaning(free, guided) {
  if (!free.done || !guided.done) {
    return ''
  }

  const parts = []
  if (
    share(usedLibrary(guided), guided.done) >
    share(usedLibrary(free), free.done)
  ) {
    parts.push(
      'With the library, the model used the same component for the same kind of content.',
    )
  } else {
    parts.push(
      'Free notes used the library component names as often as guided notes.',
    )
  }

  if (share(guided.valid, guided.known) > share(free.valid, free.known)) {
    parts.push(
      'Guided tags match one schema, so one renderer per component draws them. Free notes invent their own props.',
    )
  }

  parts.push(
    share(guided.points, guided.possible) >= share(free.points, free.possible)
      ? 'The guidance removed no key points.'
      : 'Guided notes lost some key points. The template may limit the model.',
  )

  return parts.join(' ')
}

function cell(text, good, bad) {
  return el(
    'td',
    { class: 'num' },
    el('span', { class: good ? 'mx-good' : bad ? 'mx-bad' : '' }, text),
  )
}

function readout(label, value, cls) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', { class: cls }, value),
  )
}

function renderResult() {
  const all = Object.fromEntries(setup.modes.map((m) => [m.id, stats(m.id)]))
  const pending = (s) => !s.done
  document.getElementById('result').hidden = false

  // The headline: notes that use the library component for their kind, and library tags whose props pass the schema.
  document.getElementById('verdict').replaceChildren(
    ...setup.modes.map((m) => {
      const s = all[m.id]
      const used = usedLibrary(s)
      return readout(
        `${m.label} · library component`,
        pending(s) ? '…' : `${used} of ${plural(s.done, 'note')}`,
        pending(s) ? '' : used === s.done ? 'mx-good' : 'mx-bad',
      )
    }),
    ...setup.modes.map((m) => {
      const s = all[m.id]
      return readout(
        `${m.label} · valid props`,
        pending(s)
          ? '…'
          : s.known
            ? `${s.valid} of ${plural(s.known, 'tag')}`
            : 'no tags',
        !s.known ? '' : s.valid === s.known ? 'mx-good' : 'mx-bad',
      )
    }),
  )

  document.getElementById('meaning').textContent = meaning(all.free, all.guided)

  const head = (first) =>
    el(
      'tr',
      {},
      el('th', {}, first),
      ...setup.modes.map((m) => el('th', { class: 'num' }, m.label)),
    )

  document
    .getElementById('kinds-head')
    .replaceChildren(head('Kind of content → library component'))
  document.getElementById('kinds').replaceChildren(
    ...setup.library.map((c, k) =>
      el(
        'tr',
        {},
        el('td', {}, `${c.kind} → `, el('code', {}, c.name)),
        ...setup.modes.map((m) => {
          const s = all[m.id].kinds[k]
          if (!s.runs) {
            return el('td', { class: 'num mx-muted' }, '…')
          }

          return el(
            'td',
            { class: 'num' },
            el(
              'span',
              { class: s.used === s.runs ? 'mx-good' : s.used ? '' : 'mx-bad' },
              `${s.used} of ${s.runs}`,
            ),
            el(
              'span',
              { class: 'gc-names' },
              s.names.join(', ') || 'no components',
            ),
          )
        }),
      ),
    ),
    el(
      'tr',
      {},
      el('td', {}, 'Component names used'),
      ...setup.modes.map((m) =>
        pending(all[m.id])
          ? el('td', { class: 'num mx-muted' }, '…')
          : el('td', { class: 'num' }, String(all[m.id].names.size)),
      ),
    ),
    el(
      'tr',
      {},
      el(
        'td',
        {},
        'Prop shapes used',
        el(
          'span',
          { class: 'gc-names' },
          'A component with its prop names. Fewer shapes mean fewer cases to render.',
        ),
      ),
      ...setup.modes.map((m) => {
        const s = all[m.id]
        if (pending(s)) {
          return el('td', { class: 'num mx-muted' }, '…')
        }

        return el(
          'td',
          { class: 'num' },
          el(
            'details',
            { class: 'gc-shapes' },
            el('summary', {}, String(s.shapes.length)),
            el(
              'ul',
              {},
              s.shapes.map((x) => el('li', {}, el('code', {}, x))),
            ),
          ),
        )
      }),
    ),
  )

  document.getElementById('summary-head').replaceChildren(head('Check'))
  const rows = [
    [
      'Notes that parse',
      (s) =>
        cell(
          `${s.parsed} of ${s.done}`,
          s.parsed === s.done,
          s.parsed < s.done,
        ),
    ],
    [
      'Tags not in the library',
      (s) => cell(String(s.unknown), s.unknown === 0, s.unknown > 0),
    ],
    [
      'Key points covered',
      (s) =>
        cell(
          `${s.points} of ${s.possible}`,
          s.points === s.possible,
          s.points < s.possible,
        ),
    ],
    [
      'Tokens and cost',
      (s) => el('td', { class: 'num mx-small' }, usageText(s.usage)),
    ],
    [
      'Time per note',
      (s) =>
        el('td', { class: 'num' }, `${(s.ms / s.done / 1000).toFixed(1)} s`),
    ],
  ]
  document
    .getElementById('summary')
    .replaceChildren(
      ...rows.map(([label, value]) =>
        el(
          'tr',
          {},
          el('td', {}, label),
          ...setup.modes.map((m) =>
            pending(all[m.id])
              ? el('td', { class: 'num mx-muted' }, '…')
              : value(all[m.id]),
          ),
        ),
      ),
    )

  const done = setup.modes.flatMap((m) => finished(m.id))
  const total = batch.runs * setup.topics.length * setup.modes.length
  document.getElementById('total').textContent = done.length
    ? `${done.length} of ${plural(total, 'note')} · ${done[0].provider} · ${done[0].model}`
    : ''
}

// ── Notes: every run of one topic, free and guided side by side ─────────

function checkList(run) {
  const c = run.check
  const item = (ok, ...text) =>
    el(
      'li',
      { class: ok ? 'is-hit' : 'is-miss' },
      el(
        'span',
        { class: ok ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
        ok ? '✓' : '✗',
      ),
      el('span', {}, ...text),
    )

  const bad = c.tags.find((t) => t.known && t.errors.length)

  return el(
    'ul',
    { class: 'gc-checks' },
    c.parsed
      ? item(true, 'Parses')
      : item(false, `Does not parse: ${c.parseError}`),
    c.parsed
      ? item(
          !c.unknown.length && c.components.length > 0,
          c.components.length
            ? c.components
                .flatMap((name, i) => [
                  i ? ', ' : null,
                  el(
                    'code',
                    { class: c.unknown.includes(name) ? 'gc-unknown' : '' },
                    name,
                  ),
                ])
                .concat(
                  c.unknown.length
                    ? ` · ${c.unknown.length} not in the library`
                    : [],
                )
            : 'No components',
        )
      : null,
    c.knownTags
      ? item(!bad, bad ? `Props: ${bad.errors[0]}` : 'Props match the schema')
      : null,
    run.points.map((p) => item(p.covered, p.label)),
    run.status === 'incomplete'
      ? item(false, 'Cut off at the token limit')
      : null,
  )
}

function source(run) {
  const block = codeBlock(run.note, 'md')
  block.classList.add('gc-source')
  return block
}

function noteCard(modeId, i) {
  const r = batch.results[modeId][topic.id][i]
  const head = el(
    'div',
    { class: 'mx-spread' },
    el('span', { class: 'gc-run' }, `Run ${i + 1}`),
    !r
      ? el('span', { class: 'mx-small mx-muted' }, 'writing…')
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : null,
  )

  if (!r) {
    return el('article', { class: 'mx-panel gc-card' }, head)
  }

  if (r.error) {
    return el(
      'article',
      { class: 'mx-panel gc-card' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  const rendered = modeId === 'guided' && r.parsed.ok

  return el(
    'article',
    { class: 'mx-panel gc-card' },
    head,
    checkList(r),
    rendered ? renderNote(r.parsed, r.check.tags) : source(r),
    rendered
      ? el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, `Source · ${lines(r.note)}`),
          ),
          source(r),
        )
      : null,
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Request and response'),
        el('span', { class: 'mx-small mx-muted' }, usageText(r.usage)),
      ),
      el('div', { class: 'gc-pad' }, requestResponse(r.request, r.response)),
    ),
  )
}

// Built when the topic or the batch changes; a card is replaced when its run ends, so open folds elsewhere stay open.
function renderNotes() {
  document.getElementById('notes-box').hidden = false

  const expected = libraryFor(topic.kind).name
  document.getElementById('topic-about').textContent =
    `${topic.title}. Kind: ${topic.kind}. The library component for it is ${expected}.`

  document.getElementById('notes').replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'gc-col' },
        el('h3', { class: 'mx-h3 gc-col-head' }, m.label),
        ...batch.results[m.id][topic.id].map((_, i) =>
          el(
            'div',
            {
              class: 'gc-slot',
              'data-slot': `${m.id}-${i}`,
              style: { '--row': String(i + 2) },
            },
            noteCard(m.id, i),
          ),
        ),
      ),
    ),
  )
}

seg(
  document.getElementById('topic-pick'),
  setup.topics,
  (t) => t.label,
  topic,
  (t) => {
    topic = t
    renderNotes()
  },
)

// ── Running: every topic × mode × run, at most 4 requests at the same time ─

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true

  const id = ++batchId
  batch = {
    runs,
    results: Object.fromEntries(
      setup.modes.map((m) => [
        m.id,
        Object.fromEntries(
          setup.topics.map((t) => [t.id, new Array(runs).fill(null)]),
        ),
      ]),
    ),
  }

  renderResult()
  renderNotes()

  // Run 1 of every topic and mode first, so both modes fill at the same pace.
  const units = []
  for (let i = 0; i < runs; i++) {
    for (const t of setup.topics) {
      for (const m of setup.modes) {
        units.push({ mode: m.id, topic: t.id, i })
      }
    }
  }

  const choice = picker.value()
  let next = 0

  const worker = async () => {
    while (next < units.length && id === batchId) {
      const unit = units[next++]
      let result
      try {
        result = await call('run', {
          topic: unit.topic,
          mode: unit.mode,
          ...choice,
        })
      } catch (error) {
        if (error.missingKey) {
          showError(notice, error)
        }
        result = { error: error.message }
      }

      if (id !== batchId) {
        return
      }

      batch.results[unit.mode][unit.topic][unit.i] = result
      renderResult()

      if (unit.topic === topic.id) {
        document
          .querySelector(`[data-slot="${unit.mode}-${unit.i}"]`)
          ?.replaceChildren(noteCard(unit.mode, unit.i))
      }
    }
  }

  await busy(button, 'Writing…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

button.addEventListener('click', start)
