import { call, codeBlock, debounce, el } from '../../kit/kit.js'

const FORMATS = [
  ['chatml', 'ChatML'],
  ['harmony', 'Harmony'],
]
const SEPARATORS = [
  ['newline', 'Line break'],
  ['im_sep', '<|im_sep|>'],
]

const {
  messages: DEFAULTS,
  toolMessages: TOOL_EXAMPLE,
  roles: ROLES,
  roleLabels: ROLE_LABELS,
  toolRoles: TOOL_ROLES,
  maxMessages,
  maxContent,
} = await call('defaults')
const PLACEHOLDERS = {
  tool_call: 'The arguments, as JSON',
  tool: 'What the tool returned',
}
const list = document.getElementById('messages')
const tokensBox = document.getElementById('tokens')
const notice = document.getElementById('notice')
const showIds = document.getElementById('show-ids')
const openTurn = document.getElementById('open')

let messages = structuredClone(DEFAULTS)
let format = 'chatml'
let separator = 'newline'
let last = null

// ── The message editor ─────────────────────────────────────────────────

function move(i, by) {
  const j = i + by
  if (j < 0 || j >= messages.length) {
    return
  }

  ;[messages[i], messages[j]] = [messages[j], messages[i]]
  renderEditor()
  update()
}

function renderEditor() {
  list.replaceChildren(
    ...messages.map((m, i) => {
      const role = el(
        'select',
        {
          class: 'mx-select ct-role',
          'aria-label': `Role of message ${i + 1}`,
        },
        ROLES.map((r) =>
          el('option', { value: r, selected: r === m.role }, ROLE_LABELS[r]),
        ),
      )

      role.addEventListener('change', () => {
        m.role = role.value
        // A tool call or a result needs the tool's name: start with the one before it.
        if (TOOL_ROLES.includes(m.role) && !m.name) {
          m.name =
            messages
              .slice(0, i)
              .reverse()
              .find((x) => x.name)?.name ?? 'get_weather'
        }
        renderEditor()
        update()
      })

      // The tool's name, under the role, for a tool call or a tool result.
      const name = TOOL_ROLES.includes(m.role)
        ? el('input', {
            class: 'mx-input mx-input--small ct-name',
            value: m.name ?? '',
            spellcheck: 'false',
            autocomplete: 'off',
            placeholder: 'tool name',
            'aria-label': `Tool name of message ${i + 1}`,
          })
        : null
      name?.addEventListener('input', () => {
        m.name = name.value.trim()
        update()
      })

      const text = el('textarea', {
        class: 'mx-textarea ct-content',
        rows: 1,
        spellcheck: 'false',
        maxlength: maxContent,
        placeholder: PLACEHOLDERS[m.role] ?? '',
        'aria-label': `Message ${i + 1}`,
      })
      text.value = m.content
      text.addEventListener('input', () => {
        m.content = text.value
        update()
      })

      return el(
        'li',
        { class: 'ct-message', 'data-message': i },
        el('div', { class: 'ct-who' }, role, name),
        text,
        el(
          'div',
          { class: 'ct-tools' },
          el(
            'button',
            {
              class: 'mx-btn mx-btn--small',
              type: 'button',
              title: 'Move up',
              'aria-label': 'Move up',
              disabled: i === 0,
              onclick: () => move(i, -1),
            },
            '↑',
          ),
          el(
            'button',
            {
              class: 'mx-btn mx-btn--small',
              type: 'button',
              title: 'Move down',
              'aria-label': 'Move down',
              disabled: i === messages.length - 1,
              onclick: () => move(i, 1),
            },
            '↓',
          ),
          el(
            'button',
            {
              class: 'mx-btn mx-btn--small',
              type: 'button',
              title: 'Remove',
              'aria-label': 'Remove',
              onclick: () => {
                messages.splice(i, 1)
                renderEditor()
                update()
              },
            },
            '×',
          ),
        ),
      )
    }),
  )

  const full = messages.length >= maxMessages
  document.getElementById('add').disabled = full
  document.getElementById('limit').textContent = full
    ? `Up to ${maxMessages} messages.`
    : ''
}

// ── The rendered tokens ────────────────────────────────────────────────

// Spaces show as a faint dot. A line break is a token too: a faint ↵.
const visible = (text) =>
  [...text].map((ch) =>
    ch === ' '
      ? el('span', { class: 'ct-sp' }, '·')
      : ch === '\n'
        ? el('span', { class: 'ct-nl' }, '↵')
        : ch,
  )

function tokenNode(token, shade) {
  const kind = token.kind
  return el(
    'span',
    {
      class: `ct-tk ct-tk--${kind}${kind === 'content' && shade ? ' ct-tk--alt' : ''}`,
      title: `Token ID ${token.id} · ${kind === 'header' ? 'format text' : kind === 'special' ? 'special token' : 'your content'}`,
    },
    el(
      'span',
      { class: 'ct-text' },
      kind === 'special' ? token.text : visible(token.text),
    ),
    showIds.checked ? el('span', { class: 'ct-id' }, String(token.id)) : null,
  )
}

// One row per message: its tokens on the left, the chat message on the right,
// as in the lesson figure. The open assistant turn is the last row.
function renderTokens(result) {
  const rows = new Map()
  for (const token of result.tokens) {
    const key = token.message ?? 'open'
    if (!rows.has(key)) {
      rows.set(key, [])
    }
    rows.get(key).push(token)
  }

  const heads = [...tokensBox.querySelectorAll('.ct-col-head')]
  const nodes = []
  let shade = 0

  for (const [key, tokens] of rows) {
    const open = key === 'open'
    const stream = el(
      'div',
      { class: 'ct-stream' },
      tokens.map((t) => tokenNode(t, t.kind === 'content' ? shade++ % 2 : 0)),
      open && openTurn.checked
        ? el('span', { class: 'ct-next' }, 'next token')
        : null,
    )

    const message = open ? null : messages[key]
    const who = !message
      ? ''
      : message.role === 'tool_call'
        ? `assistant · calls ${message.name}`
        : message.role === 'tool'
          ? `tool · ${message.name}`
          : message.role
    const chat = el(
      'div',
      { class: `ct-chat${open ? ' ct-chat--open' : ''}` },
      el('span', { class: 'mx-label' }, open ? 'assistant · writing' : who),
      open
        ? el('span', { class: 'ct-writing' }, 'The model continues from here.')
        : message?.content
          ? el('p', { class: 'ct-said' }, message.content)
          : el('p', { class: 'ct-said mx-muted' }, '(empty)'),
    )

    nodes.push(
      el('div', { class: 'ct-row', 'data-message': key }, stream, chat),
    )
  }

  tokensBox.replaceChildren(...heads, ...nodes)

  // Each special token's ID, once, instead of under every copy.
  const specials = new Map(
    result.tokens
      .filter((t) => t.kind === 'special')
      .map((t) => [t.text, t.id]),
  )

  const ids = [...specials].flatMap(([text, id], i) => [
    ...(i ? [' · '] : []),
    el('code', {}, text),
    ` ${id}`,
  ])

  document
    .getElementById('key')
    .replaceChildren(
      ...(ids.length ? ['Special token IDs: ', ...ids, '. '] : []),
      'Hover a token to see its ID.',
    )
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// Text that looks like a special token, such as <|im_end|>, typed into a message.
const SPECIAL_LIKE = /<\|[^|<>\s]+\|>/

// The finding first: a typed special token, then what the chat format costs.
function headline(result) {
  const { total, content, wrapper, special } = result.counts
  const share = total
    ? ` (${Math.round((wrapper / total) * 100)}% of the text)`
    : ''

  const counts = [
    `${plural(messages.length, 'message')} → one text of ${plural(total, 'token')}.`,
    ` Your content is ${plural(content, 'token')}. The ${result.label} format adds ${plural(wrapper, 'token')}${share}. ${special} of them are special tokens.`,
  ]

  const typed = messages.findIndex((m) => SPECIAL_LIKE.test(m.content))
  if (typed < 0) {
    return counts
  }

  // The typed text stays content: count the ordinary tokens of that message.
  const ordinary = result.tokens.filter(
    (t) => t.message === typed && t.kind === 'content',
  ).length

  return [
    `You typed `,
    el('code', {}, messages[typed].content.match(SPECIAL_LIKE)[0]),
    ` in message ${typed + 1}. `,
    `The text of message ${typed + 1} is ${plural(ordinary, 'ordinary token')} and no special token. A user cannot end their own turn. `,
    ...counts,
  ]
}

function render() {
  if (!last) {
    return
  }

  const result = last[format]
  document.getElementById('headline').replaceChildren(...headline(result))
  document
    .getElementById('encoding-note')
    .replaceChildren(
      'Tokenizer ',
      el('code', {}, result.encoding),
      ` (${result.usedBy}).`,
    )

  renderTokens(result)

  // The headline shows this format; one line names the other one.
  const other = last[FORMATS.find(([name]) => name !== format)[0]]
  document.getElementById('compare').textContent =
    `In ${other.label}, the same messages take ${plural(other.counts.total, 'token')}: ${other.counts.content} of content and ${other.counts.wrapper} of format text.`

  document.getElementById('raw-title').textContent =
    `Rendered text · ${result.text.length} characters`
  document.getElementById('raw').replaceChildren(codeBlock(result.text))
  document.getElementById('sep-row').hidden = format !== 'chatml'
}

const update = debounce(async () => {
  try {
    last = await call('render', { messages, separator, open: openTurn.checked })
    render()
    notice.replaceChildren()
  } catch (error) {
    notice.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'Cannot render'),
        el('p', {}, error.message),
      ),
    )
  }
}, 100)

// ── Controls ───────────────────────────────────────────────────────────

function segment(container, options, current, onPick) {
  container.append(
    ...options.map(([value, label]) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event) => {
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }
            onPick(value)
          },
        },
        label,
      ),
    ),
  )
}

segment(document.getElementById('formats'), FORMATS, format, (value) => {
  format = value
  render()
})

segment(document.getElementById('seps'), SEPARATORS, separator, (value) => {
  separator = value
  update()
})

openTurn.addEventListener('change', update)
showIds.addEventListener('change', render)

document.getElementById('add').addEventListener('click', () => {
  // Alternate user and assistant, the way a thread grows.
  const role = messages.at(-1)?.role === 'user' ? 'assistant' : 'user'
  messages.push({ role, content: '' })
  renderEditor()
  list.lastElementChild?.querySelector('textarea')?.focus()
  update()
})

document.getElementById('reset').addEventListener('click', () => {
  messages = structuredClone(DEFAULTS)
  renderEditor()
  update()
})

document.getElementById('tool-example').addEventListener('click', () => {
  messages = structuredClone(TOOL_EXAMPLE)
  renderEditor()
  update()
})

// Hover a row: mark the same message in the editor.
tokensBox.addEventListener('mouseover', (event) => {
  const which = event.target.closest('.ct-row')?.dataset.message
  for (const node of document.querySelectorAll('[data-message]')) {
    node.classList.toggle(
      'ct-same',
      which !== undefined && node.dataset.message === which,
    )
  }
})

tokensBox.addEventListener('mouseleave', () => {
  for (const node of document.querySelectorAll('.ct-same')) {
    node.classList.remove('ct-same')
  }
})

renderEditor()
update()
