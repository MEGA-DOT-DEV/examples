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

const setup = await call('setup')
const { trace } = setup

// ── More settings: one provider and model for both buttons ─────────────
const settings = document.getElementById('settings-summary')
const picker = await providerPicker(document.getElementById('picker'), {
  onChange: showModel,
})
function showModel() {
  const { provider, model } = picker.value()
  const current = picker.providers().find((p) => p.id === provider)
  settings.textContent = current
    ? `More settings: ${model ?? current.model} on ${current.name}`
    : 'More settings: add a key first'
}
showModel()
if (!picker.hasKey()) {
  missingKeyNote(document.getElementById('notice'))
}

// ── Details: the evidence, folded at the bottom ────────────────────────
// One block per action: a plain title, then what it sent and got back.
const block = (title, ...children) => [
  el('h3', { class: 'mx-h3' }, title),
  ...children,
]
const fold = (title, value) =>
  el(
    'details',
    { class: 'mx-details' },
    el('summary', {}, el('span', { class: 'mx-label' }, title)),
    codeBlock(prettyJson(value), 'json'),
  )
const usage = (model, value) =>
  el(
    'p',
    { class: 'sr-note' },
    `${model}: ${usageText(value).replaceAll(' · ', ', ')}`,
  )
const args = (json) => {
  try {
    return Object.entries(JSON.parse(json))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ')
  } catch {
    return json
  }
}
document
  .getElementById('trace-details')
  .replaceChildren(
    ...block('The recorded run, step 1', fold('Request sent', trace.request)),
  )

// ── 1. The recorded run failed ─────────────────────────────────────────
const titles = (JSON.parse(trace.result).results ?? [])
  .map((item) => `“${item.title}”`)
  .join(', ')
document.getElementById('trace-steps').replaceChildren(
  el(
    'li',
    {},
    el('span', { class: 'sr-label' }, 'User'),
    el('p', {}, trace.question),
  ),
  el(
    'li',
    {},
    el('span', { class: 'sr-label' }, 'Step 1'),
    el(
      'div',
      { class: 'sr-call' },
      // The one real failure on the page, so the one red item.
      el(
        'code',
        { class: 'mx-bad' },
        `${trace.call.name}(${args(trace.call.arguments)})`,
      ),
      el('p', { class: 'sr-note' }, `Results: ${titles || trace.result}`),
    ),
  ),
  el(
    'li',
    {},
    el('span', { class: 'sr-label' }, 'Step 2'),
    modelText(trace.answer),
  ),
)

// ── 2. Ask the agent why ───────────────────────────────────────────────
document.getElementById('why-question').textContent =
  `The agent gets its recorded run and one question: “${setup.why}”`
const whyButton = document.getElementById('why')
const whyNotice = document.getElementById('why-notice')

whyButton.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(whyNotice)
  }

  showError(whyNotice, null)
  try {
    const answer = await busy(whyButton, 'Asking…', () =>
      call('why', picker.value()),
    )

    document
      .getElementById('why-result')
      .replaceChildren(modelText(answer.answer, 'mx-output sr-answer'))
    document
      .getElementById('why-details')
      .replaceChildren(
        ...block(
          'Ask the agent why',
          usage(answer.model, answer.usage),
          requestResponse(answer.request, answer.response),
        ),
      )
  } catch (error) {
    showError(whyNotice, error)
  }
})

// ── 3. Check the answer: replay step 1 both ways ───────────────────────
const box = document.getElementById('instructions')
const reset = document.getElementById('reset')
const runButton = document.getElementById('run')
const runNotice = document.getElementById('run-notice')
const verdict = document.getElementById('verdict')
document.getElementById('recorded').textContent = trace.request.instructions
box.value = setup.edited
box.maxLength = setup.maxInstructions
// Reset shows only after the learner changes the edit.
box.addEventListener('input', () => {
  reset.hidden = box.value === setup.edited
})
reset.addEventListener('click', () => {
  box.value = setup.edited
  reset.hidden = true
})

runButton.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(runNotice)
  }
  if (!box.value.trim()) {
    return showError(
      runNotice,
      new Error('Write some instructions first, or press Reset the edit.'),
    )
  }

  showError(runNotice, null)
  try {
    const result = await busy(runButton, 'Replaying…', () =>
      call('run', { instructions: box.value, ...picker.value() }),
    )

    const sides = [
      ['Recorded', result.recorded, 'recorded-result'],
      ['Your edit', result.edited, 'edited-result'],
    ]
    for (const [, side, id] of sides) {
      document.getElementById(id).textContent =
        `Searched the web in ${side.searches} of ${setup.replays} replays`
    }
    verdict.textContent = result.verdict
    verdict.hidden = false

    // Every replay on one side sends the same request, so it shows once, then the 5 responses in order.
    document.getElementById('run-details').replaceChildren(
      ...block(
        'Replay step 1',
        usage(result.model, result.usage),
        ...sides.map(([name, side]) =>
          el(
            'div',
            { class: 'mx-stack' },
            el(
              'p',
              { class: 'sr-label' },
              `${name}: what each replay did first`,
            ),
            el(
              'ol',
              { class: 'sr-list' },
              ...side.firsts.map((first) =>
                el(
                  'li',
                  {},
                  first.kind === 'text' || first.kind === 'nothing'
                    ? first.detail
                    : el('code', {}, `${first.kind}(${args(first.detail)})`),
                ),
              ),
            ),
            fold('Request sent', side.requests[0].request),
            fold(
              'Responses received',
              side.requests.map((pair) => pair.response),
            ),
          ),
        ),
      ),
    )
  } catch (error) {
    showError(runNotice, error)
  }
})
