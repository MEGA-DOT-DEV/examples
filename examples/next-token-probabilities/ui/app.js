import {
  busy,
  call,
  el,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const PRESETS = [
  'Have a nice',
  "It's Friday afternoon. Have a nice",
  'The capital of France is',
  'Once upon a',
]
const TOPS = [5, 10, 20]

const promptBox = document.getElementById('prompt')
const button = document.getElementById('predict')
const notice = document.getElementById('notice')
let top = 10
// The text you typed, and the tokens you added by clicking candidates.
let base = promptBox.value
let added = []

const visible = (token) =>
  [...token].map((ch) =>
    ch === ' '
      ? el('span', { class: 'sp' }, '·')
      : ch === '\n'
        ? el('span', { class: 'sp' }, '↵')
        : ch,
  )
const pct = (p) => `${(p * 100).toFixed(p < 0.001 ? 2 : 1)}%`
const quoted = (token) => el('code', {}, JSON.stringify(token))
// The end of a long text is the part that decides the next token.
const shortText = (text) =>
  JSON.stringify(text.length > 60 ? `…${text.slice(-60)}` : text)

function showNotice(title, ...text) {
  notice.replaceChildren(
    el(
      'div',
      { class: 'mx-callout mx-callout--warn' },
      el('span', { class: 'mx-label' }, title),
      el('p', {}, ...text),
    ),
  )
}

function setPrompt(text) {
  base = text
  added = []
  promptBox.value = text
  renderTrail()
}

function renderTrail() {
  document.getElementById('trail-box').hidden = added.length === 0
  document
    .getElementById('trail')
    .replaceChildren(base, ...added.map((token) => el('mark', {}, token)))
}

// The finding first: the most likely token, and the one the model picked.
function renderHeadline(result) {
  const [best] = result.candidates
  const picked = result.chosen
  const tail = !picked
    ? []
    : picked.token === best.token
      ? [' The model picked this token.']
      : [
          ' The model picked ',
          quoted(picked.token),
          ` (${pct(picked.probability)}) instead.`,
        ]

  document
    .getElementById('headline-text')
    .replaceChildren(
      `After ${shortText(result.prompt)}, the most likely next token is `,
      quoted(best.token),
      ` at ${pct(best.probability)}.`,
      ...tail,
    )

  document.getElementById('headline').hidden = false
}

function render(result) {
  renderHeadline(result)

  const list = document.getElementById('candidates')
  list.replaceChildren(
    ...result.candidates.map((c, i) => {
      const picked = result.chosen && c.token === result.chosen.token
      return el(
        'li',
        {},
        el(
          'button',
          {
            class: `nt-row${picked ? ' picked' : ''}`,
            type: 'button',
            title: `logprob ${c.logprob.toFixed(4)} · click to add this token`,
            onclick: () => {
              added.push(c.token)
              promptBox.value = base + added.join('')
              renderTrail()
              predict()
            },
          },
          el('span', { class: 'nt-rank' }, String(i + 1)),
          el('span', { class: 'nt-token' }, visible(c.token)),
          el(
            'span',
            { class: 'nt-bar' },
            el('i', {
              style: { width: `${Math.max(0.5, c.probability * 100)}%` },
            }),
          ),
          el('span', { class: 'nt-pct' }, pct(c.probability)),
          picked
            ? el('span', { class: 'nt-picked' }, 'The model picked this token')
            : null,
        ),
      )
    }),
    el(
      'li',
      { class: 'nt-rest' },
      el('span'),
      el('span', {}, 'all other tokens'),
      el('span'),
      el('span', {}, pct(result.rest)),
    ),
  )

  if (result.candidates.length < result.requested) {
    list.append(
      el(
        'li',
        { class: 'nt-fewer' },
        `The API sent ${result.candidates.length} of the ${result.requested} candidates you asked for. Some models send fewer.`,
      ),
    )
  }

  document.getElementById('empty').hidden = true
  document.getElementById('result').hidden = false
  document.getElementById('meta').textContent =
    `${result.model} · ${result.ms} ms`

  document
    .getElementById('wrote')
    .replaceChildren(
      'The model wrote: ',
      el('code', {}, JSON.stringify(result.continuation)),
    )

  document.getElementById('spaces').hidden = !result.candidates.some((c) =>
    /[ \n]/.test(c.token),
  )

  const raw = document.getElementById('raw')
  raw.replaceChildren(requestResponse(result.request, result.response))
  raw.hidden = false
}

async function predict() {
  if (!promptBox.value.trim()) {
    return showNotice('No text', 'Type a text first.')
  }

  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  try {
    const result = await busy(button, 'Predicting…', () =>
      call('predict', { prompt: promptBox.value, top, ...picker.value() }),
    )
    render(result)
    notice.replaceChildren()
  } catch (error) {
    showError(notice, error)
  }
}

const picker = await providerPicker(document.getElementById('picker'), {
  purpose: 'logprobs',
})
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('tops').append(
  ...TOPS.map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === top),
        onclick: (event) => {
          top = n
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
        },
      },
      String(n),
    ),
  ),
)

document.getElementById('presets').append(
  ...PRESETS.map((text) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        onclick: () => {
          setPrompt(text)
          predict()
        },
      },
      text,
    ),
  ),
)

button.addEventListener('click', predict)
promptBox.addEventListener('input', () => {
  base = promptBox.value
  added = []
  renderTrail()
})
promptBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    predict()
  }
})
document.getElementById('undo').addEventListener('click', () => {
  added.pop()
  promptBox.value = base + added.join('')
  renderTrail()

  if (added.length) {
    predict()
  }
})
document
  .getElementById('reset')
  .addEventListener('click', () => setPrompt(base))
