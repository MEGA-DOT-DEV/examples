import {
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const PRESETS = [
  [
    'Pagination docs',
    "Search the docs for 'pagination' and summarize the first two pages you find.",
  ],
  [
    'Open invoices',
    'List the open invoices and draft a short payment reminder email to each customer contact.',
  ],
  [
    'Top page',
    'Which page got the most views, and what does its docs page say? Two sentences.',
  ],
  ['Who am I?', 'Who am I?'],
]

const taskBox = document.getElementById('task')
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')
let setup = null
// One entry per mode: its steps, its state, its column on the page.
let runs = {}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const n = (value) => Number(value).toLocaleString('en-US')

// Long lines (a docs page, a signature) wrap instead of scrolling sideways.
function wrapped(block) {
  block.setAttribute('data-wrap', '')
  return block
}

// The text shown for a result: pretty JSON when it is JSON.
function pretty(text) {
  try {
    return { text: prettyJson(JSON.parse(text)), lang: 'json' }
  } catch {
    return { text, lang: '' }
  }
}

// A tool result, folded: the summary says how much is inside. An error stays open.
function resultView(c) {
  const shown =
    c.name === 'find' ? { text: c.output, lang: 'ts' } : pretty(c.output)
  const block = wrapped(codeBlock(shown.text, shown.lang))

  if (c.error) {
    return [
      el(
        'span',
        { class: 'mx-label mx-bad' },
        'Tool error, sent back to the model',
      ),
      block,
    ]
  }

  const signatures =
    c.name === 'find' ? (c.output.match(/^api\./gm) ?? []).length : 0
  const size = signatures
    ? plural(signatures, 'signature')
    : plural(shown.text.split('\n').length, 'line')

  return [
    el(
      'details',
      { class: 'mx-details cm-result' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Tool result'),
        el('span', { class: 'mx-small mx-muted' }, size),
      ),
      block,
    ),
  ]
}

function callView(c) {
  const head = el(
    'div',
    { class: 'cm-call-head' },
    el('span', { class: 'cm-arrow', 'aria-hidden': 'true' }, '→'),
    el('code', { class: 'cm-call-name' }, c.name),
    c.name === 'execute'
      ? el('span', { class: 'mx-small mx-muted' }, 'the code the model wrote')
      : el('code', { class: 'cm-call-args' }, c.arguments || '{}'),
  )

  const code =
    c.name === 'execute'
      ? wrapped(codeBlock(String(c.args?.code ?? c.arguments), 'js'))
      : null

  return el(
    'div',
    { class: `cm-call${c.error ? ' is-error' : ''}` },
    head,
    code,
    ...resultView(c),
  )
}

function stepView(step, end, stopText) {
  const answer = end === 'answer'

  return el(
    'li',
    { class: `cm-step${answer ? ' is-end' : ''}` },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label cm-step-title' },
        `Step ${step.number} · ${answer ? 'text answer, the loop ends' : plural(step.calls.length, 'tool call')}`,
      ),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${step.ms} ms · ${usageText(step.usage)}`,
      ),
    ),
    ...step.calls.map(callView),
    step.status === 'incomplete'
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          'The reply reached max_output_tokens and was cut.',
        )
      : null,
    end === 'step_limit'
      ? el(
          'div',
          { class: 'mx-callout mx-callout--warn' },
          el('span', { class: 'mx-label' }, 'Step limit'),
          el('p', {}, stopText),
        )
      : null,
    el(
      'details',
      { class: 'mx-details cm-raw' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: 'mx-label' },
          `Request and response · step ${step.number}`,
        ),
      ),
      requestResponse(step.request, step.response),
    ),
  )
}

/** The totals of one mode's steps so far. */
function totals(run) {
  const steps = run?.steps ?? []
  const sum = (key) => steps.reduce((t, s) => t + s.usage[key], 0)
  const costs = steps.map((s) => s.usage.cost)
  const cost =
    !steps.length || costs.includes(null)
      ? null
      : costs.reduce((a, b) => a + b, 0)
  const est = steps.some((s) => s.usage.costSource === 'estimate')
    ? ' est.'
    : ''

  return {
    steps: steps.length,
    input: sum('inputTokens'),
    output: sum('outputTokens'),
    cost,
    est,
    ms: steps.reduce((t, s) => t + s.ms, 0),
  }
}

const costText = (t) =>
  t.cost === null ? 'unknown cost' : `${formatCost(t.cost)}${t.est}`

function renderCompare() {
  const rows = setup.modes.map((m) => {
    const run = runs[m.id]
    const t = totals(run)
    const state = !run
      ? ''
      : run.state === 'running'
        ? ' · running'
        : run.state === 'failed'
          ? ' · failed'
          : ''
    const cell = (text) => el('td', { class: 'num' }, t.steps ? text : '—')

    return el(
      'tr',
      {},
      el(
        'td',
        {},
        el('b', {}, m.name),
        el('span', { class: 'mx-muted mx-small' }, state),
      ),
      el(
        'td',
        {
          class: 'num',
          title: `${m.toolChars} characters of tool definitions in each request`,
        },
        String(m.toolCount),
      ),
      cell(String(t.steps)),
      cell(n(t.input)),
      cell(n(t.output)),
      cell(costText(t)),
      cell(`${(t.ms / 1000).toFixed(1)} s`),
    )
  })

  document.getElementById('compare').replaceChildren(...rows)
}

/** The headline: how the two modes compare, in one sentence each, from this run. */
function renderHeadline(split) {
  const [code, fn] = setup.modes.map((m) => ({
    name: m.name,
    run: runs[m.id],
    t: totals(runs[m.id]),
  }))

  const lines = []
  for (const mode of [code, fn]) {
    if (mode.run.state === 'failed') {
      lines.push(`${mode.name} failed. The error is under Steps.`)
    } else if (mode.run.end === 'step_limit') {
      lines.push(
        `${mode.name} reached the step limit of ${setup.maxSteps} before it answered.`,
      )
    }
  }

  if (code.run.state === 'done' && fn.run.state === 'done') {
    for (const mode of [fn, code]) {
      lines.push(
        `${mode.name} used ${n(mode.t.input)} input tokens and cost ${costText(mode.t).replace(/ est\.$/, ' (estimate)')}.`,
      )
    }

    const [more, less] = fn.t.input >= code.t.input ? [fn, code] : [code, fn]
    if (less.t.input) {
      lines.push(
        `${more.name} used ${(more.t.input / less.t.input).toFixed(1)}× the input tokens of ${less.name.toLowerCase()}.`,
      )
    }
  }

  const fs = split?.functions?.split
  if (fs) {
    lines.push(
      `Function calling spent ${n(fs.schemas)} of its ${n(fs.total)} input tokens on tool schemas.`,
    )
  }

  headline.replaceChildren(
    el(
      'div',
      { class: 'mx-callout' },
      el('span', { class: 'mx-label' }, 'Result'),
      el('p', {}, lines.join(' ')),
    ),
  )
}

function renderAnswers() {
  document.getElementById('answers').replaceChildren(
    ...setup.modes.map((m) => {
      const run = runs[m.id]
      const last = run.steps.at(-1)
      const body =
        run.state === 'failed'
          ? el('p', { class: 'mx-small mx-bad' }, 'No answer: the run failed.')
          : run.end === 'answer'
            ? modelText(last.text || '(no text)', 'mx-output cm-answer')
            : el(
                'p',
                { class: 'mx-small mx-bad' },
                `No answer: the step limit of ${setup.maxSteps} stopped the loop.`,
              )

      return el(
        'div',
        { class: 'mx-stack cm-answer-cell' },
        el('b', {}, m.name),
        body,
      )
    }),
  )

  document.getElementById('answers-box').hidden = false
}

function column(mode) {
  const list = el('ol', { class: 'cm-steps' })
  const error = el('div')

  const node = el(
    'section',
    { class: 'mx-panel cm-run mx-stack' },
    el('span', { class: 'mx-h3' }, mode.name),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Tool schemas in each request'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${plural(mode.toolCount, 'tool')} · ${n(mode.toolChars)} characters`,
        ),
      ),
      codeBlock(prettyJson(mode.tools), 'json'),
    ),
    list,
    error,
  )

  return { node, list, error }
}

/** One mode: call step() until the model answers or the limit is reached. */
async function runMode(mode, task, provider) {
  const run = runs[mode.id]
  const items = []

  try {
    for (let number = 1; number <= setup.maxSteps; number++) {
      const pending = el(
        'li',
        { class: 'cm-step is-pending' },
        el(
          'span',
          { class: 'mx-label' },
          `Step ${number} · waiting for the model…`,
        ),
      )
      run.view.list.append(pending)

      let result
      try {
        result = await call('step', {
          mode: mode.id,
          task,
          items,
          number,
          ...provider,
        })
      } catch (error) {
        pending.remove()
        run.state = 'failed'
        showError(run.view.error, error)
        return
      }

      run.steps.push(result.step)
      run.tokens.push({
        inputTokens: result.step.usage.inputTokens,
        findTokens: result.findTokens,
      })
      items.push(...result.added)
      pending.replaceWith(stepView(result.step, result.end, result.stopText))
      renderCompare()

      if (result.end) {
        run.end = result.end
        break
      }
    }

    run.state = 'done'
  } finally {
    renderCompare()
  }
}

async function runBoth() {
  const task = taskBox.value.trim()
  if (!task) {
    return showError(notice, new Error('Type a task first.'))
  }
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const provider = picker.value()
  runs = {}

  const box = document.getElementById('runs')
  box.replaceChildren()
  for (const mode of setup.modes) {
    runs[mode.id] = {
      steps: [],
      tokens: [],
      state: 'running',
      end: null,
      view: column(mode),
    }
    box.append(runs[mode.id].view.node)
  }

  renderCompare()

  headline.replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'Both modes run at the same time. The result shows when both finish.',
    ),
  )

  for (const id of ['answers-box', 'split-box']) {
    document.getElementById(id).hidden = true
  }
  for (const id of ['compare-box', 'steps-box']) {
    document.getElementById(id).hidden = false
  }

  runButton.disabled = true

  // Both modes at once. A failure shows in its own column.
  await Promise.all(setup.modes.map((mode) => runMode(mode, task, provider)))

  renderHeadline(null)
  renderAnswers()
  renderHeadline(await renderSplit(provider))
  runButton.disabled = false
}

// ── Where the input tokens go ──────────────────────────────────────────

const PARTS = [
  ['schemas', 'Tool schemas'],
  ['specs', 'Signatures from find'],
  ['rest', 'The rest'],
]

/** Splits each finished run's input tokens, then draws the bars on one scale. Returns the splits. */
async function renderSplit(provider) {
  const done = setup.modes.filter(
    (m) => runs[m.id]?.state === 'done' && runs[m.id].tokens.length,
  )
  if (!done.length) {
    return null
  }

  let results
  try {
    results = await Promise.all(
      done.map((m) =>
        call('inputSplit', {
          mode: m.id,
          steps: runs[m.id].tokens,
          ...provider,
        }),
      ),
    )
  } catch (error) {
    document.getElementById('split-box').hidden = false
    document.getElementById('split').replaceChildren()
    showError(document.getElementById('split'), error)
    return null
  }

  const splits = Object.fromEntries(done.map((m, i) => [m.id, results[i]]))
  const scale = Math.max(...results.map((r) => r.split.total)) || 1

  document.getElementById('split').replaceChildren(
    ...done.map((m) => {
      const s = splits[m.id].split
      const detail = {
        schemas: `(${n(s.schemasPerRequest)} × ${s.requests} requests)`,
        specs: '(estimate)',
        rest: null,
      }

      return el(
        'div',
        { class: 'cm-split-row' },
        el(
          'div',
          { class: 'cm-split-head' },
          el('b', {}, m.name),
          el('span', { class: 'mx-muted' }, `${n(s.total)} input tokens`),
        ),
        el(
          'div',
          {
            class: 'cm-bar',
            role: 'img',
            'aria-label': PARTS.map(([k, label]) => `${label} ${s[k]}`).join(
              ', ',
            ),
          },
          ...PARTS.map(([k]) =>
            el('span', {
              class: `cm-part--${k}`,
              style: { width: `${(s[k] / scale) * 100}%` },
            }),
          ),
        ),
        el(
          'ul',
          { class: 'cm-legend' },
          ...PARTS.filter(([k]) => k !== 'specs' || m.id === 'code').map(
            ([k, label]) =>
              el(
                'li',
                {},
                el('i', { class: `cm-part--${k}` }),
                label,
                el('b', {}, n(s[k])),
                detail[k] ? el('span', { class: 'mx-muted' }, detail[k]) : null,
              ),
          ),
        ),
      )
    }),
  )

  renderHow(splits)
  document.getElementById('split-box').hidden = false

  return splits
}

function renderHow(splits) {
  const measures = Object.values(splits).map((r) => r.measure)
  // The request without tools is shared by both modes: count it once.
  const usages = [measures[0].usage[0], ...measures.map((m) => m.usage[1])]
  const cost = usages.reduce(
    (t, u) => (t === null || u.cost == null ? null : t + u.cost),
    0,
  )
  const est = usages.some((u) => u.costSource === 'estimate') ? ' est.' : ''

  document.getElementById('split-how-size').textContent =
    `· ${usages.length} small requests${cost == null ? '' : `, ${formatCost(cost)}${est}`}`

  document.getElementById('split-how-body').replaceChildren(
    el(
      'p',
      { class: 'mx-small' },
      el('b', {}, 'Tool schemas: measured. '),
      'The same small request goes out once without tools and once with the tools of each mode. The difference in input tokens is what the provider counts for the schemas. The provider sends the schemas in a shorter form than their JSON, so this count is lower than a count of the JSON. It is measured once per provider and model.',
    ),
    ...setup.modes
      .filter((m) => splits[m.id])
      .map((m) => {
        const [without, withTools] = splits[m.id].measure.usage

        return el(
          'p',
          { class: 'mx-small mx-muted' },
          `${m.name}: ${n(withTools.inputTokens)} input tokens with the tools, ${n(without.inputTokens)} without, so ${n(splits[m.id].split.schemasPerRequest)} per request.`,
        )
      }),
    el(
      'p',
      { class: 'mx-small' },
      el('b', {}, 'Signatures from find: estimated. '),
      'The tokens of each find result, counted with the o200k tokenizer, once for each later request that carried it.',
    ),
    el(
      'p',
      { class: 'mx-small' },
      el('b', {}, 'The rest: '),
      'the instructions, the task, the code the model wrote and the other tool results. It is the total from the API minus the two parts above.',
    ),
  )
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

setup = await call('setup')
taskBox.value = setup.task
document
  .getElementById('signatures')
  .replaceChildren(codeBlock(setup.signatures, 'ts'))

document.getElementById('presets').append(
  ...PRESETS.map(([label, text]) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        title: text,
        onclick: () => {
          taskBox.value = text
          taskBox.focus()
        },
      },
      label,
    ),
  ),
)
runButton.addEventListener('click', runBoth)
taskBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!runButton.disabled) {
      runBoth()
    }
  }
})
