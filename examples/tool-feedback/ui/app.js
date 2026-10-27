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

const notice = document.getElementById('notice')
const runButton = document.getElementById('run')
const outageBox = document.getElementById('outage')

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// The latest run of each mode, by mode id.
const runs = new Map()

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const number = (n) => n.toLocaleString('en-US')
const list = (parts) =>
  parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0]

// ── The run loop: one step() call per request ──────────────────────────

async function runOne(mode, settings) {
  const run = {
    mode,
    steps: [],
    items: [],
    runId: null,
    state: 'running',
    end: null,
    summary: '',
    correct: null,
    error: null,
  }
  // One fold per mode. It stays the same element, so it stays open while the run goes on.
  run.trace = el('ol', { class: 'tf-trace' })
  run.foldCount = el('span', { class: 'mx-small mx-muted' })
  run.fold = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, mode.label),
      run.foldCount,
    ),
    el('div', { class: 'tf-pad' }, run.trace),
  )
  runs.set(mode.id, run)
  render()
  try {
    for (let n = 1; n <= setup.maxSteps; n++) {
      const result = await call('step', {
        mode: mode.id,
        number: n,
        runId: run.runId,
        items: run.items,
        outage: settings.outage,
        ...settings.provider,
      })
      run.runId = result.runId
      run.steps.push(result.step)
      run.items.push(...result.added)
      if (result.end) {
        Object.assign(run, {
          state: 'done',
          end: result.end,
          summary: result.summary,
          correct: result.correct,
        })
      }
      render()
      if (result.end) {
        break
      }
    }
  } catch (error) {
    run.state = 'failed'
    run.error = error
    showError(notice, error)
    render()
  }
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  showError(notice, null)
  runs.clear()
  const settings = { outage: outageBox.checked, provider: picker.value() }
  runButton.disabled = true
  try {
    // All modes run side by side; each row fills as its requests finish.
    await Promise.all(setup.modes.map((m) => runOne(m, settings)))
  } finally {
    runButton.disabled = false
  }
}

// ── Numbers from the runs ──────────────────────────────────────────────

function totalUsage(steps) {
  const sum = (key) => steps.reduce((n, s) => n + s.usage[key], 0)
  const costs = steps.map((s) => s.usage.cost)
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    reasoningTokens: sum('reasoningTokens'),
    cost: costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0),
    costSource: steps.some((s) => s.usage.costSource === 'estimate')
      ? 'estimate'
      : 'provider',
  }
}

function headline() {
  const done = [...runs.values()]
  if (!done.length || done.some((r) => r.state === 'running')) {
    return null
  }
  if (done.every((r) => r.state === 'failed')) {
    return null
  }
  const correct = done.filter((r) => r.correct)
  const total = `${number(setup.expected.total)} USD`
  const first = correct.length
    ? `${correct.length} of ${done.length} modes found the correct total of ${total}: ${list(correct.map((r) => r.mode.label))}.`
    : `No mode found the correct total of ${total}.`
  let second = ''
  if (done.every((r) => r.end === 'system_error')) {
    second =
      ' A system error stopped every mode at the first tool call, because the model cannot fix it.'
  } else {
    // A saved result: each later request would send it again if it went inline.
    const saved = done.flatMap((r) =>
      r.steps.flatMap((s) =>
        s.calls
          .filter((c) => c.offload)
          .map((c) => ({
            ...c.offload,
            later: r.steps.length - s.number,
            mode: r.mode.label,
          })),
      ),
    )
    if (saved.length) {
      const extra = saved.reduce((n, o) => n + o.tokens * o.later, 0)
      second = ` ${saved[0].mode} saved the ${number(Math.round(saved[0].bytes / 1000))} KB export to a file. Sent inline, it would add ${number(extra)} input tokens to the later requests.`
    }
  }
  return el(
    'div',
    { class: `mx-callout${correct.length ? '' : ' mx-callout--warn'}` },
    el('p', {}, first + second),
  )
}

// ── The table ──────────────────────────────────────────────────────────

function resultCell(run) {
  if (run.state === 'running') {
    return el(
      'span',
      { class: 'mx-muted tf-running' },
      `request ${run.steps.length + 1}…`,
    )
  }
  if (run.state === 'failed') {
    return el('span', { class: 'mx-bad' }, 'request failed')
  }
  if (run.correct) {
    return el('span', { class: 'mx-good' }, '✓ correct')
  }
  return el(
    'span',
    { class: 'mx-bad' },
    run.end === 'answer' ? '✗ wrong' : '✗ no answer',
  )
}

// What happened, then the answer or the error that the user saw. Every answer stays open.
function happenedCell(run) {
  if (run.state === 'failed') {
    return run.error.message
  }
  if (run.state === 'running') {
    return ''
  }
  // The stopped call holds the error that the user saw in place of an answer.
  const stop = run.steps.at(-1).calls.find((c) => c.kind === 'stopped')
  return [
    el('div', {}, run.summary),
    stop
      ? el(
          'div',
          { class: 'mx-small mx-muted' },
          `Error shown to the user: ${stop.output}`,
        )
      : el(
          'div',
          { class: 'tf-answer-cell mx-small mx-muted' },
          'Answer: ',
          modelText(run.steps.at(-1).text || '(no text)', 'mx-small mx-muted'),
        ),
  ]
}

function totalCell(usage) {
  return [
    el(
      'div',
      {},
      `${number(usage.inputTokens)} in · ${number(usage.outputTokens)} out`,
    ),
    usage.cost == null
      ? null
      : el(
          'div',
          { class: 'mx-small mx-muted' },
          `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`,
        ),
  ]
}

function render() {
  const all = [...runs.values()]
  document.getElementById('empty').hidden = all.length > 0
  document.getElementById('table').hidden = !all.length
  document
    .getElementById('headline')
    .replaceChildren(...[headline()].filter(Boolean))
  document
    .getElementById('rows')
    .replaceChildren(
      ...all.map((run) =>
        el(
          'tr',
          {},
          el('td', { class: 'tf-nowrap' }, run.mode.label),
          el('td', { class: 'tf-nowrap' }, resultCell(run)),
          el('td', { class: 'tf-summary' }, happenedCell(run)),
          el('td', { class: 'num' }, String(run.steps.length)),
          el(
            'td',
            { class: 'tf-mono tf-steps' },
            run.steps.map((s) => number(s.usage.inputTokens)).join(' → '),
          ),
          el(
            'td',
            { class: 'tf-mono tf-nowrap' },
            run.steps.length ? totalCell(totalUsage(run.steps)) : '',
          ),
        ),
      ),
    )

  const steps = all.flatMap((r) => r.steps)
  const meaning = document.getElementById('meaning')
  meaning.hidden = !steps.length
  meaning.textContent = steps.length
    ? `Each request sends the whole conversation again, so every tool result adds to the input tokens of the later requests. ${steps[0].request.body.model} · ${usageText(totalUsage(steps))}`
    : ''

  for (const run of all) {
    renderTrace(run)
  }
  document.getElementById('traces').replaceChildren(...all.map((r) => r.fold))
}

// ── The steps of one run ───────────────────────────────────────────────

function outputBlock(output) {
  let block
  try {
    block = codeBlock(prettyJson(JSON.parse(output)), 'json')
  } catch {
    block = codeBlock(output)
  }
  block.setAttribute('data-wrap', '')
  return block
}

// A short label, then where the text went.
const CALL_LABEL = {
  ok: ['Tool result', 'Sent back to the model.'],
  error: ['Tool error', 'Sent back to the model as the tool result.'],
  stopped: [
    'Error',
    'Shown to the user. The model does not see it, and the run stops.',
  ],
  offload: ['Saved to a file', 'Only this went back to the model.'],
}

function offloadNote(offload, later) {
  const extra = offload.tokens * later
  const cost =
    offload.inputPrice == null
      ? ''
      : ` That is about ${formatCost(extra * offload.inputPrice)} est. at this model's input price.`
  const sent = later
    ? ` Each of the ${plural(later, 'later request')} would send it again: ${number(extra)} tokens in total.${cost}`
    : ''
  return el(
    'p',
    { class: 'mx-small mx-muted tf-offload' },
    `The full result (${number(offload.bytes)} bytes, ${number(offload.lines)} lines) stays in `,
    el('code', {}, offload.path),
    `. Sent inline, it would be ${number(offload.tokens)} tokens.${sent}`,
  )
}

function callView(c, later) {
  const label = CALL_LABEL[c.offload ? 'offload' : c.kind]
  return el(
    'div',
    { class: `tf-call is-${c.kind}` },
    el(
      'div',
      { class: 'tf-call-head' },
      el('span', { class: 'tf-arrow', 'aria-hidden': 'true' }, '→'),
      el('code', { class: 'tf-call-name' }, c.name),
      el('code', { class: 'tf-call-args' }, c.arguments || '{}'),
    ),
    el(
      'div',
      { class: 'tf-call-out' },
      el(
        'div',
        { class: 'tf-call-label' },
        el(
          'span',
          { class: `mx-label${c.kind === 'ok' ? '' : ' mx-bad'}` },
          label[0],
        ),
        el('span', { class: 'mx-small mx-muted' }, label[1]),
      ),
      outputBlock(c.output),
      c.offload ? offloadNote(c.offload, later) : null,
    ),
  )
}

function stepView(step, run) {
  const answer = run.end === 'answer' && step === run.steps.at(-1)
  const kind = step.calls.length
    ? plural(step.calls.length, 'tool call')
    : 'Text, no tool call'
  return el(
    'li',
    { class: `tf-step${answer ? ' is-end' : ''}` },
    el(
      'div',
      { class: 'tf-rail' },
      el('span', { class: 'tf-num' }, String(step.number)),
    ),
    el(
      'div',
      { class: 'tf-body mx-stack' },
      el(
        'div',
        { class: 'mx-spread' },
        el(
          'span',
          { class: 'mx-label tf-kind' },
          `Request ${step.number} · ${kind}`,
        ),
        el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
      ),
      step.calls.map((c) => callView(c, run.steps.length - step.number)),
      step.text && step.calls.length
        ? el('p', { class: 'mx-small mx-muted tf-aside' }, step.text)
        : null,
      answer
        ? el(
            'div',
            { class: 'tf-answer' },
            el('span', { class: 'mx-label tf-end' }, 'Answer'),
            modelText(step.text || '(no text)'),
          )
        : null,
      step.status === 'incomplete'
        ? el(
            'p',
            { class: 'mx-small mx-bad' },
            'The reply reached max_output_tokens and was cut.',
          )
        : null,
      el(
        'details',
        { class: 'mx-details tf-raw' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'Request and response'),
          el('span', { class: 'mx-small mx-muted' }, `request ${step.number}`),
        ),
        requestResponse(step.request, step.response),
      ),
    ),
  )
}

function renderTrace(run) {
  const calls = run.steps.reduce((n, s) => n + s.calls.length, 0)
  run.foldCount.textContent = `${plural(run.steps.length, 'request')}, ${plural(calls, 'tool call')}, every tool result`
  const pending =
    run.state === 'running'
      ? el(
          'li',
          { class: 'tf-step is-pending' },
          el(
            'div',
            { class: 'tf-rail' },
            el('span', { class: 'tf-num' }, String(run.steps.length + 1)),
          ),
          el(
            'div',
            { class: 'tf-body' },
            el('span', { class: 'mx-label' }, 'Waiting for the model…'),
          ),
        )
      : null
  run.trace.replaceChildren(
    ...run.steps.map((s) => stepView(s, run)),
    ...[pending].filter(Boolean),
  )
}

// ── Settings ───────────────────────────────────────────────────────────

document.getElementById('task').textContent = setup.task
document.getElementById('known').textContent =
  `Correct answer: ${number(setup.expected.total)} USD from ${setup.expected.count} invoices (today is ${setup.today}). The billing system calls the customer "Acme Corp", not "ACME".`
document
  .getElementById('modes')
  .append(
    ...setup.modes.map((m) =>
      el('li', {}, el('b', {}, m.label), `: ${m.about}`),
    ),
  )

// The same tool can appear in several modes. Show each definition once, with the modes that use it.
const tools = new Map()
for (const m of setup.modes) {
  for (const t of m.tools) {
    if (!tools.has(t.name)) {
      tools.set(t.name, { definition: t, modes: [] })
    }
    tools.get(t.name).modes.push(m.label)
  }
}
document.getElementById('tools-count').textContent = plural(tools.size, 'tool')
document
  .getElementById('tool-defs')
  .append(
    el(
      'p',
      { class: 'mx-small mx-muted tf-aside' },
      [...tools.entries()]
        .map(([name, t]) => `${name}: ${list(t.modes)}.`)
        .join(' '),
    ),
    codeBlock(prettyJson([...tools.values()].map((t) => t.definition)), 'json'),
  )
runButton.addEventListener('click', start)
