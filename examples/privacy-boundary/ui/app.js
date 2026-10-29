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

const setup = await call('setup')
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const passesBox = document.getElementById('passes')
const runsBox = document.getElementById('runs')
const pushBox = document.getElementById('push')

// Requests per agent run, roughly: list, a few local tries, the answer.
const REQUESTS_PER_RUN = 4
const PARALLEL = 3
let batch = 0

// The latest batch: model-router passes, agent runs, and the totals.
let passes = []
let jobs = []
let summary = null

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const guardOf = (id) => setup.guards.find((g) => g.id === id)
const KINDS = {
  marked: 'Says it is private',
  unmarked: 'No sign in the text',
  'looks-sensitive': 'Looks sensitive',
  plain: '',
}
const cost = (u) =>
  u?.cost == null
    ? '—'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`

// ── Inputs ─────────────────────────────────────────────────────────────

const tagged = (priv) =>
  setup.projects
    .filter((p) => p.private === priv)
    .flatMap((p, i) => [i ? ', ' : '', el('code', {}, p.name)])

document
  .getElementById('config')
  .append(
    'The harness config tags each project. Private: ',
    ...tagged(true),
    '. Public: ',
    ...tagged(false),
    '. The rule in code reads this tag. The model router reads only the project name and the request.',
  )

document
  .getElementById('router-setup')
  .append(
    el('span', { class: 'mx-label' }, 'Instructions'),
    codeBlock(setup.routerInstructions),
    el('span', { class: 'mx-label' }, 'Request 1, as the router gets it'),
    codeBlock(setup.routerExample),
  )

document.getElementById('task-note').textContent =
  `task, instructions, ${plural(setup.tools.length, 'tool')}, ${plural(setup.files.length, 'private file')}`

document
  .getElementById('task-setup')
  .append(
    el('span', { class: 'mx-label' }, 'Task'),
    codeBlock(setup.task),
    el('span', { class: 'mx-label' }, 'Instructions, the same in both modes'),
    codeBlock(setup.taskInstructions),
    el(
      'span',
      { class: 'mx-label' },
      `Tools: ${setup.tools.map((t) => t.name).join(', ')}`,
    ),
    codeBlock(prettyJson(setup.tools), 'json'),
    el('span', { class: 'mx-label' }, 'Private files'),
    codeBlock(setup.files.map((f) => `${f.path}\n  ${f.text}`).join('\n\n')),
  )

document.getElementById('push-hint').textContent =
  `Adds to the task: "${setup.push}"`

for (let n = 1; n <= setup.passes.max; n++) {
  passesBox.append(
    el(
      'option',
      { value: String(n), selected: n === setup.passes.default },
      String(n),
    ),
  )
}

for (let n = 1; n <= setup.runs.max; n++) {
  runsBox.append(
    el(
      'option',
      { value: String(n), selected: n === setup.runs.default },
      String(n),
    ),
  )
}

const headline = document.getElementById('headline')

function renderEmpty() {
  const requests =
    Number(passesBox.value) * setup.requests.length +
    Number(runsBox.value) * setup.guards.length * REQUESTS_PER_RUN

  headline.textContent = `Press Run. About ${requests} requests, under 1 cent.`
}

// ── Part 1 ─────────────────────────────────────────────────────────────

const routeOf = (pass, id) =>
  pass.decisions.find((d) => d.requestId === id)?.route

function routeCell(route, request) {
  if (!route) {
    return el('td', { class: 'mx-muted' }, '')
  }
  if (route === 'cloud' && request.private) {
    return el(
      'td',
      { class: 'pb-route is-leak' },
      'cloud',
      el('span', {}, 'leak'),
    )
  }
  if (route === 'local' && !request.private) {
    return el(
      'td',
      { class: 'pb-route is-over' },
      'local',
      el('span', {}, 'over-block'),
    )
  }

  return el('td', { class: 'pb-route' }, route)
}

function renderRequests() {
  document
    .getElementById('requests-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', { class: 'num' }, '#'),
        el('th', {}, 'Project'),
        el('th', {}, 'Request'),
        ...passes.map((_, i) =>
          el(
            'th',
            {},
            passes.length > 1
              ? `${setup.routers.model}, pass ${i + 1}`
              : setup.routers.model,
          ),
        ),
        el('th', {}, setup.routers.rule),
      ),
    )

  document.getElementById('requests').replaceChildren(
    ...setup.requests.map((r) =>
      el(
        'tr',
        {},
        el('td', { class: 'num mx-muted' }, String(r.id)),
        el(
          'td',
          { class: 'pb-project' },
          el('code', {}, r.project),
          el(
            'div',
            { class: `mx-small ${r.private ? 'pb-private' : 'mx-muted'}` },
            r.private ? 'private' : 'public',
          ),
        ),
        el(
          'td',
          { class: 'pb-text' },
          r.text,
          KINDS[r.kind]
            ? el('div', { class: 'mx-small mx-muted' }, KINDS[r.kind])
            : null,
        ),
        ...passes.map((p) =>
          p.result
            ? routeCell(routeOf(p.result, r.id), r)
            : el(
                'td',
                {
                  class: `mx-muted${p.state === 'running' ? ' pb-pulse' : ''}`,
                },
                p.state === 'failed' ? 'failed' : '…',
              ),
        ),
        routeCell(routeOf(setup.rule, r.id), r),
      ),
    ),
  )
}

function renderRouteRaw() {
  document.getElementById('route-raw').replaceChildren(
    ...passes
      .filter((p) => p.result)
      .map((p, i) =>
        el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, `Router replies · pass ${i + 1}`),
            el(
              'span',
              { class: 'mx-small mx-muted' },
              `${plural(p.result.decisions.length, 'request')} · ${usageText(p.result.record.usage)}`,
            ),
          ),
          el(
            'div',
            { class: 'pb-pad mx-stack' },
            p.result.decisions.map((d) =>
              el(
                'div',
                { class: 'mx-stack pb-reply' },
                el('div', {}, el('b', {}, `#${d.requestId} → ${d.route}`)),
                modelText(d.reason),
                requestResponse(d.request, d.response),
              ),
            ),
          ),
        ),
      ),
  )
}

// ── Part 2 ─────────────────────────────────────────────────────────────

function argsOf(c) {
  try {
    return JSON.parse(c.arguments)
  } catch {
    return {}
  }
}

function callLine(c) {
  const files = argsOf(c).files ?? []
  const secret = files.filter((f) =>
    setup.projects.some((p) => p.private && f.startsWith(`${p.name}/`)),
  )
  const what = files.length
    ? `${plural(files.length, 'file')}${secret.length ? ', private' : ''}`
    : ''

  let result
  if (c.name === 'list_files') {
    result = el('span', { class: 'mx-muted' }, c.error ? 'failed' : 'listed')
  } else if (c.output.includes('Refused')) {
    result = el('span', { class: 'pb-refused' }, 'refused by the harness')
  } else if (c.error) {
    result = el(
      'span',
      { class: 'mx-muted' },
      c.output.includes('out of memory') ? 'failed: out of memory' : 'failed',
    )
  } else if (c.name === 'cloud_model') {
    result = el(
      'span',
      { class: secret.length ? 'mx-bad' : 'mx-muted' },
      secret.length ? 'sent to the cloud' : 'sent, no private file',
    )
  } else {
    result = el('span', { class: 'mx-muted' }, 'done')
  }

  return el(
    'li',
    {},
    el('code', { class: 'pb-call' }, c.name),
    what ? el('span', { class: 'mx-small mx-muted' }, ` ${what}`) : null,
    ' → ',
    result,
  )
}

function statusOf(job) {
  if (job.state === 'failed') {
    return el('span', { class: 'mx-bad mx-small' }, 'request failed')
  }
  if (job.state !== 'done') {
    return el(
      'span',
      {
        class: `mx-muted mx-small${job.state === 'running' ? ' pb-pulse' : ''}`,
      },
      job.state === 'running' ? 'running…' : 'waiting',
    )
  }

  const r = job.result
  if (r.leaked.length) {
    return el(
      'b',
      { class: 'mx-bad mx-small' },
      `✗ ${plural(r.leaked.length, 'private file')} at the cloud`,
    )
  }
  if (r.log.refused.length) {
    return el(
      'b',
      { class: 'mx-good mx-small' },
      `✓ ${plural(r.log.refused.length, 'call')} refused, nothing sent`,
    )
  }

  return el('b', { class: 'mx-good mx-small' }, '✓ nothing private sent')
}

function runCard(job) {
  const r = job.result
  const calls = r ? r.steps.flatMap((s) => s.calls) : []

  return el(
    'article',
    { class: 'mx-panel pb-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el('b', {}, `${guardOf(job.guard).label} · run ${job.run}`),
      statusOf(job),
    ),
    job.state === 'failed'
      ? el('p', { class: 'mx-small mx-bad' }, job.error)
      : null,
    r
      ? [
          el('ol', { class: 'pb-calls' }, calls.map(callLine)),
          el(
            'div',
            { class: 'pb-answer' },
            el(
              'span',
              { class: 'mx-label' },
              r.end === 'answer' ? 'Answer' : 'Stopped',
            ),
            modelText(r.text),
          ),
          r.leaked.length
            ? el(
                'div',
                { class: 'pb-leaked mx-stack' },
                el(
                  'span',
                  { class: 'mx-label mx-bad' },
                  'What the cloud stub received',
                ),
                codeBlock(
                  r.leaked.map((f) => `${f.path}\n  ${f.text}`).join('\n\n'),
                ),
              )
            : null,
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el(
                'span',
                { class: 'mx-label' },
                `Requests and responses · ${plural(r.steps.length, 'step')}`,
              ),
              el('span', { class: 'mx-small mx-muted' }, usageText(r.usage)),
            ),
            el(
              'div',
              { class: 'pb-pad mx-stack' },
              r.steps.map((s) =>
                el(
                  'div',
                  { class: 'mx-stack pb-step' },
                  el(
                    'span',
                    { class: 'mx-label' },
                    `Step ${s.number} · ${s.calls.length ? plural(s.calls.length, 'tool call') : 'text, no tool call'}`,
                  ),
                  s.calls.map((c) =>
                    el(
                      'div',
                      { class: 'mx-stack' },
                      el(
                        'code',
                        { class: 'pb-args' },
                        `${c.name} ${c.arguments}`,
                      ),
                      codeBlock(c.output),
                    ),
                  ),
                  requestResponse(s.request, s.response),
                ),
              ),
            ),
          ),
        ]
      : null,
  )
}

function renderRuns() {
  document.getElementById('runs-box').replaceChildren(...jobs.map(runCard))
}

// ── Totals ─────────────────────────────────────────────────────────────

const sentence = ({ lead, rest }) => [
  el('strong', {}, lead),
  rest ? ` ${rest}` : null,
]

function renderTotals() {
  const routing = summary?.routing.totals ?? []
  const hasModel = routing.some((t) => t.router === 'model')
  document.getElementById('route-result').hidden = !hasModel

  const routed = passes.filter((p) => p.state !== 'running').length
  // Before the first run, the empty state stays.
  if (passes.length) {
    headline.className =
      hasModel && routed === passes.length ? 'mx-lead' : 'mx-muted'
    if (routed < passes.length) {
      headline.textContent = `Routing… ${routed} of ${passes.length} ${passes.length === 1 ? 'pass' : 'passes'} done.`
    } else if (!hasModel) {
      headline.textContent =
        'No router pass returned, so there is nothing to compare.'
    } else {
      headline.replaceChildren(
        ...sentence(summary.routing.headline).filter(Boolean),
      )
    }
  }

  if (hasModel) {
    const list = (values) => values.join(', ')
    document
      .getElementById('route-totals-head')
      .replaceChildren(
        el(
          'tr',
          {},
          el('th', {}, ''),
          ...routing.map((t) =>
            el('th', { class: 'num' }, setup.routers[t.router]),
          ),
        ),
      )

    const rows = [
      [
        'Leaks, of 12 private',
        (t) =>
          el(
            'span',
            { class: t.leaks.some(Boolean) ? 'mx-bad' : '' },
            list(t.leaks),
          ),
        'pb-strong',
      ],
      ['Leaks with no sign in the text', (t) => list(t.unmarkedLeaks)],
      ['Over-blocks, of 12 public', (t) => list(t.overBlocks)],
      [
        'Cost, all passes',
        (t) => (t.router === 'rule' ? 'no model call' : cost(t.usage)),
      ],
    ]

    document
      .getElementById('route-totals')
      .replaceChildren(
        ...rows.map(([label, value, cls]) =>
          el(
            'tr',
            { class: cls ?? '' },
            el('td', {}, label),
            ...routing.map((t) => el('td', { class: 'num' }, value(t))),
          ),
        ),
      )
  }

  const agent = summary?.agent.totals ?? []
  document.getElementById('task-result').hidden = !agent.length
  if (agent.length) {
    document
      .getElementById('task-totals-head')
      .replaceChildren(
        el(
          'tr',
          {},
          el('th', {}, ''),
          ...agent.map((t) => el('th', { class: 'num' }, t.label)),
        ),
      )

    const rows = [
      [
        'Runs that sent private files to the cloud',
        (t) =>
          el(
            'span',
            { class: t.leakedRuns ? 'mx-bad' : '' },
            `${t.leakedRuns} of ${t.runs}`,
          ),
        'pb-strong',
      ],
      ['Runs that tried to', (t) => `${t.triedRuns} of ${t.runs}`],
      ['Calls the harness refused', (t) => String(t.refusedCalls)],
      ['Cost, all runs', (t) => cost(t.usage)],
    ]

    document
      .getElementById('task-totals')
      .replaceChildren(
        ...rows.map(([label, value, cls]) =>
          el(
            'tr',
            { class: cls ?? '' },
            el('td', {}, label),
            ...agent.map((t) => el('td', { class: 'num' }, value(t))),
          ),
        ),
      )

    const running = jobs.some(
      (j) => j.state === 'running' || j.state === 'waiting',
    )
    document
      .getElementById('task-headline')
      .replaceChildren(
        ...(running
          ? [
              `Running… ${jobs.filter((j) => j.state === 'done').length} of ${jobs.length} runs done.`,
            ]
          : sentence(summary.agent.headline).filter(Boolean)),
      )
  }
}

async function refreshSummary(id) {
  const next = await call('summary', {
    passes: [
      ...passes.filter((p) => p.result).map((p) => p.result.record),
      setup.rule && {
        router: 'rule',
        leaks: setup.rule.score.leaks,
        overBlocks: setup.rule.score.overBlocks,
        usage: null,
      },
    ],
    tasks: jobs.filter((j) => j.result).map((j) => j.result.record),
  })

  if (id === batch) {
    summary = next
  }
}

function render() {
  renderRequests()
  renderRouteRaw()
  renderTotals()
  renderRuns()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const provider = picker.value()
  const push = pushBox.checked
  const runs = Number(runsBox.value)

  passes = Array.from({ length: Number(passesBox.value) }, () => ({
    state: 'running',
    result: null,
  }))
  jobs = Array.from({ length: runs }, (_, i) =>
    setup.guards.map((g) => ({
      guard: g.id,
      run: i + 1,
      state: 'waiting',
      result: null,
      error: null,
    })),
  ).flat()

  summary = null
  runButton.disabled = true
  render()

  const settle = async (item, work) => {
    try {
      item.result = await work()
      item.state = 'done'
      await refreshSummary(id)
    } catch (error) {
      item.state = 'failed'
      item.error = error.message
      showError(notice, error)
    }

    if (id === batch) {
      render()
    }
  }

  let next = 0
  const worker = async () => {
    while (next < jobs.length && id === batch) {
      const job = jobs[next++]
      job.state = 'running'
      render()
      await settle(job, () =>
        call('task', { guard: job.guard, push, ...provider }),
      )
    }
  }

  try {
    // The passes run side by side with the agent runs.
    await Promise.all([
      ...passes.map((p) => settle(p, () => call('route', provider))),
      ...Array.from({ length: PARALLEL }, worker),
    ])
  } finally {
    if (id === batch) {
      runButton.disabled = false
      render()
    }
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// The estimate follows the settings until the first run.
passesBox.addEventListener('change', () => batch || renderEmpty())
runsBox.addEventListener('change', () => batch || renderEmpty())
runButton.addEventListener('click', start)

renderEmpty()
render()
