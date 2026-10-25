import {
  busy,
  call,
  codeBlock,
  debounce,
  el,
  formatCost,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')
const seedInput = document.getElementById('seed')
const headline = document.getElementById('headline')

// Three pictures per task by default: 42 requests show the effect for about half a cent.
let perTask = 3
let pictures = []
// One batch at a time: { results: { [modeId]: (run | { error } | null)[] } }, one slot per picture.
let batch = null
let batchId = 0
// Per task: the index of the picture shown at full size, if any.
const zoomed = {}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const shown = (value) =>
  value == null
    ? '—'
    : Array.isArray(value)
      ? value.join(', ') || 'none'
      : String(value)
const indexes = (taskId) =>
  pictures.flatMap((p, i) => (p.task === taskId ? [i] : []))

// ── Settings ───────────────────────────────────────────────────────────

document.getElementById('count').replaceChildren(
  ...Array.from({ length: setup.maxPerTask }, (_, i) => i + 1).map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === perTask),
        onclick: (event) => {
          perTask = n
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
          void loadPictures()
        },
      },
      String(n),
    ),
  ),
)

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

function readSeed() {
  const seed = Number(seedInput.value)
  return Number.isInteger(seed) && seed >= 1 && seed <= setup.maxSeed
    ? seed
    : null
}

// Drawing the pictures is local: no request to a model.
async function loadPictures() {
  const seed = readSeed()
  if (seed === null) {
    return showError(
      notice,
      new Error(`The seed must be a whole number from 1 to ${setup.maxSeed}.`),
    )
  }

  showError(notice, null)
  batchId++
  batch = null

  pictures = await call('pictures', { seed, perTask })

  for (const id of Object.keys(zoomed)) {
    delete zoomed[id]
  }

  document.getElementById('result').hidden = true

  // Measured with the default model on OpenAI: about 0.015 cents per request.
  headline.replaceChildren(
    el(
      'p',
      { class: 'mx-muted' },
      `Press Run. ${plural(pictures.length * setup.modes.length, 'request')}, under 1 cent.`,
    ),
  )
  document.getElementById('cards').replaceChildren(...setup.tasks.map(card))
  renderQuestions()
}

seedInput.addEventListener(
  'input',
  debounce(() => void loadPictures(), 300),
)

// ── Results: the headline, then right values per task ──────────────────

const finished = (modeId) =>
  (batch?.results[modeId] ?? []).flatMap((run, i) =>
    run && !run.error ? [[run, i]] : [],
  )

function summary(modeId) {
  const done = finished(modeId)
  const sum = (pick) => done.reduce((n, [run]) => n + pick(run), 0)
  const perTask = (pick) =>
    Object.fromEntries(
      setup.tasks.map((t) => [
        t.id,
        sum((run) => (run.task === t.id ? pick(run.checks) : 0)),
      ]),
    )

  const costs = done.map(([run]) => run.usage.cost)

  return {
    n: done.length,
    right: perTask((checks) => checks.filter((c) => c.ok).length),
    total: perTask((checks) => checks.length),
    tokens: done.length
      ? Math.round(sum((run) => run.usage.inputTokens) / done.length)
      : null,
    cost: costs.some((c) => c == null)
      ? null
      : costs.reduce((a, b) => a + b, 0),
    estimate: done.some(([run]) => run.usage.costSource === 'estimate'),
    ms: done.length ? sum((run) => run.ms) / done.length : null,
  }
}

const allOf = (s, field) => setup.tasks.reduce((n, t) => n + s[field][t.id], 0)

/** The finding in plain words: right values per detail, then the tasks wrong at both. Shown when every request is back. */
function renderHeadline(s) {
  const slots = setup.modes.flatMap((m) => batch.results[m.id])
  const back = slots.filter(Boolean).length

  if (back < slots.length) {
    return headline.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        `Running: ${back} of ${plural(slots.length, 'request')} back.`,
      ),
    )
  }

  const modes = setup.modes.filter((m) => s[m.id].n)
  if (!modes.length) {
    return headline.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('p', {}, 'Every request failed. Each task below shows the error.'),
      ),
    )
  }

  const right = modes
    .map(
      (m) =>
        `${allOf(s[m.id], 'right')} of ${allOf(s[m.id], 'total')} values right at ${m.label.toLowerCase()}`,
    )
    .join(' and ')
  const wrong = modes.map((m) =>
    setup.tasks
      .filter((t) => s[m.id].right[t.id] < s[m.id].total[t.id])
      .map((t) => t.name),
  )
  const where = modes
    .map(
      (m, i) =>
        `${i ? 'At' : 'Wrong values at'} ${m.label.toLowerCase()}: ${wrong[i].join(', ') || 'none'}.`,
    )
    .join(' ')

  headline.replaceChildren(
    el(
      'div',
      { class: 'mx-callout' },
      el('span', { class: 'mx-label' }, 'Result'),
      el('p', {}, `The model got ${right}.`),
      el(
        'p',
        {},
        wrong.flat().length
          ? where
          : 'Every value was right. Try another seed, or more pictures per task.',
      ),
    ),
  )
}

function renderResult() {
  const s = Object.fromEntries(setup.modes.map((m) => [m.id, summary(m.id)]))
  const of = (n, total) => (total ? `${n} of ${total}` : '…')

  const rows = [
    ...setup.tasks.map((t) => [
      t.name,
      (x) => [
        of(x.right[t.id], x.total[t.id]),
        x.total[t.id] && x.right[t.id] === x.total[t.id] ? 'mx-good' : '',
      ],
    ]),
    [
      'Input tokens per picture',
      (x) => [x.tokens === null ? '…' : x.tokens.toLocaleString('en-US'), ''],
    ],
    [
      'Cost',
      (x) => [
        x.n ? `${formatCost(x.cost)}${x.estimate ? ' est.' : ''}` : '…',
        '',
      ],
    ],
    [
      'Time per request',
      (x) => [x.ms === null ? '…' : `${(x.ms / 1000).toFixed(1)} s`, ''],
    ],
  ]

  document.getElementById('result').hidden = false
  document
    .getElementById('sum-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Right values'),
        ...setup.modes.map((m) => el('th', { class: 'num' }, m.label)),
      ),
    )
  document.getElementById('sum-body').replaceChildren(
    ...rows.map(([label, cellOf]) =>
      el(
        'tr',
        {},
        el('td', {}, label),
        ...setup.modes.map((m) => {
          const [text, cls] = cellOf(s[m.id])
          return el('td', { class: `num ${cls}` }, text)
        }),
      ),
    ),
  )

  renderHeadline(s)

  const all = setup.modes.flatMap((m) => finished(m.id)).map(([run]) => run)
  document.getElementById('total').textContent = all.length
    ? `${plural(all.length, 'request')} · ${all[0].provider} · ${all[0].model}`
    : ''
}

// ── Tasks: each picture, its key and the answer at each detail ─────────

function answerCell(field, run) {
  if (!run) {
    return el('td', { class: 'mx-muted' }, batch ? '…' : '')
  }

  if (run.error) {
    return el('td', { class: 'mx-bad', title: run.error }, 'failed')
  }

  const check = run.checks.find((c) => c.field === field.id)
  if (check.got === null) {
    return el('td', { class: 'mx-bad', title: run.problem ?? '' }, '—')
  }

  return el(
    'td',
    { class: `idp-value ${check.ok ? '' : 'mx-bad'}` },
    shown(check.got),
  )
}

function thumb(task, i) {
  const p = pictures[i]
  const open = zoomed[task.id] === i

  return el(
    'button',
    {
      type: 'button',
      class: 'idp-thumb',
      'aria-pressed': String(open),
      title: open ? 'Show it small again' : 'Show it at full size',
      onclick: () => {
        zoomed[task.id] = open ? undefined : i
        renderCard(task)
      },
    },
    el('img', {
      src: p.image,
      alt: `${task.name}, picture ${p.number}. ${p.question}`,
      width: String(setup.size),
      height: String(setup.size),
    }),
  )
}

function table(task) {
  const list = indexes(task.id)
  const width = 1 + list.length
  const runs = (m) => list.map((i) => batch?.results[m.id][i] ?? null)

  const rows = task.fields.flatMap((f) => [
    // A heading row per value, when the task asks for more than one.
    ...(task.fields.length > 1
      ? [
          el(
            'tr',
            { class: 'idp-group' },
            el('th', { colspan: String(width), scope: 'colgroup' }, f.label),
          ),
        ]
      : []),
    el(
      'tr',
      {},
      el('td', {}, 'Key'),
      ...list.map((i) =>
        el('td', { class: 'idp-value' }, shown(pictures[i].key[f.id])),
      ),
    ),
    ...setup.modes.map((m) =>
      el(
        'tr',
        {},
        el('td', {}, m.label),
        ...runs(m).map((run) => answerCell(f, run)),
      ),
    ),
  ])

  return el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table idp-answers' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, ''),
          ...list.map((i) =>
            el(
              'th',
              { class: 'idp-pic' },
              thumb(task, i),
              el('span', { class: 'idp-note' }, pictures[i].note),
            ),
          ),
        ),
      ),
      el('tbody', {}, rows),
    ),
  )
}

function problems(task) {
  return indexes(task.id).flatMap((i) =>
    setup.modes.flatMap((m) => {
      const run = batch?.results[m.id][i]
      const why = run?.error ?? run?.problem
      return why
        ? [
            el(
              'p',
              { class: 'mx-small mx-bad' },
              `Picture ${pictures[i].number}, ${m.label.toLowerCase()}: ${why}`,
            ),
          ]
        : []
    }),
  )
}

function requestsFold(task) {
  const done = indexes(task.id).flatMap((i) =>
    setup.modes.flatMap((m) => {
      const run = batch?.results[m.id][i]
      return run && !run.error ? [[pictures[i], m, run]] : []
    }),
  )

  if (!done.length) {
    return null
  }

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Requests and responses · ${done.length}`,
      ),
    ),
    el(
      'div',
      { class: 'mx-stack idp-pad' },
      done.map(([p, m, run]) =>
        el(
          'div',
          { class: 'mx-stack' },
          el(
            'div',
            { class: 'mx-spread' },
            el(
              'b',
              { class: 'mx-small' },
              `Picture ${p.number} · ${m.label.toLowerCase()}`,
            ),
            el('span', { class: 'mx-small mx-muted' }, usageText(run.usage)),
          ),
          requestResponse(run.request, run.response),
        ),
      ),
    ),
  )
}

function zoom(task) {
  const i = zoomed[task.id]
  if (i === undefined) {
    return null
  }

  const p = pictures[i]
  return el(
    'figure',
    { class: 'idp-zoom' },
    el('img', {
      src: p.image,
      alt: `${task.name}, picture ${p.number}, at full size.`,
      width: String(setup.size),
      height: String(setup.size),
    }),
    el(
      'figcaption',
      { class: 'mx-small mx-muted' },
      `Picture ${p.number} at full size: ${setup.size} × ${setup.size} pixels. Both requests send this PNG.`,
    ),
  )
}

function body(task) {
  return [
    zoom(task),
    table(task),
    ...problems(task),
    requestsFold(task),
  ].filter(Boolean)
}

function card(task) {
  return el(
    'article',
    { class: 'mx-panel idp-card', 'data-task': task.id },
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, task.name),
      el('p', {}, task.short),
    ),
    el('div', { class: 'mx-stack', 'data-slot': 'body' }, body(task)),
  )
}

// Only the body of one card changes, so folds in other cards stay open.
function renderCard(task) {
  const node = document.querySelector(`[data-task="${task.id}"]`)
  node.classList.toggle('idp-wide', zoomed[task.id] !== undefined)
  node.querySelector('[data-slot="body"]').replaceChildren(...body(task))
}

function renderQuestions() {
  document.getElementById('questions').replaceChildren(
    ...setup.tasks.map((t) => {
      // The question wraps instead of scrolling sideways.
      const question = codeBlock(pictures[indexes(t.id)[0]].question)
      question.setAttribute('data-wrap', '')

      return el(
        'div',
        { class: 'mx-stack' },
        el('b', { class: 'mx-small' }, t.name),
        question,
        codeBlock(prettyJson(setup.schemas[t.id]), 'json'),
      )
    }),
  )
}

// ── Running: every picture at both details, at most 6 requests at a time ─

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const seed = readSeed()
  if (seed === null) {
    return showError(
      notice,
      new Error(`The seed must be a whole number from 1 to ${setup.maxSeed}.`),
    )
  }

  showError(notice, null)
  const id = ++batchId
  batch = {
    results: Object.fromEntries(
      setup.modes.map((m) => [m.id, new Array(pictures.length).fill(null)]),
    ),
  }

  renderResult()
  setup.tasks.forEach(renderCard)

  // Both details of a picture one after the other, so the cards fill in order.
  const units = pictures.flatMap((p, i) =>
    setup.modes.map((m) => ({ p, i, mode: m.id })),
  )

  const input = { seed, ...picker.value() }
  let next = 0
  const worker = async () => {
    while (next < units.length && id === batchId) {
      const { p, i, mode } = units[next++]
      let result
      try {
        result = await call('run', {
          ...input,
          task: p.task,
          number: p.number,
          mode,
        })
      } catch (error) {
        if (error.missingKey || error.restart) {
          showError(notice, error)
        }
        result = { error: error.message }
      }

      if (id !== batchId) {
        return
      }

      batch.results[mode][i] = result
      renderResult()
      renderCard(setup.tasks.find((t) => t.id === p.task))
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 6 }, worker)),
  )
}

button.addEventListener('click', start)
await loadPictures()
