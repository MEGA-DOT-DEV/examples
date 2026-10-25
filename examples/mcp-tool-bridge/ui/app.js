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

const MODE_NAMES = { mcp: 'MCP server', cli: 'Local CLI' }
const select = document.getElementById('project')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const setup = await call('setup')
for (const project of setup.projects) {
  select.append(el('option', { value: project }, project))
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// A tool call: what the model sent, and the tool result the harness sent back.
function callView(c) {
  return el(
    'li',
    { class: 'tb-call' },
    el(
      'div',
      {},
      el('span', { class: 'tb-arrow', 'aria-hidden': 'true' }, '→ '),
      el('code', { class: 'tb-name' }, c.name),
      ' ',
      el('code', {}, c.arguments || '{}'),
    ),
    el(
      'div',
      { class: c.error ? 'mx-bad' : 'mx-muted' },
      el('span', { 'aria-hidden': 'true' }, '← '),
      el('code', {}, c.output),
    ),
  )
}

function runView(run) {
  const calls = run.steps.flatMap((step) => step.calls)
  const tools = run.steps[0]?.request?.body?.tools ?? []

  return el(
    'section',
    { class: 'mx-plate mx-stack' },
    el(
      'div',
      { class: 'mx-spread' },
      el('h3', { class: 'mx-h3' }, MODE_NAMES[run.mode]),
      el(
        'span',
        { class: `mx-label ${run.correct ? 'mx-good' : 'mx-bad'}` },
        run.correct ? 'Correct' : 'Wrong',
      ),
    ),
    modelText(run.text || 'No answer before the step limit.'),
    el(
      'div',
      { class: 'mx-stack' },
      el('span', { class: 'mx-label' }, `Tool calls · ${calls.length}`),
      calls.length
        ? el('ol', { class: 'tb-calls' }, ...calls.map(callView))
        : el('p', { class: 'mx-small mx-muted' }, 'The model called no tool.'),
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${plural(run.steps.length, 'step')} · ${usageText(run.usage)}`,
    ),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Tool schemas'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${plural(tools.length, 'tool')} · about ${run.toolDefinitionTokens[0]} tokens per request`,
        ),
      ),
      codeBlock(prettyJson(tools), 'json'),
    ),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Requests and responses'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          plural(run.steps.length, 'step'),
        ),
      ),
      el(
        'div',
        { class: 'mx-stack tb-raw' },
        ...run.steps.map((step) =>
          el(
            'div',
            { class: 'mx-stack' },
            el('span', { class: 'mx-label' }, `Step ${step.number}`),
            requestResponse(step.request, step.response),
          ),
        ),
      ),
    ),
  )
}

button.addEventListener('click', () =>
  busy(button, 'Running…', async () => {
    showError(notice, null)
    if (!picker.hasKey()) {
      return missingKeyNote(notice)
    }

    headline.replaceChildren(
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Both runs are in progress. The result shows when both finish.',
      ),
    )

    document.getElementById('runs-box').hidden = true

    try {
      const comparison = await call('run', {
        project: select.value,
        ...picker.value(),
      })

      headline.replaceChildren(
        el(
          'div',
          { class: 'mx-callout' },
          el('span', { class: 'mx-label' }, 'Result'),
          el('p', {}, comparison.headline),
        ),
      )

      document
        .getElementById('runs')
        .replaceChildren(...comparison.runs.map(runView))
      document.getElementById('runs-box').hidden = false
    } catch (error) {
      headline.replaceChildren()
      showError(notice, error)
    }
  }),
)
