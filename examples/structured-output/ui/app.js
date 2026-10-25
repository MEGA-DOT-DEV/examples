import {
  busy,
  call,
  codeBlock,
  debounce,
  el,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const promptBox = document.getElementById('prompt')
const schemaBox = document.getElementById('schema')
const nameBox = document.getElementById('name')
const status = document.getElementById('schema-status')
const board = document.getElementById('board')
const details = document.getElementById('details')
const headline = document.getElementById('headline')
const notice = document.getElementById('notice')
const runButton = document.getElementById('run')
const compareButton = document.getElementById('compare')

const { presets, invented } = await call('presets')
const byId = (id) => presets.find((p) => p.id === id)

// The schema box grows with its content, so the whole schema stays in view.
function fit() {
  schemaBox.style.height = 'auto'
  schemaBox.style.height = `${schemaBox.scrollHeight + 2}px`
}

function load(preset) {
  promptBox.value = preset.prompt
  schemaBox.value = preset.schema
  nameBox.value = preset.name
  fit()
  void checkSchema()
}

// The schema is checked on the server while you type. No API call.
async function checkSchema() {
  const result = await call('checkSchema', { schema: schemaBox.value })

  status.className = `mx-small so-status ${result.ok ? 'mx-good' : 'mx-bad'}`
  status.textContent = result.ok
    ? `✓ Valid JSON. Fields: ${result.fields.join(', ') || 'none'}.`
    : `✗ ${result.error}`

  return result.ok
}

// What we know about a preset whose prompt you did not change.
const presetFor = (prompt) =>
  presets.find((p) => p.prompt === prompt.trim()) ?? null

function section(label, ...content) {
  return el(
    'div',
    { class: 'so-section' },
    el('span', { class: 'mx-label' }, label),
    ...content,
  )
}

// The raw request and response, folded. The usage tells what the request cost.
function rawFold(usage, request, response) {
  return el(
    'details',
    { class: 'mx-details so-raw' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      usage
        ? el('span', { class: 'mx-small mx-muted' }, usageText(usage))
        : null,
    ),
    el('div', { class: 'so-pad' }, requestResponse(request, response)),
  )
}

function wrapped(text) {
  const block = codeBlock(text)
  block.setAttribute('data-wrap', '')
  return block
}

/** One result card. Shows "waiting" until fill() or fail() runs. */
function card(title) {
  const meta = el(
    'span',
    { class: 'mx-label so-meta' },
    'Waiting for the model…',
  )
  const body = el('div', { class: 'so-body' })
  const node = el(
    'article',
    { class: 'mx-plate so-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'mx-label so-title' }, title),
      meta,
    ),
    body,
  )

  return {
    node,
    fill(result) {
      meta.textContent = `${result.provider} · ${result.model}${result.ms ? ` · ${result.ms} ms` : ''}`
      body.replaceChildren(...renderResult(result))
    },
    fail(error) {
      meta.textContent = 'Failed'
      const box = el('div')
      showError(box, error)
      body.replaceChildren(box)
    },
  }
}

function renderResult(result) {
  const prompt = el('p', { class: 'so-prompt-echo' }, result.prompt)

  if (result.rejected) {
    return [
      prompt,
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'The API rejected the request'),
        el('p', {}, result.rejected),
      ),
      rawFold(result.usage, result.request, result.response),
    ]
  }

  const parts = [
    prompt,
    section(
      '1 · Output text (a string)',
      wrapped(result.outputText || '(empty)'),
    ),
  ]

  if (result.refusal) {
    parts.push(
      el('p', { class: 'mx-bad' }, `The model refused: ${result.refusal}`),
    )
  }
  if (result.incompleteReason) {
    parts.push(
      el(
        'p',
        { class: 'mx-bad' },
        `The output stopped early: ${result.incompleteReason}.`,
      ),
    )
  }

  parts.push(
    section(
      '2 · Parse',
      result.parseError
        ? el(
            'p',
            { class: 'mx-bad' },
            '✗ ',
            el('code', {}, 'JSON.parse'),
            ` fails: ${result.parseError}`,
          )
        : el(
            'p',
            { class: 'so-verdict' },
            '✓ ',
            el('code', {}, 'JSON.parse'),
            ' turns the string into an object.',
          ),
      result.parseError ? null : codeBlock(prettyJson(result.parsed), 'json'),
    ),
  )

  if (result.check) {
    parts.push(
      section(
        '3 · Schema check in code',
        el(
          'p',
          { class: `so-verdict ${result.check.ok ? 'mx-good' : 'mx-bad'}` },
          result.check.ok ? '✓ Pass: the shape matches the schema.' : '✗ Fail',
        ),
        result.check.errors.length
          ? el(
              'ul',
              { class: 'so-errors' },
              result.check.errors.map((e) => el('li', {}, e)),
            )
          : null,
        result.check.skipped.length
          ? el(
              'p',
              { class: 'mx-small mx-muted' },
              `Not checked here: ${result.check.skipped.join(', ')}`,
            )
          : null,
      ),
    )
  }

  parts.push(rawFold(result.usage, result.request, result.response))
  return parts
}

/** Sends one request into one card. A failure stays on its own card. */
async function runInto(view, input) {
  try {
    const result = await call('run', { ...input, ...picker.value() })
    view.fill(result)
    return result
  } catch (error) {
    view.fail(error)
    return null
  }
}

// The schema check result of one answer, as one plain sentence.
function checkSentence(result, subject = 'The answer') {
  if (!result) {
    return `${subject}: the request failed.`
  }

  if (result.rejected) {
    return `${subject}: the API rejected the schema.`
  }

  if (!result.check) {
    return `${subject}: the output is not valid JSON.`
  }

  const n = result.check.errors.length
  return result.check.ok
    ? `${subject} passes the schema check.`
    : `${subject} fails the schema check: ${n} ${n === 1 ? 'problem' : 'problems'}.`
}

function showHeadline(text, warn = false) {
  headline.replaceChildren(
    el(
      'div',
      { class: `mx-callout${warn ? ' mx-callout--warn' : ''}` },
      el('span', { class: 'mx-label' }, 'Result'),
      el('p', {}, text),
    ),
  )
}

function showNotice(title, text) {
  notice.replaceChildren(
    el(
      'div',
      { class: 'mx-callout mx-callout--warn' },
      el('span', { class: 'mx-label' }, title),
      el('p', {}, text),
    ),
  )
}

function ready() {
  if (!picker.hasKey()) {
    missingKeyNote(notice)
    return false
  }

  notice.replaceChildren()
  return true
}

function showCards(views, pair) {
  board.className = `so-board${pair ? ' so-board--pair' : ''}`
  board.replaceChildren(...views.map((v) => v.node))
  details.hidden = false
  headline.replaceChildren(
    el('p', { class: 'mx-muted so-empty' }, 'Waiting for the model…'),
  )
}

async function runOne(title = 'Your prompt') {
  if (!promptBox.value.trim()) {
    return showNotice('Nothing to send', 'Write a prompt first.')
  }

  if (!(await checkSchema())) {
    return showNotice(
      'Fix the schema first',
      'The line under the schema says what is wrong.',
    )
  }

  if (!ready()) {
    return
  }

  const view = card(title)
  showCards([view], false)

  const result = await busy(runButton, 'Sending…', () =>
    runInto(view, {
      prompt: promptBox.value,
      schema: schemaBox.value,
      name: nameBox.value,
    }),
  )

  // Only we know if a preset's answer is true. The schema and the check cannot know.
  const preset = presetFor(promptBox.value)
  const words = checkSentence(result)
  showHeadline(
    result?.check?.ok && preset
      ? `${words} Is it true? ${preset.truth}`
      : words,
    !result?.check?.ok,
  )
}

// Kyoto and the invented city, side by side, one request each.
async function compare() {
  if (!ready()) {
    return
  }

  const pair = [byId('kyoto'), byId('invented')]
  const views = pair.map((p) => card(p.label))
  showCards(views, true)

  const results = await busy(compareButton, 'Running…', () =>
    Promise.all(
      pair.map((p, i) =>
        runInto(views[i], { prompt: p.prompt, schema: p.schema, name: p.name }),
      ),
    ),
  )

  if (results.every((r) => r?.check?.ok)) {
    showHeadline(
      `Both answers pass the schema check, but ${invented} does not exist. A schema controls the shape of the answer, not its truth.`,
    )
  } else {
    showHeadline(
      pair
        .map((p, i) => checkSentence(results[i], `The ${p.label} answer`))
        .join(' '),
      true,
    )
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('presets').append(
  ...presets.map((preset) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        onclick: () => {
          load(preset)
          runOne(preset.label)
        },
      },
      preset.label,
    ),
  ),
)

load(byId('kyoto'))

runButton.addEventListener('click', () =>
  runOne(presetFor(promptBox.value)?.label),
)
compareButton.addEventListener('click', compare)
schemaBox.addEventListener('input', fit)
schemaBox.addEventListener('input', debounce(checkSchema, 250))
promptBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    runButton.click()
  }
})
schemaBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    runButton.click()
  }
})
