import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')
const TASKS = setup.tasks.length
const BAR = `${setup.bar} of ${TASKS}`

let runs = setup.defaultRuns
// One batch at a time: { runs, results: { [modeId]: (run | { error } | null)[] } }.
let batch = null
let batchId = 0
// What the tree shows. round null: the last round of the run.
let view = { mode: 'loop', run: 0, round: null }

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const finished = (modeId) =>
  (batch?.results[modeId] ?? []).filter((r) => r && !r.error)
const itemText = (id) => setup.items.find((i) => i.id === id)?.text ?? ''
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const average = (values) => values.reduce((a, b) => a + b, 0) / values.length
const number = (n) => n.toLocaleString('en-US')
/** "a, b and c" */
const listText = (parts) =>
  parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
const KIND = { lookup: 'Find', file: 'New note' }

// ── Before the run: good enough, the modes, the reference folds ────────

document.getElementById('item-count').textContent = String(setup.items.length)
document
  .getElementById('bar')
  .replaceChildren(
    'The tester finds the right place for at least ',
    el('b', {}, BAR),
    ' tasks.',
  )
const finds = setup.tasks.filter((t) => t.kind === 'lookup').length
document.getElementById('tasks-size').textContent =
  `${TASKS} · ${finds} find a note, ${TASKS - finds} file a new note`
document
  .getElementById('tasks')
  .replaceChildren(
    ...setup.tasks.map((t) =>
      el(
        'tr',
        {},
        el('td', {}, el('code', {}, t.id), ` ${KIND[t.kind]}`),
        el('td', {}, t.text),
        el(
          'td',
          { class: 'mx-small' },
          t.kind === 'lookup' ? 'The note of ' : 'A new note next to ',
          el('code', {}, t.item),
          el('span', { class: 'mx-muted' }, ` · ${clip(itemText(t.item), 48)}`),
        ),
      ),
    ),
  )

document.getElementById('runs').replaceChildren(
  ...Array.from({ length: setup.maxRuns }, (_, i) => i + 1).map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === runs),
        onclick: (event) => {
          runs = n
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
          renderEmpty()
        },
      },
      String(n),
    ),
  ),
)
document
  .getElementById('mode-list')
  .replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'stl-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
      ),
    ),
  )

document.getElementById('items-size').textContent =
  `${setup.items.length} items · the designer reads them, the tester does not`
document
  .getElementById('items')
  .replaceChildren(
    ...setup.items.map((i) =>
      el('li', {}, el('code', {}, i.id), el('span', {}, i.text)),
    ),
  )

document
  .getElementById('instructions')
  .replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'Designer, in every mode. The last paragraph defines “good enough”.',
    ),
    codeBlock(setup.instructions.designer),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'Added to the designer instructions in “One shot, self-rated”.',
    ),
    codeBlock(setup.instructions.selfRating),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'Tester. One request answers all tasks. The message holds map.md, the paths and the tasks.',
    ),
    codeBlock(setup.instructions.tester),
  )

function renderEmpty() {
  // One shot: 2 requests. The loop: 2 per round, up to the round limit.
  const low = runs * 6
  const high = runs * (4 + 2 * setup.maxRounds)
  // One run of every mode cost about half a cent with the default model.
  const cents = runs * 0.5

  document.getElementById('empty').textContent =
    `Press Run all modes. ${low} to ${high} requests, ${cents < 1 ? 'under 1 cent' : `about ${cents} cent${cents === 1 ? '' : 's'}`}.`
}
renderEmpty()

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The headline: measured score per mode ──────────────────────────────

/** Two short sentences on what the numbers mean, from this batch: they can also say that the loop did not win. */
function meaning() {
  const once = finished('once').map((r) => r.final)
  const rated = finished('rated').filter((r) => r.selfRating)
  const loop = finished('loop').map((r) => r.final)
  const parts = []

  if (rated.length) {
    const over = rated.filter((r) => r.selfRating.expected > r.final).length
    parts.push(
      over === rated.length
        ? 'The designer rated its own structure higher than the tester measured it, so its own rating is not a check of good enough.'
        : over
          ? 'In some runs the designer rated its own structure too high.'
          : 'The designer did not rate its own structure higher than the tester measured it.',
    )
  }

  if (once.length && loop.length) {
    parts.push(
      average(loop) > average(once)
        ? 'The loop scored higher than the one shot, but on the same tasks that it got as feedback.'
        : 'In these runs the loop did not score higher than the one shot.',
    )
  }

  return parts.join(' ')
}

function sumUsage(list) {
  return list.reduce(
    (t, u) =>
      t
        ? {
            inputTokens: t.inputTokens + u.inputTokens,
            outputTokens: t.outputTokens + u.outputTokens,
            reasoningTokens: t.reasoningTokens + u.reasoningTokens,
            cost: t.cost == null || u.cost == null ? null : t.cost + u.cost,
            costSource:
              t.costSource === 'estimate' || u.costSource === 'estimate'
                ? 'estimate'
                : u.costSource,
          }
        : { ...u },
    null,
  )
}

/** The line under a mode's score: did it reach good enough, and what the self-rated designer said. */
function readoutNotes(m, done) {
  const passed = done.filter((r) => r.passed).length
  const one = done.length === 1 ? done[0] : null

  let status = `${passed} of ${done.length} runs good enough`
  if (one && m.id !== 'loop') {
    status = one.passed ? 'good enough' : 'not good enough'
  } else if (one) {
    status = one.passed
      ? `good enough in round ${one.rounds.length}`
      : `not good enough after ${plural(one.rounds.length, 'round')}`
  }

  const notes = [
    el('span', { class: `stl-note${one?.passed ? ' mx-good' : ''}` }, status),
  ]

  const rated = done.filter((r) => r.selfRating)
  if (rated.length) {
    const ready = rated.filter((r) => r.selfRating.ready).length
    const flag =
      ready === rated.length ? ', ready' : ready === 0 ? ', not ready' : ''
    notes.push(
      el(
        'span',
        { class: 'stl-note' },
        'The designer said ',
        el(
          'span',
          { class: 'stl-claim' },
          `${rated.map((r) => r.selfRating.expected).join(', ')} of ${TASKS}${flag}`,
        ),
      ),
    )
  }

  return notes
}

function renderResult() {
  document.getElementById('verdict').hidden = false
  document.getElementById('verdict-note').textContent =
    `Good enough is ${BAR}. Each mode keeps its last structure that passed the check.`

  document.getElementById('readouts').replaceChildren(
    ...setup.modes.map((m) => {
      const done = finished(m.id)
      const failed = batch.results[m.id].every((r) => r?.error)
      return el(
        'div',
        { class: 'mx-readout' },
        el('span', { class: 'mx-label' }, m.label),
        el(
          'b',
          {},
          done.length
            ? `${done.map((r) => r.final).join(', ')} of ${TASKS}`
            : failed
              ? 'failed'
              : '…',
        ),
        done.length ? readoutNotes(m, done) : null,
      )
    }),
  )

  document.getElementById('meaning').textContent = meaning()

  const all = setup.modes.flatMap((m) => finished(m.id))
  document.getElementById('usage-size').textContent = all.length
    ? `${plural(
        all.reduce((n, r) => n + r.requests, 0),
        'request',
      )} · ${usageText(sumUsage(all.map((r) => r.usage)))}`
    : ''

  document.getElementById('modes').replaceChildren(
    ...setup.modes.map((m) => {
      const done = finished(m.id)
      if (!done.length) {
        return el(
          'tr',
          {},
          el('td', {}, m.label),
          el(
            'td',
            { colspan: '4', class: 'mx-muted' },
            batch.results[m.id].some((r) => r?.error) ? 'failed' : 'running…',
          ),
        )
      }
      return el(
        'tr',
        {},
        el('td', {}, m.label),
        el(
          'td',
          { class: 'stl-mono' },
          done
            .map((r) =>
              r.rounds.map((x) => (x.check.ok ? x.score : '✗')).join(' → '),
            )
            .join(' · '),
        ),
        el(
          'td',
          { class: 'num' },
          String(done.reduce((n, r) => n + r.requests, 0)),
        ),
        el(
          'td',
          { class: 'mx-small' },
          usageText(sumUsage(done.map((r) => r.usage))),
        ),
        el(
          'td',
          { class: 'num' },
          `${(done.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(1)} s`,
        ),
      )
    }),
  )
}

// ── How the structure was built: a mode, a run, a round ────────────────

function renderBuild() {
  document.getElementById('build').hidden = false

  const tab = (label, pressed, onclick) =>
    el(
      'button',
      { type: 'button', 'aria-pressed': String(pressed), onclick },
      label,
    )

  document.getElementById('mode-tabs').replaceChildren(
    ...setup.modes.map((m) =>
      tab(m.label, m.id === view.mode, () => {
        view = { ...view, mode: m.id, round: null }
        renderBuild()
      }),
    ),
  )

  const runTabs = document.getElementById('run-tabs')
  runTabs.hidden = batch.runs === 1
  runTabs.replaceChildren(
    ...Array.from({ length: batch.runs }, (_, i) =>
      tab(`Run ${i + 1}`, i === view.run, () => {
        view = { ...view, run: i, round: null }
        renderBuild()
      }),
    ),
  )

  renderView()
}

/** What the designer changed in this round, in one sentence, from the change marks of its tree. */
function changeSentence(tree) {
  const counts = {}
  let map = false

  const walk = (nodes) =>
    nodes.forEach((n) => {
      if (n.path === 'map.md') {
        map = n.change === 'edited'
      } else if (n.change) {
        counts[`${n.change} ${n.folder ? 'folder' : 'file'}`] =
          (counts[`${n.change} ${n.folder ? 'folder' : 'file'}`] ?? 0) + 1
      }
      walk(n.children)
    })
  walk(tree)

  const VERB = {
    new: 'added',
    renamed: 'renamed',
    moved: 'moved',
    removed: 'removed',
  }
  const parts = [
    'new folder',
    'renamed folder',
    'moved folder',
    'removed folder',
    'moved file',
    'renamed file',
  ]
    .filter((key) => counts[key])
    .map(
      (key) =>
        `${VERB[key.split(' ')[0]]} ${plural(counts[key], key.split(' ')[1])}`,
    )

  if (map) {
    parts.push('edited map.md')
  }

  return parts.length
    ? `The designer ${listText(parts)}.`
    : 'The designer changed nothing.'
}

function folderCount(nodes) {
  return nodes.reduce(
    (n, node) =>
      n + (node.folder && !node.ghost ? 1 : 0) + folderCount(node.children),
    0,
  )
}

/** What happened in round k, in a few short sentences. */
function story(run, k) {
  const round = run.rounds[k]
  const next = run.rounds[k + 1]
  const before = run.rounds.slice(0, k).some((r) => r.structure)
  const lines = []

  if (k === 0 && run.selfRating) {
    lines.push(
      `The designer called it ${run.selfRating.ready ? 'ready' : 'not ready'}: “${run.selfRating.reason}”`,
    )
  }

  if (!round.tree) {
    lines.push(
      'The designer’s output did not match the schema, so there is no structure.',
    )
  } else {
    lines.push(
      before
        ? changeSentence(round.tree)
        : `The designer filed the ${setup.items.length} items in ${plural(folderCount(round.tree), 'folder')}.`,
    )
  }

  if (!round.check.ok) {
    lines.push('The structure failed the check, so the tester did not test it.')
  } else {
    const missed = round.results.filter((r) => !r.hit).length
    lines.push(
      missed
        ? `The tester missed ${plural(missed, 'task')}.`
        : 'The tester found every task.',
    )
  }

  if (next) {
    lines.push(
      round.check.ok
        ? 'The misses went back to the designer.'
        : 'The check errors went back to the designer.',
    )
  } else if (round.check.ok && round.score >= setup.bar) {
    lines.push('That is good enough.')
  } else if (run.mode === 'loop') {
    lines.push(`The loop stops: ${setup.maxRounds} rounds is the limit.`)
    const kept = run.rounds.findLast((r) => r.check.ok)
    if (!round.check.ok && kept) {
      lines.push(`The run keeps the structure of round ${kept.number}.`)
    }
  } else {
    lines.push('This mode does not revise the structure.')
  }

  return lines.join(' ')
}

const SYMBOL = { hit: '✓', answer: '✗', right: '○' }

function markTitle(mark, result) {
  const head = `${result.task.id} · ${KIND[result.task.kind]}: ${result.task.text}`

  if (mark.state === 'hit') {
    return `${head}\nThe tester answered here. Right.`
  }
  if (mark.state === 'right') {
    return `${head}\nThe right place.`
  }

  return `${head}\nThe tester answered ${result.answer}. Wrong: ${result.why}.`
}

function changeText(node, mapDelta) {
  if (node.change === 'new') {
    return 'new'
  }
  if (node.change === 'removed') {
    return 'removed'
  }
  if (node.change === 'edited') {
    return `edited · ${mapDelta < 0 ? '−' : '+'}${number(Math.abs(mapDelta))} characters`
  }
  // A renamed node stays in its folder: its old name is enough.
  if (node.change === 'renamed') {
    return `renamed from ${node.from.replace(/\/$/, '').split('/').pop()}${node.folder ? '/' : ''}`
  }
  if (node.change === 'moved') {
    return `moved from ${node.from}`
  }

  return node.ghost ? 'does not exist' : ''
}

function treeRow(node, ctx) {
  const change = changeText(node, ctx.mapDelta)

  return [
    el(
      'span',
      { class: 'stl-label' },
      el(
        'span',
        {
          class: 'stl-name',
          title: node.item ? `${node.item}: ${itemText(node.item)}` : null,
        },
        node.name,
      ),
      change ? el('span', { class: 'stl-change' }, change) : null,
    ),
    node.marks.length
      ? el(
          'span',
          { class: 'stl-marks' },
          node.marks.map((m) =>
            el(
              'span',
              {
                class: `stl-mark is-${m.state}`,
                'data-task': m.task,
                title: markTitle(m, ctx.results[m.task]),
              },
              `${SYMBOL[m.state]} ${m.task}`,
            ),
          ),
        )
      : null,
  ]
}

/** The folder tree: every folder open, and each one folds. */
function treeList(nodes, ctx, attrs = {}) {
  return el(
    'ul',
    attrs,
    nodes.map((node) => {
      const cls = [
        'stl-row',
        node.folder ? 'is-folder' : 'is-file',
        node.change ? `is-${node.change}` : '',
        node.ghost ? 'is-ghost' : '',
      ].join(' ')

      return el(
        'li',
        {},
        node.children.length
          ? el(
              'details',
              { open: true },
              el('summary', { class: cls }, treeRow(node, ctx)),
              treeList(node.children, ctx),
            )
          : el('div', { class: cls }, treeRow(node, ctx)),
      )
    }),
  )
}

function checksList(round) {
  return el(
    'div',
    { class: 'stl-checks-box' },
    el('span', { class: 'mx-label' }, 'The tester’s checks'),
    el(
      'ol',
      { class: 'stl-checks' },
      round.results.map((r) =>
        el(
          'li',
          { 'data-task': r.task.id },
          el(
            'span',
            { class: r.hit ? 'mx-good' : 'mx-bad' },
            r.hit ? '✓' : '✗',
          ),
          el('code', {}, r.task.id),
          el(
            'span',
            {},
            el('span', { class: 'mx-muted' }, `${KIND[r.task.kind]}: `),
            r.task.text,
            r.hit
              ? null
              : el(
                  'span',
                  { class: 'stl-why' },
                  `${r.why[0].toUpperCase()}${r.why.slice(1)}.`,
                ),
          ),
        ),
      ),
    ),
  )
}

/** Hover a task in the list or in the tree: its marks stand out, the others fade. */
function focusTask(box, task) {
  box.classList.toggle('has-focus', Boolean(task))
  for (const node of box.querySelectorAll('[data-task]')) {
    node.classList.toggle('is-focus', node.dataset.task === task)
  }
}

function roundView(run, k) {
  const round = run.rounds[k]
  const before = run.rounds.slice(0, k).findLast((r) => r.structure)?.structure
  const ctx = {
    results: Object.fromEntries(round.results.map((r) => [r.task.id, r])),
    mapDelta:
      before && round.structure
        ? round.structure.map.length - before.map.length
        : 0,
  }

  const tested = round.results.length > 0
  const box = el(
    'div',
    { class: 'stl-round' },
    el(
      'div',
      { class: 'stl-tree-box' },
      treeList(round.tree, ctx, {
        class: 'stl-tree',
        'aria-label': `Folder tree of round ${round.number}`,
      }),
      tested
        ? el(
            'p',
            { class: 'stl-legend' },
            el(
              'span',
              {},
              el('span', { class: 'stl-mark is-hit' }, '✓'),
              ' the tester answered here, right',
            ),
            el(
              'span',
              {},
              el('span', { class: 'stl-mark is-answer' }, '✗'),
              ' the tester answered here, wrong',
            ),
            el(
              'span',
              {},
              el('span', { class: 'stl-mark is-right' }, '○'),
              ' the right place',
            ),
          )
        : null,
    ),
    tested ? checksList(round) : null,
  )

  box.addEventListener('mouseover', (event) =>
    focusTask(box, event.target.closest('[data-task]')?.dataset.task ?? null),
  )
  box.addEventListener('mouseleave', () => focusTask(box, null))

  return box
}

/** A code block whose long lines wrap. */
function wrapped(text, lang = '') {
  const block = codeBlock(text, lang)
  block.setAttribute('data-wrap', '')
  return block
}

function fold(title, size, ...body) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, title),
      el('span', { class: 'mx-small mx-muted' }, size),
    ),
    el('div', { class: 'mx-stack stl-pad' }, body),
  )
}

function roundFolds(round) {
  const s = round.structure
  const missed = round.results.filter((r) => !r.hit).length

  return [
    s
      ? fold(
          'map.md',
          `${number(s.map.length)} characters · the tester reads it`,
          wrapped(s.map, 'md'),
        )
      : null,
    round.feedback
      ? fold(
          'Feedback to the designer',
          round.check.ok
            ? `${missed} ${missed === 1 ? 'miss' : 'misses'}`
            : plural(round.check.errors.length, 'check error'),
          wrapped(round.feedback, 'md'),
        )
      : null,
    s
      ? fold(
          'Template for new notes',
          `${number(s.template.length)} characters · the tester does not see it`,
          wrapped(s.template, 'md'),
        )
      : null,
    fold(
      'Requests and responses',
      `${round.tester ? 'designer and tester' : 'designer only'} · ${usageText(sumUsage([round.designer.usage, round.tester?.usage].filter(Boolean)))}`,
      el(
        'p',
        { class: 'mx-small' },
        `Designer · ${usageText(round.designer.usage)}`,
      ),
      requestResponse(round.designer.request, round.designer.response),
      round.tester
        ? [
            el(
              'p',
              { class: 'mx-small' },
              `Tester · ${usageText(round.tester.usage)}`,
            ),
            requestResponse(round.tester.request, round.tester.response),
          ]
        : null,
    ),
  ]
}

function renderView() {
  const box = document.getElementById('view')
  const mode = setup.modes.find((m) => m.id === view.mode)
  const run = batch.results[view.mode][view.run]

  if (!run) {
    return box.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        `${mode.label} is running. Its rounds show when the run ends.`,
      ),
    )
  }

  if (run.error) {
    return box.replaceChildren(
      el('p', { class: 'mx-bad' }, `This run failed: ${run.error}`),
    )
  }

  const k = view.round ?? run.rounds.length - 1
  const round = run.rounds[k]

  // Rounds in order, one button each, with arrows: the structure was built in this sequence.
  const steps = run.rounds.flatMap((r, i) => [
    i ? el('span', { class: 'stl-arrow', 'aria-hidden': 'true' }, '→') : null,
    el(
      'div',
      { class: 'mx-seg stl-tabs' },
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(i === k),
          onclick: () => {
            view = { ...view, round: i }
            renderView()
          },
        },
        `Round ${r.number} · ${r.check.ok ? `${r.score} of ${TASKS}${r.score >= setup.bar ? ' ✓' : ''}` : 'not tested'}`,
      ),
    ),
  ])

  // replaceChildren() prints null as "null": drop the parts this round does not have.
  box.replaceChildren(
    ...[
      el(
        'div',
        { class: 'stl-steps', role: 'group', 'aria-label': 'Round' },
        steps,
      ),
      el('p', { class: 'stl-story' }, story(run, k)),
      round.check.ok
        ? null
        : el(
            'ul',
            { class: 'stl-errors mx-small mx-bad' },
            round.check.errors.map((e) => el('li', {}, e)),
          ),
      round.tree ? roundView(run, k) : null,
      ...roundFolds(round),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `This run: ${plural(run.requests, 'request')} · ${usageText(run.usage)} · ${(run.ms / 1000).toFixed(1)} s · ${run.model}`,
      ),
    ].filter(Boolean),
  )
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
    runs,
    results: Object.fromEntries(
      setup.modes.map((m) => [m.id, new Array(runs).fill(null)]),
    ),
  }

  view = { mode: view.mode, run: 0, round: null }
  renderResult()
  renderBuild()

  // Run 1 of every mode first, so the modes fill at the same pace.
  const units = []
  for (let i = 0; i < runs; i++) {
    for (const m of setup.modes) {
      units.push({ mode: m.id, i })
    }
  }

  const input = picker.value()
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

      // Only the run on screen is drawn again, so folds that are open elsewhere stay open.
      if (unit.mode === view.mode && unit.i === view.run) {
        renderView()
      }
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

button.addEventListener('click', start)
