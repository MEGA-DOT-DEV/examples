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

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const result = document.getElementById('result')
const questionBox = document.getElementById('question')
const { parts, question, maxQuestion } = await call('setup')

// One fold per part. The summary says where the part sits in the request, and how big it is.
document.getElementById('parts').append(
  ...parts.map((part) => {
    const [field, ...place] = part.where.split(', ')
    const block = codeBlock(part.text, part.lang)
    if (!part.lang) {
      block.setAttribute('data-wrap', '')
    }

    return el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, part.title),
        el(
          'span',
          { class: 'mx-hint' },
          el('code', {}, field),
          place.length ? `, ${place.join(', ')}` : '',
          ` · ${part.size}`,
        ),
      ),
      block,
    )
  }),
)

questionBox.value = question
questionBox.maxLength = maxQuestion
result.replaceChildren(
  el(
    'p',
    { class: 'mx-muted' },
    'Press Ask the agent. One request, under 1 cent with the default model.',
  ),
)

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

/** The real parts as a checklist: the word that shows the answer covers a part, or a miss. */
function checklist(described) {
  return el(
    'aside',
    { class: 'mx-stack' },
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, 'Parts in the answer'),
      el('p', {}, 'Each real part, and the word in the answer that covers it.'),
    ),
    el(
      'ul',
      { class: 'sr-checklist' },
      ...described.map((part) =>
        el(
          'li',
          {},
          part.word
            ? el('span', { class: 'mx-good', 'aria-label': 'described' }, '✓')
            : el('span', { class: 'mx-bad', 'aria-label': 'missed' }, '✗'),
          el('span', {}, part.title),
          el(
            'span',
            { class: 'mx-hint' },
            part.word ? `“${part.word}”` : 'not found in the answer',
          ),
        ),
      ),
    ),
    el(
      'p',
      { class: 'mx-hint' },
      'Code looks for the name of a part, or a fact that only this part holds. A found word is a hint, not proof: read the answer.',
    ),
  )
}

async function ask() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  if (!questionBox.value.trim()) {
    return result.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        'Write a question first, then press Ask the agent.',
      ),
    )
  }

  showError(notice, null)
  result.replaceChildren(
    el('p', { class: 'mx-muted' }, 'Waiting for the answer…'),
  )

  try {
    const answer = await busy(button, 'Asking…', () =>
      call('askAgent', { ...picker.value(), question: questionBox.value }),
    )

    result.replaceChildren(
      el(
        'div',
        { class: 'sr-result' },
        el(
          'section',
          { class: 'mx-stack' },
          el(
            'div',
            { class: 'mx-section-head' },
            el('h3', { class: 'mx-h3' }, "The agent's answer"),
            el('p', {}, `${answer.model} · ${usageText(answer.usage)}`),
          ),
          answer.answer
            ? modelText(answer.answer)
            : el(
                'p',
                { class: 'mx-muted' },
                'The answer has no text. Open the response below to see why.',
              ),
        ),
        checklist(answer.parts),
      ),
      el(
        'div',
        { class: 'mx-callout' },
        el(
          'p',
          {},
          'Use it on your own agent: a missing tool, an old memory note or a rule it does not mention is a fix for your setup.',
        ),
      ),
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'Request and response'),
          el('span', { class: 'mx-hint' }, 'the full context, as JSON'),
        ),
        el(
          'div',
          { class: 'sr-fold' },
          requestResponse(answer.request, answer.response),
        ),
      ),
    )
  } catch (error) {
    showError(notice, error)
    result.replaceChildren(
      el('p', { class: 'mx-muted' }, 'No answer. Read the message above.'),
    )
  }
}

button.addEventListener('click', ask)
questionBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    ask()
  }
})
