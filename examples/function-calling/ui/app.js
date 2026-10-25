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

const queryBox = document.getElementById('query')
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')

let setup = await call('setup')

const STEPS = [
  { title: 'Request with tool schemas', who: 'Our code → model' },
  { title: 'The model writes a function call', who: 'Model', focal: true },
  { title: 'Our code checks the arguments and runs the tool', who: 'Our code' },
  { title: 'Request with the tool result', who: 'Our code → model' },
  { title: 'Final reply', who: 'Model' },
]

// One <li> per step. set(i, state, ...content) fills it.
const bodies = []
const items = STEPS.map((step, i) => {
  const body = el('div', { class: 'fc-body' })
  bodies.push(body)

  return el(
    'li',
    {
      class: `fc-step${step.focal ? ' fc-step--focal' : ''}`,
      'data-state': 'idle',
    },
    el('span', { class: 'fc-num' }, String(i + 1)),
    el(
      'div',
      { class: 'fc-main' },
      el(
        'div',
        { class: 'fc-head' },
        el('span', { class: 'fc-title' }, step.title),
        el('span', { class: 'mx-label' }, step.who),
      ),
      body,
    ),
  )
})
document.getElementById('steps').append(...items)

function set(i, state, ...content) {
  items[i].dataset.state = state
  bodies[i].replaceChildren(...content.filter((part) => part != null))
}

const note = (text) => el('p', { class: 'mx-small mx-muted' }, text)
const label = (text) => el('span', { class: 'mx-label' }, text)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const signature = (tool) =>
  `${tool.name}(${Object.keys(tool.parameters.properties).join(', ')})`
const argsJson = (c) => (c.args ? prettyJson(c.args) : c.arguments)

// The function_call_output is a JSON string inside JSON: wrap it, do not scroll.
function wrappedJson(value) {
  const block = codeBlock(prettyJson(value), 'json')
  block.setAttribute('data-wrap', '')
  return block
}

// A fold whose summary says what is inside and how much.
function fold(title, count, ...content) {
  return el(
    'details',
    { class: 'mx-details fc-fold' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, title),
      count ? el('span', { class: 'mx-small mx-muted' }, count) : null,
    ),
    el('div', { class: 'fc-pad mx-stack' }, ...content),
  )
}

const rawFold = (step, request, response) =>
  fold(
    `Request and response · step ${step}`,
    null,
    requestResponse(request, response),
  )

function toolsView() {
  return [
    el(
      'div',
      { class: 'fc-kv' },
      label('Tools'),
      el(
        'div',
        { class: 'mx-row' },
        setup.tools.map((t) =>
          el(
            'span',
            { class: 'mx-chip mx-chip--static', title: t.description },
            signature(t),
          ),
        ),
      ),
    ),
    fold(
      'Instructions and tool schemas',
      plural(setup.tools.length, 'tool'),
      label('Instructions'),
      el('p', { class: 'fc-mono' }, setup.instructions),
      label('Tool schemas'),
      codeBlock(prettyJson(setup.tools), 'json'),
    ),
  ]
}

const userView = (query) =>
  el(
    'div',
    { class: 'fc-kv' },
    label('User message'),
    el('p', { class: 'fc-mono' }, JSON.stringify(query)),
  )

// Step 4: the items in `input`, then the full list, folded.
function inputView(next) {
  return [
    note(
      'The same instructions and tools. Only the input grew: the user message, the function call and the tool result.',
    ),
    el(
      'div',
      { class: 'mx-row' },
      next.map((item) =>
        el('code', { class: 'mx-chip mx-chip--static' }, item.type),
      ),
    ),
    fold('Input', plural(next.length, 'item'), wrappedJson(next)),
  ]
}

function idle() {
  set(
    0,
    'idle',
    ...toolsView(),
    note(
      'Each tool is a name, a description and a JSON Schema for its arguments. The model sees only this, never the code.',
    ),
  )

  set(
    1,
    'idle',
    note(
      'The model answers with JSON: a tool name and arguments. It does not run anything.',
    ),
  )

  set(
    2,
    'idle',
    note(
      'When the arguments do not match the schema, the tool does not run. The error goes back as the result.',
    ),
  )

  set(
    3,
    'idle',
    note(
      'A second request: the whole conversation again, plus the tool result.',
    ),
  )

  set(4, 'idle', note('The model writes the answer from the tool result.'))
}

function showFirst(first) {
  set(
    0,
    'done',
    ...toolsView(),
    userView(first.query),
    rawFold(1, first.request, first.response),
  )

  const meta = note(
    `${first.provider} · ${first.model} · ${first.ms} ms · ${usageText(first.usage)}`,
  )

  if (!first.calls.length) {
    set(
      1,
      'done',
      el(
        'p',
        { class: 'fc-none' },
        'No function call. The model answered without a tool:',
      ),
      modelText(first.text || '(empty)'),
      meta,
    )

    for (const i of [2, 3, 4]) {
      set(i, 'skipped', note('Not needed: no tool to run.'))
    }
    return
  }

  set(
    1,
    'done',
    ...first.calls.map((c) =>
      el(
        'div',
        { class: 'fc-call' },
        el(
          'div',
          { class: 'fc-call-head' },
          el('code', { class: 'fc-name' }, c.name),
          el(
            'span',
            { class: 'mx-hint' },
            'call_id ',
            el('code', {}, c.callId),
          ),
        ),
        codeBlock(argsJson(c), 'json'),
      ),
    ),
    meta,
  )

  set(
    2,
    'done',
    ...first.calls.map((c) =>
      el(
        'div',
        { class: 'fc-call' },
        el(
          'p',
          { class: c.errors.length ? 'mx-bad' : 'mx-good' },
          c.errors.length
            ? `✗ ${c.name}: ${c.errors.join('; ')}`
            : `✓ ${c.name}: the arguments match the schema. The tool ran.`,
        ),
        label('Tool result'),
        codeBlock(prettyJson(c.output), 'json'),
      ),
    ),
  )

  set(3, 'active', ...inputView(first.next))
  set(4, 'active', note('Waiting for the model…'))
}

function showSecond(first, second) {
  set(
    3,
    'done',
    ...inputView(first.next),
    rawFold(4, second.request, second.response),
  )

  set(
    4,
    'done',
    modelText(second.text || '(empty)', 'mx-output fc-reply'),
    second.moreCalls.length
      ? note(
          `The model asked for more tools (${second.moreCalls.join(', ')}). This page stops after one round trip.`,
        )
      : null,
    note(`${second.ms} ms · ${usageText(second.usage)}`),
  )
}

function showHeadline(text, warn = false) {
  headline.replaceChildren(
    el(
      'div',
      { class: `mx-callout${warn ? ' mx-callout--warn' : ''}` },
      label('Result'),
      el('p', {}, text),
    ),
  )
}

// Which tools ran, which did not, and what both requests cost together.
function roundTripHeadline(first, second) {
  const ran = first.calls.filter((c) => !c.errors.length).map((c) => c.name)
  const blocked = first.calls.filter((c) => c.errors.length).map((c) => c.name)

  const sum = (key) => (first.usage[key] ?? 0) + (second.usage[key] ?? 0)
  const costs = [first.usage.cost, second.usage.cost]
  const usage = {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    reasoningTokens: sum('reasoningTokens'),
    cost: costs.every((c) => c != null) ? costs[0] + costs[1] : null,
    costSource: second.usage.costSource,
  }

  return [
    ran.length ? `${plural(ran.length, 'tool')} ran: ${ran.join(', ')}.` : null,
    blocked.length
      ? `${blocked.join(', ')} did not run: the arguments have errors. The error went back to the model.`
      : null,
    ran.length === 1
      ? 'The model wrote the call as JSON. Our code ran the tool, and a second request sent the result back.'
      : null,
    ran.length > 1
      ? 'The model wrote the calls as JSON. Our code ran the tools, and a second request sent the results back.'
      : null,
    `Total for 2 requests: ${usageText(usage).replace(/\.$/, '')}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

function failed(i, error) {
  const box = el('div')
  showError(box, error)
  set(i, 'failed', box)
}

// Two api calls, one per request, so each step shows when it is ready.
async function run() {
  const query = queryBox.value.trim()
  if (!query) {
    return notice.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        label('Nothing to send'),
        el('p', {}, 'Write a message first.'),
      ),
    )
  }

  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  idle()
  headline.replaceChildren(
    el('p', { class: 'mx-muted fc-empty' }, 'Waiting for the model…'),
  )

  set(0, 'active', ...toolsView(), userView(query), note('Sending…'))
  set(1, 'active', note('Waiting for the model…'))

  await busy(runButton, 'Running…', async () => {
    let first
    try {
      first = await call('ask', { query, ...picker.value() })
    } catch (error) {
      set(0, 'done', ...toolsView())
      showHeadline('The first request failed. Step 2 says why.', true)
      return failed(1, error)
    }

    showFirst(first)

    if (!first.next) {
      return showHeadline(
        'No tool ran. The model answered by itself in 1 request.',
      )
    }

    try {
      const second = await call('answer', {
        input: first.next,
        today: first.today,
        provider: first.provider,
        model: first.model,
      })

      showSecond(first, second)
      showHeadline(roundTripHeadline(first, second))
    } catch (error) {
      showHeadline(
        'Our code ran the tool, but the second request failed. Step 5 says why.',
        true,
      )
      failed(4, error)
    }

    // A created task shows in the fake data below.
    setup = await call('setup')
    renderData()
  })
}

function renderData() {
  const { calendar, inbox, tasks } = setup.data
  const events = Object.values(calendar).reduce((n, day) => n + day.length, 0)
  document.getElementById('data-count').textContent =
    `${plural(events, 'event')}, ${plural(inbox.length, 'email')}, ${plural(tasks.length, 'task')}`

  document
    .getElementById('data')
    .replaceChildren(
      note(
        `Today is ${setup.today}. The calendar repeats every week. Tasks you add stay until the viewer stops.`,
      ),
      label('calendar_list reads'),
      codeBlock(prettyJson(calendar), 'json'),
      label('mail_search reads'),
      codeBlock(prettyJson(inbox), 'json'),
      label('tasks_create added'),
      codeBlock(prettyJson(tasks), 'json'),
    )
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('presets').append(
  ...setup.presets.map((text) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        onclick: () => {
          queryBox.value = text
          run()
        },
      },
      text,
    ),
  ),
)

queryBox.value = setup.presets[0]
idle()
renderData()
runButton.addEventListener('click', run)
queryBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    run()
  }
})
