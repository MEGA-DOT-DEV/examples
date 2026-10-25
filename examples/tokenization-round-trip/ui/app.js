import { call, codeBlock, debounce, el, showError } from '../../kit/kit.js'

const PRESETS = [
  ['Greeting', 'Hey, how are you?'],
  ['Polish', 'Cześć, jak się masz? Dzień dobry!'],
  ['Code', 'function add(a, b) {\n  return a + b\n}'],
  ['Numbers', 'In 2026, 1234567 people paid $19.99.'],
  ['Emoji', 'Hi 🦄! Ship it 🚀'],
  ['Japanese', '東京タワーに行きます'],
]
const TINTS = [
  'var(--mx-tint-1)',
  'var(--mx-tint-2)',
  'var(--mx-tint-3)',
  'var(--mx-tint-4)',
]

const text = document.getElementById('text')
const tokensBox = document.getElementById('tokens')
let encoding = 'cl100k_base'

// Spaces, tabs and line breaks are part of tokens. Make them visible.
function visible(value) {
  return [...value].map((ch) => {
    if (ch === ' ') {
      return el('span', { class: 'tk-sp' }, '·')
    }
    if (ch === '\n') {
      return el('span', { class: 'tk-sp' }, '↵')
    }
    if (ch === '\t') {
      return el('span', { class: 'tk-sp' }, '→')
    }

    return ch
  })
}

function renderTokens(result) {
  const nodes = []
  result.tokens.forEach((token, i) => {
    const parts = token.parts.map((part) =>
      part.type === 'text'
        ? visible(part.value)
        : el(
            'span',
            {
              class: 'tk-bytes',
              title: 'Bytes of a character that this token splits',
            },
            part.value,
          ),
    )
    const done = token.completes
      ? el('span', { class: 'tk-done' }, `=${token.completes}`)
      : null

    nodes.push(
      el(
        'span',
        {
          class: 'tk',
          'data-id': token.id,
          title: `Token ${i + 1} · ID ${token.id} · bytes ${token.hex}`,
          style: { '--tint': TINTS[i % TINTS.length] },
        },
        el('span', { class: 'tk-text' }, parts, done),
        el('span', { class: 'tk-id' }, String(token.id)),
      ),
    )

    // Keep the line breaks of the text.
    if (
      token.parts.some(
        (part) => part.type === 'text' && part.value.endsWith('\n'),
      )
    ) {
      nodes.push(el('span', { class: 'tk-break' }))
    }
  })

  tokensBox.replaceChildren(...nodes)
}

const plural = (n, word) =>
  `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

// The finding first: how many tokens this text takes, and whether the IDs decode back to it.
function headline(result) {
  if (!result.characters) {
    return 'Type a sentence. The page counts the tokens as you type. It runs locally and costs nothing.'
  }

  // Bytes matter only when a character takes more than one byte (Polish, emoji, Japanese).
  const bytes =
    result.bytes === result.characters
      ? ''
      : ` (${plural(result.bytes, 'byte')})`
  const back = result.roundTrip
    ? 'Decoding the IDs gives back the same text.'
    : 'Decoding the IDs does not give back the same text.'

  return `${plural(result.characters, 'character')}${bytes} → ${plural(result.ids.length, 'token')}. ${back}`
}

function render(result) {
  document.getElementById('headline-text').textContent = headline(result)
  document.getElementById('used-by').textContent = `Used by ${result.usedBy}.`
  renderTokens(result)

  // Explain the byte boxes, with the first split character of this text.
  const split = result.tokens.find((token) =>
    token.parts.some((part) => part.type !== 'text'),
  )
  const done = result.tokens.find((token) => token.completes)
  const note = document.getElementById('split-note')
  note.hidden = !split
  if (split) {
    note.replaceChildren(
      'A box like ',
      el(
        'span',
        { class: 'tk-bytes' },
        split.parts.find((part) => part.type !== 'text').value,
      ),
      ' holds bytes of one character that the tokens split.',
      ...(done
        ? [
            ' The token marked ',
            el('span', { class: 'tk-done' }, `=${done.completes}`),
            ' completes the character.',
          ]
        : []),
    )
  }

  document.getElementById('ids-title').textContent =
    `Token IDs as one list · ${plural(result.ids.length, 'ID')}`
  document
    .getElementById('ids')
    .replaceChildren(codeBlock(`[${result.ids.join(', ')}]`, 'json'))
}

const update = debounce(async () => {
  const notice = document.getElementById('notice')
  try {
    render(await call('tokenize', { text: text.value, encoding }))
    showError(notice, null)
  } catch (e) {
    showError(notice, e)
  }
}, 120)

// Same ID elsewhere in the text: outline it too.
tokensBox.addEventListener('mouseover', (event) => {
  const id = event.target.closest('.tk')?.dataset.id
  for (const node of tokensBox.querySelectorAll('.tk')) {
    node.classList.toggle('same', id !== undefined && node.dataset.id === id)
  }
})

tokensBox.addEventListener('mouseleave', () => {
  for (const node of tokensBox.querySelectorAll('.same')) {
    node.classList.remove('same')
  }
})

document.getElementById('presets').append(
  ...PRESETS.map(([label, sample]) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        onclick: () => {
          text.value = sample
          update()
        },
      },
      label,
    ),
  ),
)

const seg = document.getElementById('encodings')
for (const { name } of await call('encodings')) {
  seg.append(
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(name === encoding),
        onclick: (event) => {
          encoding = name
          for (const b of seg.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
          update()
        },
      },
      name,
    ),
  )
}

text.addEventListener('input', update)
update()
