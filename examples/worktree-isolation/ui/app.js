import {
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
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const empty = document.getElementById('empty')
const picker = await providerPicker(document.getElementById('picker'))

if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const workerName = (id) =>
  `Worker ${id.toUpperCase()} · ${setup.workers[id].name}`
const passText = (ok) =>
  el('span', { class: ok ? 'mx-good' : 'mx-bad' }, ok ? 'pass' : 'fail')

const EMPTY = 'Press Run. Up to 36 requests, under 1 cent.'
empty.textContent = EMPTY

document
  .getElementById('tasks')
  .replaceChildren(
    ...Object.keys(setup.workers).map((id) =>
      el(
        'article',
        { class: 'mx-plate wi-task' },
        el('span', { class: 'mx-label' }, workerName(id)),
        el('p', {}, setup.workers[id].task),
      ),
    ),
  )

function renderTable(runs) {
  const merge = (run) =>
    !run.merge
      ? '—'
      : run.merge.conflict
        ? el(
            'span',
            { class: 'mx-bad' },
            `conflict in ${run.merge.paths.join(', ')}`,
          )
        : !run.events.length
          ? 'nothing to merge'
          : run.merge.checks
            ? 'clean'
            : el('span', { class: 'mx-bad' }, 'failed')

  const rows = [
    [
      'Task edits kept',
      (run) => `${Number(run.changes.a) + Number(run.changes.b)} of 2`,
    ],
    [
      "Saves that broke the other Worker's test",
      (run) =>
        run.mode === 'shared'
          ? String(run.disruptions.a + run.disruptions.b)
          : 'none: separate files',
    ],
    ['Merge into main', merge],
    ['Shipping test on main', (run) => passText(run.final.a)],
    ['Loyalty test on main', (run) => passText(run.final.b)],
    ['Requests', (run) => String(run.steps.length)],
    ['Tokens and cost', (run) => usageText(run.usage)],
    ['Time', (run) => `${(run.ms / 1000).toFixed(1)} s`],
  ]

  document.getElementById('table-head').replaceChildren(
    el(
      'tr',
      {},
      el('th', {}, ''),
      runs.map((run) =>
        el(
          'th',
          { class: 'num' },
          setup.modes.find((m) => m.id === run.mode).label,
        ),
      ),
    ),
  )

  document.getElementById('table').replaceChildren(
    ...rows.map(([label, cell]) =>
      el(
        'tr',
        {},
        el('td', {}, label),
        runs.map((run) => el('td', { class: 'num' }, cell(run))),
      ),
    ),
  )
}

function modeView(run) {
  return el(
    'article',
    { class: 'mx-panel wi-mode mx-stack' },
    el(
      'h3',
      { class: 'mx-h3' },
      setup.modes.find((m) => m.id === run.mode).label,
    ),
    run.events.length
      ? el(
          'ol',
          { class: 'wi-events' },
          run.events.map((event) =>
            el(
              'li',
              {},
              el('b', {}, `${workerName(event.worker)}, turn ${event.turn}`),
              ' · Shipping ',
              passText(event.checks.a),
              ' · Loyalty ',
              passText(event.checks.b),
              event.disrupted.length
                ? el(
                    'span',
                    { class: 'mx-bad' },
                    ` · broke the ${event.disrupted.map((id) => setup.workers[id].name).join(', ')} test`,
                  )
                : null,
            ),
          ),
        )
      : el('p', { class: 'mx-muted mx-small' }, 'No Worker saved a file.'),
    run.branches
      ? el(
          'p',
          { class: 'mx-small' },
          'Branch tests before the merge: Shipping on its branch ',
          passText(run.branches.a.a),
          ', Loyalty on its branch ',
          passText(run.branches.b.b),
          '.',
        )
      : null,
    el(
      'div',
      { class: 'mx-stack' },
      el('span', { class: 'mx-label' }, 'quote.js on main after the run'),
      codeBlock(run.source, 'javascript'),
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
          { class: 'mx-muted mx-small' },
          `${run.steps.length} ${run.steps.length === 1 ? 'request' : 'requests'}`,
        ),
      ),
      el(
        'div',
        { class: 'wi-pad mx-stack' },
        run.steps.map((step) =>
          el(
            'div',
            { class: 'wi-step mx-stack' },
            el('b', {}, `${workerName(step.worker)} · turn ${step.number}`),
            step.calls.map((item) =>
              el(
                'p',
                { class: 'mx-small' },
                el('code', {}, item.name),
                ` → ${item.name === 'read_file' ? 'the source of quote.js' : item.output}`,
              ),
            ),
            step.text ? modelText(step.text) : null,
            requestResponse(step.request, step.response),
          ),
        ),
      ),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  showError(notice, null)
  empty.hidden = false
  document.getElementById('results').hidden = true
  document.getElementById('modes-box').hidden = true
  empty.textContent =
    'The Workers edit temporary checkouts: first the shared mode, then the worktree mode…'

  try {
    const { runs, headline } = await call('compare', picker.value())
    empty.hidden = true

    document
      .getElementById('headline')
      .replaceChildren(el('strong', {}, headline.lead), ` ${headline.rest}`)
    renderTable(runs)
    document.getElementById('cards').replaceChildren(...runs.map(modeView))
    document.getElementById('results').hidden = false
    document.getElementById('modes-box').hidden = false
  } catch (error) {
    showError(notice, error)
    empty.textContent = EMPTY
  } finally {
    button.disabled = false
  }
})
