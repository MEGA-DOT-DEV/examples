import {
  call,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const info = await call('setup')
const choice = document.getElementById('question')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const empty = document.getElementById('empty')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const METHODS = [
  ['procedure', '50-line procedure'],
  ['goal', 'Short goal'],
]
const EMPTY = 'Press Run. 6 requests, under 1 cent.'
empty.textContent = EMPTY
document.getElementById('intro').textContent =
  `The 50-line procedure summarizes each of the ${info.chunks.length} chunks, then answers from the summaries. The short goal sends all chunks in one request. Code checks both answers.`
document
  .getElementById('chunks')
  .replaceChildren(...info.chunks.map((chunk) => el('li', {}, chunk.name)))

// The question that needs a join across two chunks shows the effect best, so it is the default.
choice.append(
  ...info.questions.map((question) =>
    el(
      'option',
      { value: question.id, selected: question.id === 'escalation' },
      `${question.label} · ${question.prompt}`,
    ),
  ),
)
function updateQuestion() {
  document.getElementById('question-text').textContent =
    `Source: ${info.questions.find((item) => item.id === choice.value).source}`
}

choice.addEventListener('change', updateQuestion)
updateQuestion()

function render(result) {
  const { question, headline } = result
  document
    .getElementById('headline')
    .replaceChildren(el('strong', {}, headline.lead), ` ${headline.rest}`)

  const rows = [
    [
      'Answer',
      (run) =>
        el(
          'code',
          {},
          run.answer ? JSON.stringify(run.answer) : 'no valid JSON',
        ),
    ],
    [
      'Correct',
      (run) =>
        el(
          'span',
          { class: run.correct ? 'mx-good' : 'mx-bad' },
          run.correct ? 'yes' : 'no',
        ),
    ],
    ['Requests', (run) => String(run.calls.length)],
    ['Tokens and cost', (run) => usageText(run.usage)],
    ['Time', (run) => `${(run.ms / 1000).toFixed(1)} s`],
  ]

  document.getElementById('table-head').replaceChildren(
    el(
      'tr',
      {},
      el('th', {}, ''),
      METHODS.map(([, label]) => el('th', {}, label)),
    ),
  )

  document.getElementById('table').replaceChildren(
    ...rows.map(([label, cell]) =>
      el(
        'tr',
        {},
        el('td', {}, label),
        METHODS.map(([id]) => el('td', {}, cell(result[id]))),
      ),
    ),
  )

  document
    .getElementById('note')
    .replaceChildren(
      'Code compares each answer with the answer key: ',
      el('code', {}, JSON.stringify(question.expected)),
      '.',
    )

  document.getElementById('calls').replaceChildren(
    ...METHODS.map(([id, label]) =>
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'h3',
          { class: 'mx-h3' },
          `${label} · ${result[id].calls.length === 1 ? '1 request' : `${result[id].calls.length} requests`}`,
        ),
        result[id].calls.map((step) =>
          el(
            'div',
            { class: 'mx-stack hg-step' },
            el(
              'div',
              { class: 'mx-spread' },
              el('span', { class: 'mx-label' }, step.step),
              el(
                'span',
                { class: 'mx-muted mx-small' },
                `${usageText(step.usage)}${step.status === 'completed' ? '' : ` · ${step.status}`}`,
              ),
            ),
            modelText(step.text || '(No text returned)'),
            requestResponse(step.request, step.response),
          ),
        ),
      ),
    ),
  )

  document.getElementById('results').hidden = false
  document.getElementById('evidence').hidden = false
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  showError(notice, null)
  empty.hidden = false
  empty.textContent = `The procedure summarizes ${info.chunks.length} chunks and answers. Then the short goal answers from the same chunks…`
  document.getElementById('results').hidden = true
  document.getElementById('evidence').hidden = true

  try {
    const result = await call('run', {
      question: choice.value,
      ...picker.value(),
    })
    empty.hidden = true
    render(result)
  } catch (error) {
    showError(notice, error)
    empty.textContent = EMPTY
  } finally {
    button.disabled = false
  }
})
