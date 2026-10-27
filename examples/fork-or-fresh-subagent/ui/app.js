import {
  busy,
  call,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('provider'))
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const words = (text) => text.split(/\s+/).filter(Boolean).length

function sumUsage(list) {
  return list.reduce(
    (total, u) => ({
      inputTokens: total.inputTokens + u.inputTokens,
      outputTokens: total.outputTokens + u.outputTokens,
      reasoningTokens: total.reasoningTokens + u.reasoningTokens,
      cost: total.cost == null || u.cost == null ? null : total.cost + u.cost,
      costSource:
        total.costSource === 'estimate' || u.costSource === 'estimate'
          ? 'estimate'
          : u.costSource,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )
}

const exchange = (title, request, response) =>
  el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      el('span', { class: 'mx-small mx-muted' }, title),
    ),
    el('div', { class: 'ff-pad' }, requestResponse(request, response)),
  )

function card(run, result) {
  const checks = el(
    'ul',
    { class: 'ff-checks' },
    run.score.checks.map((check) =>
      el(
        'li',
        { class: check.kept ? 'ff-kept' : 'ff-missed' },
        el('span', {}, check.kept ? '✓' : '×', ` ${check.label}`),
        el(
          'span',
          { class: 'mx-small' },
          check.actual === null ? 'not stated' : String(check.actual),
          check.kept
            ? null
            : el(
                'span',
                { class: 'mx-muted' },
                ` · expected ${check.expected}`,
              ),
        ),
      ),
    ),
  )

  const plan = run.score.plan
    ? el(
        'ol',
        { class: 'ff-steps' },
        run.score.plan.steps.map((step) => el('li', {}, step)),
      )
    : el(
        'p',
        { class: 'mx-small mx-bad' },
        'No complete JSON plan with two steps, so no decision counts. The raw answer is in the response.',
      )

  const brief = run.mode === 'brief'

  return el(
    'article',
    { class: 'mx-panel ff-card' },
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, run.label),
      el('p', {}, run.description),
    ),
    el('p', { class: 'ff-score' }, `${run.score.kept} of 4 decisions kept`),
    checks,
    plan,
    el('p', { class: 'mx-small mx-muted' }, usageText(run.total)),
    brief
      ? el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el('span', { class: 'mx-label' }, 'Brief'),
            el(
              'span',
              { class: 'mx-small mx-muted' },
              `from the main model · ${words(result.brief)} words`,
            ),
          ),
          el(
            'div',
            { class: 'ff-pad ff-brief' },
            modelText(result.brief || '(empty brief)'),
          ),
        )
      : null,
    brief
      ? exchange('the brief', result.handoff.request, result.handoff.response)
      : null,
    exchange(brief ? 'the plan' : '1 request', run.request, run.response),
  )
}

// Short names keep the headline readable; the cards carry the full names.
const SHORT = {
  skill: 'skill',
  fork: 'fork',
  fresh: 'task only',
  brief: 'brief',
}

function headline(runs) {
  const kept = `Decisions kept, of 4: ${runs.map((r) => `${SHORT[r.mode]} ${r.score.kept}`).join(', ')}.`
  const fresh = runs.find((r) => r.mode === 'fresh')
  const missed = 4 - fresh.score.kept

  return fresh.score.valid && missed
    ? `${kept} The task-only subagent never saw the earlier turns and missed ${missed}.`
    : kept
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  await busy(button, 'Comparing…', async () => {
    showError(notice, null)
    try {
      const result = await call('run', picker.value())
      document.getElementById('empty').hidden = true
      document.getElementById('headline-text').textContent = headline(
        result.runs,
      )
      document
        .getElementById('cards')
        .replaceChildren(...result.runs.map((run) => card(run, result)))
      // The brief mode's total already holds the brief request, so this is all 5 requests.
      document
        .getElementById('meaning')
        .replaceChildren(
          "A subagent knows only what its request carries: the whole thread in a fork, the main model's text in a brief.",
          el('br'),
          `All 5 requests: ${usageText(sumUsage(result.runs.map((r) => r.total)))}`,
        )
      document.getElementById('result').hidden = false
    } catch (error) {
      showError(notice, error)
    }
  })
})

document
  .getElementById('constraints')
  .replaceChildren(...setup.constraints.map((text) => el('li', {}, text)))
document.getElementById('task').textContent = `Task: ${setup.task}`

if (!picker.hasKey()) {
  missingKeyNote(notice)
}
