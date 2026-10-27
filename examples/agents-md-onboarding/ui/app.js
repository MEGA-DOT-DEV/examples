import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const scope = document.getElementById('scope')
const empty = document.getElementById('empty')

const lang = (path) =>
  path.endsWith('.json')
    ? 'json'
    : path.endsWith('.md')
      ? 'md'
      : path.endsWith('.ts')
        ? 'ts'
        : 'text'
const taskTitle = (id) => setup.tasks.find((task) => task.id === id).title

scope.append(
  ...setup.tasks.map((task) =>
    el('option', { value: task.id, selected: task.id === 'route' }, task.title),
  ),
  el('option', { value: 'all' }, `All ${setup.tasks.length} tasks`),
)
function showEmpty() {
  const conversations =
    setup.modes.length * (scope.value === 'all' ? setup.tasks.length : 1)
  empty.textContent = `Press Compare 3 modes. ${conversations} conversations, up to ${conversations * setup.maxSteps} paid requests.`
}
scope.addEventListener('change', showEmpty)
showEmpty()

document.getElementById('files-count').textContent =
  `${setup.files.length} files`

// A path is a code name the learner needs, so it stays as `code`, not an uppercase label.
const lineCount = (text) => text.split('\n').filter(Boolean).length
document
  .getElementById('files')
  .append(
    ...setup.files.map((file) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('code', {}, file.path),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            `${lineCount(file.content)} ${lineCount(file.content) === 1 ? 'line' : 'lines'}`,
          ),
        ),
        codeBlock(file.content, lang(file.path)),
      ),
    ),
  )

document
  .getElementById('guidance')
  .append(
    ...setup.modes
      .filter((mode) => mode.id !== 'none')
      .map((mode) =>
        el(
          'div',
          {},
          el('span', { class: 'mx-label' }, mode.label),
          codeBlock(setup.guidance[mode.id], 'md'),
        ),
      ),
  )

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cost: a.cost === null || b.cost === null ? null : a.cost + b.cost,
    costSource:
      a.costSource === 'estimate' || b.costSource === 'estimate'
        ? 'estimate'
        : (a.costSource ?? b.costSource),
  }
}

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cost: 0,
  costSource: null,
}

// Tool calls before the first edit: how much the agent had to look around before it acted.
const callsBefore = (results) =>
  results.map((task) => task.beforeFirstWrite ?? 'no edit').join(', ')

function headline(jobs, single) {
  const byMode = setup.modes.map((mode) => ({
    mode,
    results: jobs
      .filter((job) => job.mode === mode.id && job.result)
      .map((job) => job.result),
  }))

  const ran = byMode.filter((item) => item.results.length)
  const calls = `Tool calls before the first edit: ${ran.map(({ mode, results }) => `${callsBefore(results)} with ${mode.short}`).join(', ')}.`
  const failed = ran.filter(({ results }) =>
    results.some((task) => !task.passed),
  )
  const passed = single
    ? failed.length
      ? `The task failed with ${failed.map(({ mode }) => mode.short).join(' and ')}.`
      : `The task passed in all ${ran.length} modes.`
    : `Tasks passed: ${ran.map(({ mode, results }) => `${results.filter((task) => task.passed).length} of ${results.length} with ${mode.short}`).join(', ')}.`

  // A failure with AGENTS.md loaded is the case the lesson warns about: AGENTS.md guides, it does not enforce.
  return el(
    'div',
    {
      class: `mx-callout${failed.some(({ mode }) => mode.id !== 'none') ? ' mx-callout--warn' : ''}`,
    },
    el('p', {}, `${calls} ${passed}`),
  )
}

function renderRow(mode, jobs) {
  const results = jobs
    .filter((job) => job.mode === mode.id && job.result)
    .map((job) => job.result)
  const error = jobs.find((job) => job.mode === mode.id && job.error)

  if (!results.length) {
    return el(
      'tr',
      {},
      el('th', { scope: 'row' }, mode.label),
      el(
        'td',
        { colspan: '3', class: error ? 'mx-bad' : 'mx-muted' },
        error ? error.error : 'Waiting…',
      ),
    )
  }

  const passes = results.filter((task) => task.passed).length
  return el(
    'tr',
    {},
    el('th', { scope: 'row' }, mode.label),
    el(
      'td',
      { class: passes === results.length ? 'mx-good' : 'mx-bad' },
      results.length === 1
        ? passes
          ? 'Passed'
          : 'Failed'
        : `${passes} of ${results.length} passed`,
    ),
    el('td', {}, callsBefore(results)),
    el(
      'td',
      {},
      usageText(results.reduce((sum, task) => addUsage(sum, task.usage), ZERO)),
    ),
  )
}

function renderCard(job, single) {
  const title = single
    ? setup.modes.find((mode) => mode.id === job.mode).label
    : `${setup.modes.find((mode) => mode.id === job.mode).label} · ${taskTitle(job.task)}`

  const task = job.result
  if (!task) {
    return el(
      'article',
      { class: 'mx-panel onboard-card' },
      el('h3', { class: 'mx-h3' }, title),
      el(
        'p',
        { class: job.error ? 'mx-bad' : 'mx-muted' },
        job.error ?? 'Waiting…',
      ),
    )
  }

  const calls = task.steps.flatMap((step) => step.calls)
  // The agent's own claim, shown next to what it saved: the score comes from the files, not this text.
  const reply = task.steps.findLast((step) => step.text)?.text

  return el(
    'article',
    { class: 'mx-panel onboard-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el('h3', { class: 'mx-h3' }, title),
      el(
        'strong',
        { class: task.passed ? 'mx-good' : 'mx-bad' },
        task.passed ? 'Passed' : 'Failed',
      ),
    ),
    task.breaks.length
      ? el(
          'ul',
          { class: 'mx-bad' },
          task.breaks.map((issue) => el('li', {}, issue)),
        )
      : null,
    task.end === 'step_limit'
      ? el(
          'p',
          { class: 'mx-muted' },
          `The agent stopped after ${setup.maxSteps} requests.`,
        )
      : null,
    task.writes.length
      ? el(
          'div',
          { class: 'onboard-writes' },
          task.writes.map((write) =>
            el(
              'div',
              {},
              el('span', { class: 'mx-label' }, 'Edited '),
              el('code', {}, write.path),
              codeBlock(write.content, lang(write.path)),
            ),
          ),
        )
      : el('p', { class: 'mx-muted' }, 'The agent edited no file.'),
    reply
      ? el(
          'div',
          {},
          el('span', { class: 'mx-label' }, 'Last reply'),
          modelText(reply),
        )
      : null,
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Tool calls and results'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`,
        ),
      ),
      el(
        'ol',
        {},
        calls.map((tool) =>
          el(
            'li',
            {},
            el('code', {}, tool.name),
            ' ',
            codeBlock(tool.arguments, 'json'),
            el(
              'span',
              { class: 'mx-label' },
              tool.error ? 'Tool error' : 'Tool result',
            ),
            codeBlock(tool.output),
          ),
        ),
      ),
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
          `${task.steps.length} ${task.steps.length === 1 ? 'request' : 'requests'}`,
        ),
      ),
      task.steps.map((step) =>
        el(
          'div',
          { class: 'onboard-step' },
          el('span', { class: 'mx-label' }, `Request ${step.number}`),
          step.text ? modelText(step.text) : null,
          requestResponse(step.request, step.response),
        ),
      ),
    ),
  )
}

runButton.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  showError(notice, null)

  const single = scope.value !== 'all'
  const tasks = single
    ? setup.tasks.filter((task) => task.id === scope.value)
    : setup.tasks
  const jobs = setup.modes.flatMap((mode) =>
    tasks.map((task) => ({
      mode: mode.id,
      task: task.id,
      result: null,
      error: null,
    })),
  )

  const rows = document.getElementById('rows')
  const cards = document.getElementById('cards')
  const render = () => {
    rows.replaceChildren(...setup.modes.map((mode) => renderRow(mode, jobs)))
    cards.replaceChildren(...jobs.map((job) => renderCard(job, single)))
  }

  document.getElementById('headline').replaceChildren()
  document.getElementById('summary').textContent = ''
  document.getElementById('results').hidden = false
  empty.hidden = true
  render()

  await busy(runButton, 'Running…', async () => {
    for (const [index, job] of jobs.entries()) {
      runButton.textContent = `Running ${index + 1} of ${jobs.length}…`
      try {
        job.result = (
          await call('run', {
            mode: job.mode,
            task: job.task,
            ...picker.value(),
          })
        ).task
      } catch (error) {
        job.error = error.message
        // Later jobs would fail the same way, so stop here.
        for (const pending of jobs) {
          if (!pending.result && !pending.error) {
            pending.error = 'Not run: an earlier request failed.'
          }
        }
        render()
        return showError(notice, error)
      }
      render()
    }
  })

  const done = jobs.filter((job) => job.result)
  if (!done.length) {
    return
  }

  document.getElementById('headline').replaceChildren(headline(jobs, single))
  const requests = done.reduce((n, job) => n + job.result.steps.length, 0)
  document.getElementById('summary').textContent =
    `Fewer tool calls before the first edit mean the agent spent less work on finding the project rules. ${requests} requests · ${usageText(done.reduce((sum, job) => addUsage(sum, job.result.usage), ZERO))}`
})
