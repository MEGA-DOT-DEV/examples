// The viewer: lists examples, skills and tools, and shows one at a time.
// Routes: #/ (home), #/<name>, #/<name>/<tab> with tab = try | guide | code.
import { copyText, el } from '../kit/kit.js'
import { retainedPages } from './retained-pages.js'

const KIND_LABEL = { example: 'Examples', skill: 'Skills', tool: 'Tools' }
const KIND_ONE = { example: 'Example', skill: 'Skill', tool: 'Tool' }
const TAB_LABEL = { try: 'Try it', guide: 'Guide', code: 'Code' }

const $ = (id) => document.getElementById(id)
const nav = $('nav')
const head = $('head')
const tabs = $('tabs')
const panel = $('panel')
const tryPages = retainedPages($('try-panel'))
const pager = $('pager')
const search = $('search')

let items = []
let docs = []
let lessons = []
let serverOutdated = false
let status = null
const details = new Map()
const docPages = new Map()
let route = { name: null, tab: null }

async function getJson(url) {
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`)
  }
  return data
}

// ── Sidebar ────────────────────────────────────────────────────────────
function keyMeta(item) {
  if (item.kind === 'skill') {
    return [el('span', {}, 'agent skill')]
  }
  const parts = [
    el('i', {
      class: item.keys.ready ? 'mx-dot' : 'mx-dot mx-dot--missing',
      'aria-hidden': 'true',
    }),
    el(
      'span',
      {},
      item.keys.ready
        ? item.keys.label === 'no key'
          ? 'no key'
          : 'key set'
        : 'needs key',
    ),
  ]
  if (item.ui) {
    parts.push(el('span', {}, '· interactive'))
  }
  return parts
}

/** One line about the setup: Node.js and how many keys are set. */
function setupMeta() {
  if (!status) {
    return []
  }
  const set = status.providers.filter((p) => p.set).length
  return [
    el('i', {
      class: status.nodeOk ? 'mx-dot' : 'mx-dot mx-dot--missing',
      'aria-hidden': 'true',
    }),
    el('span', {}, `${set} of ${status.providers.length} keys set`),
  ]
}

/** Docs first (Start here), then examples, skills and tools: the order of [ and ]. */
function sequence() {
  return [...docs, ...items]
}

function renderNav() {
  const query = search.value.trim().toLowerCase()
  const match = (item) =>
    !query ||
    `${item.name} ${item.title} ${item.summary}`.toLowerCase().includes(query)
  nav.replaceChildren()
  let shown = 0
  const startHere = docs.filter(match)
  if (startHere.length) {
    shown += startHere.length
    nav.append(
      el(
        'div',
        { class: 'vw-group' },
        el('span', { class: 'mx-label' }, 'Start here'),
        startHere.map((doc) =>
          el(
            'a',
            {
              class: 'vw-item',
              href: `#/${doc.name}`,
              'aria-current': doc.name === route.name ? 'page' : false,
            },
            el('span', { class: 'vw-item-title' }, doc.title),
            doc.status
              ? el('span', { class: 'vw-item-meta' }, setupMeta())
              : null,
          ),
        ),
      ),
    )
  }
  // Examples by lesson (lessons.json), in the course's order; the rest after them.
  const placed = new Set(lessons.flatMap((lesson) => lesson.items))
  for (const lesson of lessons) {
    const group = items.filter(
      (item) =>
        item.kind === 'example' &&
        lesson.items.includes(item.name) &&
        match(item),
    )
    if (!group.length) {
      continue
    }
    shown += group.length
    nav.append(lessonGroup(lesson, group, Boolean(query)))
  }
  for (const kind of ['example', 'skill', 'tool']) {
    const group = items.filter(
      (item) =>
        item.kind === kind &&
        !(kind === 'example' && placed.has(item.name)) &&
        match(item),
    )
    if (!group.length) {
      continue
    }
    shown += group.length
    nav.append(
      el(
        'div',
        { class: 'vw-group' },
        el(
          'span',
          { class: 'mx-label' },
          kind === 'example' && lessons.length
            ? 'More examples'
            : KIND_LABEL[kind],
        ),
        group.map(navItem),
      ),
    )
  }
  if (!shown) {
    nav.append(
      el(
        'p',
        { class: 'vw-empty' },
        query ? 'Nothing matches.' : 'No examples yet.',
      ),
    )
  }
}

function navItem(item) {
  return el(
    'a',
    {
      class: 'vw-item',
      href: `#/${item.name}`,
      'aria-current': item.name === route.name ? 'page' : false,
    },
    el('span', { class: 'vw-item-title' }, item.title),
    el('span', { class: 'vw-item-meta' }, keyMeta(item)),
  )
}

// Lesson groups fold. A closed group stays closed across visits (localStorage),
// but a search opens every group with a match, and the group of the page you
// are on is always open.
const CLOSED_KEY = 'mex-closed-lessons'
const closedLessons = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
    } catch {
      return []
    }
  })(),
)

function lessonGroup(lesson, group, searching) {
  const here = group.some((item) => item.name === route.name)
  const details = el('details', {
    class: 'vw-group vw-lesson',
    open: searching || here || !closedLessons.has(lesson.episode),
  })
  const summary = el(
    'summary',
    { class: 'vw-lesson-head', title: `${lesson.episode}: ${lesson.title}` },
    el(
      'span',
      { class: 'vw-lesson-line' },
      el('span', { class: 'mx-label' }, lesson.episode),
      el('span', { class: 'vw-lesson-count' }, String(group.length)),
    ),
    el('span', { class: 'vw-lesson-title' }, lesson.title),
  )
  // Only a click on the summary is your choice; opening by search or by the current page is not saved.
  summary.addEventListener('click', () => {
    if (details.open) {
      closedLessons.add(lesson.episode)
    } else {
      closedLessons.delete(lesson.episode)
    }
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify([...closedLessons]))
    } catch {}
  })
  details.append(
    summary,
    el('div', { class: 'vw-lesson-items' }, group.map(navItem)),
  )
  return details
}

// ── Header ─────────────────────────────────────────────────────────────
function keyChips(item) {
  if (item.kind === 'skill') {
    return []
  }
  const chip = (key) =>
    el(
      'span',
      {
        class: 'mx-chip mx-chip--static',
        title: key.set ? 'Set in .env' : 'Missing: run npx mex setup',
      },
      el('i', {
        class: key.set ? 'mx-dot' : 'mx-dot mx-dot--missing',
        'aria-hidden': 'true',
      }),
      key.name,
    )
  const chips = item.keys.needs.map(chip)
  if (item.keys.needsAny.length) {
    chips.push(
      el(
        'span',
        { class: 'mx-label' },
        item.keys.needs.length ? 'and one of' : 'One of',
      ),
      ...item.keys.needsAny.map(chip),
    )
  }
  if (!chips.length) {
    chips.push(
      el(
        'span',
        { class: 'mx-chip mx-chip--static' },
        el('i', { class: 'mx-dot', 'aria-hidden': 'true' }),
        'No API key needed',
      ),
    )
  }
  return chips
}

function commandBox(text) {
  const copy = el('button', { class: 'mx-copy', type: 'button' }, 'Copy')
  copy.addEventListener('click', () => copyText(text, copy))
  return el('div', { class: 'vw-cmd' }, el('code', {}, text), copy)
}

function renderHead(item) {
  const kicker = [KIND_ONE[item.kind]]
  if (item.ui) {
    kicker.push('Interactive')
  }
  // filter(Boolean): replaceChildren() would print a null child as "null".
  head.replaceChildren(
    ...[
      el(
        'div',
        { class: 'vw-kicker-row' },
        el('span', { class: 'mx-kicker' }, kicker.join(' · ')),
      ),
      el('h1', { class: 'mx-title' }, item.title),
      item.summary ? el('p', { class: 'mx-lead' }, item.summary) : null,
      el(
        'div',
        { class: 'vw-meta' },
        commandBox(item.run ?? item.install),
        el('div', { class: 'vw-keys' }, keyChips(item)),
      ),
    ].filter(Boolean),
  )
}

// ── Tabs and panels ────────────────────────────────────────────────────
const tabsFor = (item) =>
  item.ui ? ['try', 'guide', 'code'] : ['guide', 'code']

function renderTabs(item, tab) {
  tabs.replaceChildren(
    ...tabsFor(item).map((name) =>
      el(
        'button',
        {
          class: 'vw-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': String(name === tab),
          onclick: () => {
            location.hash = `#/${item.name}/${name}`
          },
        },
        TAB_LABEL[name],
      ),
    ),
  )
  tabs.hidden = false
}

function missingKeysNote(item) {
  if (item.keys.ready) {
    return null
  }
  const names = [
    ...item.keys.needs.filter((k) => !k.set),
    ...(item.keys.needsAny.length ? item.keys.needsAny : []),
  ].map((k) => k.name)
  const which =
    item.keys.needsAny.length && !item.keys.needs.some((k) => !k.set)
      ? `one of ${names.join(', ')}`
      : names.join(', ')
  return el(
    'div',
    { class: 'mx-callout mx-callout--warn' },
    el('span', { class: 'mx-label' }, 'Key needed'),
    el(
      'p',
      {},
      `This page calls a provider API with your key. Add ${which}: run `,
      el('code', {}, 'npx mex setup'),
      ' in a terminal. The page uses the new key without a restart.',
    ),
  )
}

function showTry(item) {
  const page = tryPages.show(item.name, () =>
    el(
      'div',
      { class: 'vw-panel' },
      el('iframe', {
        class: 'vw-frame',
        src: `ui/${item.name}/`,
        title: `${item.title}: interactive page`,
      }),
    ),
  )
  // Key status can change without a restart. Update the note, not the iframe.
  page.querySelector('.mx-callout')?.remove()
  const note = missingKeysNote(item)
  if (note) {
    page.prepend(note)
  }
  panel.hidden = true
}

function wireCopy(root) {
  for (const figure of root.querySelectorAll('figure.mx-code')) {
    const copy = el('button', { class: 'mx-copy', type: 'button' }, 'Copy')
    copy.addEventListener('click', () =>
      copyText(figure.querySelector('code').textContent, copy),
    )
    figure.append(copy)
  }
}

function showGuide(detail) {
  const article = el('article', { class: 'mx-prose' })
  article.innerHTML = detail.html
  wireCopy(article)
  panel.replaceChildren(article)
}

async function showCode(detail, wanted) {
  const files = detail.files
  const preferred = ['index.ts', 'api.ts', 'SKILL.md', 'README.md']
  const current =
    wanted && files.some((f) => f.path === wanted)
      ? wanted
      : (preferred.find((p) => files.some((f) => f.path === p)) ??
        files[0]?.path)
  const list = el(
    'div',
    { class: 'vw-files' },
    files.map((file) =>
      el(
        'button',
        {
          class: 'vw-file',
          type: 'button',
          'aria-current': String(file.path === current),
          onclick: () => showCode(detail, file.path),
        },
        file.path,
      ),
    ),
  )
  const view = el(
    'div',
    { class: 'vw-source' },
    el('p', { class: 'mx-label' }, 'Loading…'),
  )
  panel.replaceChildren(el('div', { class: 'vw-code' }, list, view))
  if (!current) {
    return view.replaceChildren(el('p', { class: 'mx-muted' }, 'No files.'))
  }
  try {
    const { text, html } = await getJson(
      `api/items/${detail.name}/file?path=${encodeURIComponent(current)}`,
    )
    const copy = el('button', { class: 'mx-copy', type: 'button' }, 'Copy')
    copy.addEventListener('click', () => copyText(text, copy))
    const figure = el(
      'figure',
      { class: 'mx-code' },
      el('span', { class: 'mx-code-lang' }, current),
      copy,
    )
    if (html) {
      // Highlighted on the server: <pre class="shiki"><code><span class="line">…
      const holder = el('div')
      holder.innerHTML = html
      figure.append(holder.firstElementChild)
    } else {
      // Plain text gets the same line structure, so line numbers still show.
      const lines = text.replace(/\n$/, '').split('\n')
      figure.append(
        el(
          'pre',
          {},
          el(
            'code',
            {},
            lines.flatMap((line, i) => [
              el('span', { class: 'line' }, line),
              i < lines.length - 1 ? '\n' : null,
            ]),
          ),
        ),
      )
    }
    view.replaceChildren(figure)
  } catch (error) {
    view.replaceChildren(el('p', { class: 'mx-muted' }, error.message))
  }
}

function renderPager(item) {
  const all = sequence()
  const i = all.findIndex((candidate) => candidate.name === item.name)
  const link = (target, cls, label) =>
    target
      ? el(
          'a',
          { class: cls, href: `#/${target.name}` },
          el('span', { class: 'mx-label' }, label),
          el('span', {}, target.title),
        )
      : null
  pager.replaceChildren(
    ...[
      link(all[i - 1], 'prev', '← Previous'),
      link(all[i + 1], 'next', 'Next →'),
    ].filter(Boolean),
  )
  pager.hidden = false
}

// ── Docs: Setup and other Start here pages ─────────────────────────────
function statusPanel() {
  if (!status) {
    return null
  }
  const row = (ok, name, detail, extra = null) =>
    el(
      'div',
      { class: 'vw-status-row' },
      el('i', {
        class: ok ? 'mx-dot' : 'mx-dot mx-dot--missing',
        'aria-hidden': 'true',
      }),
      el('span', { class: 'vw-status-name' }, name),
      el('span', { class: 'vw-status-detail' }, detail, extra),
    )
  const command = `cd ${status.root.includes(' ') ? JSON.stringify(status.root) : status.root} && npx mex setup`
  return el(
    'section',
    { class: 'mx-panel vw-status', 'aria-label': 'Your setup' },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'mx-label' }, 'Your setup'),
      el('span', { class: 'mx-label' }, 'Live'),
    ),
    el(
      'div',
      { class: 'vw-status-rows' },
      row(status.nodeOk, 'Node.js', `${status.node} · needs 22.18 or newer`),
      row(
        status.envFile,
        '.env',
        status.envFile
          ? 'found in the repo folder'
          : 'not created yet: run npx mex setup',
      ),
      status.providers.map((p) =>
        row(
          p.set,
          p.name,
          el('code', {}, p.envKey),
          p.set
            ? el('span', { class: 'mx-muted' }, ' · set')
            : el(
                'span',
                {},
                ' · missing · ',
                el(
                  'a',
                  {
                    href: p.keyUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  },
                  'get a key ↗',
                ),
              ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'vw-status-foot' },
      el('span', { class: 'mx-label' }, 'Add or change keys in a terminal'),
      commandBox(command),
      el(
        'p',
        { class: 'mx-muted mx-small' },
        'This page updates when you come back to it. No restart needed.',
      ),
    ),
  )
}

async function renderDoc(doc) {
  document.title = `${doc.title} · MEGA examples`
  head.replaceChildren(
    ...[
      el('span', { class: 'mx-kicker' }, 'Start here'),
      el('h1', { class: 'mx-title' }, doc.title),
      doc.summary ? el('p', { class: 'mx-lead' }, doc.summary) : null,
    ].filter(Boolean),
  )
  tabs.hidden = true
  renderPager(doc)
  panel.replaceChildren(el('p', { class: 'mx-label' }, 'Loading…'))
  try {
    if (!docPages.has(doc.name)) {
      docPages.set(doc.name, await getJson(`api/docs/${doc.name}`))
    }
    if (parseHash().name !== doc.name) {
      return
    }
    const article = el('article', { class: 'mx-prose' })
    article.innerHTML = docPages.get(doc.name).html
    wireCopy(article)
    panel.replaceChildren(
      ...[doc.status ? statusPanel() : null, article].filter(Boolean),
    )
  } catch (error) {
    panel.replaceChildren(el('p', { class: 'mx-muted' }, error.message))
  }
}

// ── Home ───────────────────────────────────────────────────────────────
function renderHome() {
  document.title = 'MEGA examples'
  head.replaceChildren(
    el('span', { class: 'mx-kicker' }, 'MEGA developer course'),
    el('h1', { class: 'mx-title' }, 'Examples'),
    el(
      'p',
      { class: 'mx-lead' },
      'Small scripts that show how language models work. Open one to try it here, read its guide, or see its code. Every example also runs in the terminal.',
    ),
  )
  tabs.hidden = true
  pager.hidden = true
  const start = docs.map((doc) =>
    el(
      'a',
      { class: 'vw-start', href: `#/${doc.name}` },
      el('span', { class: 'mx-kicker' }, 'Start here'),
      el('span', { class: 'mx-h2' }, doc.title),
      el('p', {}, doc.summary),
      doc.status ? el('span', { class: 'vw-item-meta' }, setupMeta()) : null,
    ),
  )
  panel.replaceChildren(
    ...start,
    el(
      'div',
      { class: 'vw-cards' },
      items.map((item) =>
        el(
          'a',
          { class: 'vw-card', href: `#/${item.name}` },
          el('span', { class: 'mx-label' }, KIND_ONE[item.kind]),
          el('span', { class: 'mx-h2' }, item.title),
          el('p', {}, item.summary),
          el('span', { class: 'vw-item-meta' }, keyMeta(item)),
        ),
      ),
    ),
  )
}

// ── Routing ────────────────────────────────────────────────────────────
function parseHash() {
  const [name, tab] = location.hash.replace(/^#\/?/, '').split('/')
  return { name: name || null, tab: tab || null }
}

// The viewer loads shared/ and cli/ once. After an update there (a git pull),
// it runs the old code until a restart, and a banner on every page says so.
async function checkRestart() {
  try {
    status = await getJson('api/status')
  } catch {
    return
  }
  const banner = document.getElementById('restart')
  if (!status.restart && !serverOutdated) {
    return banner?.remove()
  }
  if (banner) {
    return
  }
  $('main').prepend(
    el(
      'div',
      {
        class: 'mx-callout mx-callout--warn vw-restart',
        id: 'restart',
        role: 'status',
      },
      el('span', { class: 'mx-label' }, 'Restart the viewer'),
      el(
        'p',
        {},
        'Its own code changed after it started, for example after ',
        el('code', {}, 'git pull'),
        '. Stop ',
        el('code', {}, 'npx mex open'),
        ' with Ctrl+C and start it again. Until then, pages may fail.',
      ),
    ),
  )
}

async function render() {
  tryPages.hide()
  panel.hidden = false
  checkRestart()
  route = parseHash()
  renderNav()
  if (!route.name) {
    return renderHome()
  }
  const doc = docs.find((candidate) => candidate.name === route.name)
  if (doc) {
    return renderDoc(doc)
  }
  const item = items.find((candidate) => candidate.name === route.name)
  if (!item) {
    // A lesson link can arrive before this copy has the lesson's examples.
    head.replaceChildren(
      el('h1', { class: 'mx-title' }, 'Not found'),
      el(
        'p',
        { class: 'mx-lead vw-missing' },
        `No example named "${route.name}". If its lesson just opened, run `,
        el('code', {}, 'git pull'),
        ' in the repo folder and start the viewer again. ',
        el('a', { href: '#/setup' }, 'Setup'),
        ' has the steps.',
      ),
    )
    tabs.hidden = true
    pager.hidden = true
    panel.replaceChildren()
    return
  }
  document.title = `${item.title} · MEGA examples`
  const tab = tabsFor(item).includes(route.tab) ? route.tab : tabsFor(item)[0]
  renderHead(item)
  renderTabs(item, tab)
  renderPager(item)
  if (tab === 'try') {
    return showTry(item)
  }
  panel.replaceChildren(el('p', { class: 'mx-label' }, 'Loading…'))
  try {
    if (!details.has(item.name)) {
      details.set(item.name, await getJson(`api/items/${item.name}`))
    }
    const detail = details.get(item.name)
    if (parseHash().name !== item.name) {
      return
    }
    if (tab === 'guide') {
      showGuide(detail)
    } else {
      showCode(detail)
    }
  } catch (error) {
    panel.replaceChildren(el('p', { class: 'mx-muted' }, error.message))
  }
}

async function loadItems() {
  // The lesson groups are optional: a viewer started before they existed has no
  // api/lessons, and the sidebar then shows one list (and a restart banner).
  ;[items, docs, status, lessons] = await Promise.all([
    getJson('api/items'),
    getJson('api/docs'),
    getJson('api/status'),
    fetch('api/lessons')
      .then(async (response) => {
        // A 404 here means the server is older than this page: it needs a restart.
        if (response.status === 404) {
          serverOutdated = true
        }
        return response.ok ? ((await response.json()).lessons ?? []) : []
      })
      .catch(() => []),
  ])
}

// Key status can change while the viewer is open (after `npx mex setup`).
async function refreshKeys() {
  const snapshot = () =>
    JSON.stringify([items.map((item) => item.keys), status])
  const before = snapshot()
  await loadItems()
  if (snapshot() === before) {
    return
  }
  renderNav()
  const doc = docs.find((candidate) => candidate.name === route.name)
  if (doc?.status) {
    return renderDoc(doc)
  }
  if (!route.name) {
    return renderHome()
  }
  const item = items.find((candidate) => candidate.name === route.name)
  if (item) {
    renderHead(item)
    if (parseHash().tab !== 'guide' && parseHash().tab !== 'code' && item.ui) {
      showTry(item)
    }
  }
}

// ── Theme toggle (same icons and labels as mega.dev) ───────────────────
const SUN =
  'M13 22h-2v-3h2v3Zm-6-3H5v-2h2v2Zm12 0h-2v-2h2v2ZM15 9h2v6h-2v2H9v-2H7V9h2V7h6v2ZM5 13H2v-2h3v2Zm17 0h-3v-2h3v2ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Zm-6-2h-2V2h2v3Z'
const MOON =
  'M14 4h-2v2h-2v6h2v2h6v-2h2v-2h2v8h-2v2h-2v2H8v-2H6v-2H4v-2H2V6h2V4h2V2h8v2Z'
function renderTheme() {
  const button = $('theme')
  const theme = window.mxTheme.get()
  button.setAttribute('aria-pressed', String(theme === 'light'))
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="${theme === 'light' ? SUN : MOON}"/></svg>${theme === 'light' ? 'Light' : 'Dark'}`
}
$('theme').addEventListener('click', () => {
  window.mxTheme.set(window.mxTheme.get() === 'light' ? 'dark' : 'light')
  renderTheme()
})
addEventListener('storage', renderTheme)
addEventListener('mx-theme', renderTheme)

// ── Events ─────────────────────────────────────────────────────────────
search.addEventListener('input', renderNav)
addEventListener('hashchange', render)
addEventListener('focus', () => void refreshKeys())
addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'mex:height') {
    return
  }
  const frame = tryPages.active?.querySelector('.vw-frame')
  if (frame && event.source === frame.contentWindow) {
    frame.style.height = `${Math.ceil(event.data.height)}px`
  }
})
addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName ?? '',
  )
  if (event.key === '/' && !typing) {
    event.preventDefault()
    search.focus()
    return
  }
  if (event.key === 'Escape' && document.activeElement === search) {
    return search.blur()
  }
  if (typing || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }
  if (event.key !== '[' && event.key !== ']') {
    return
  }
  const all = sequence()
  const i = all.findIndex((item) => item.name === route.name)
  const target =
    all[event.key === ']' ? i + 1 : Math.max(0, i - 1)] ??
    (i < 0 ? all[0] : null)
  if (target) {
    location.hash = `#/${target.name}`
  }
})

renderTheme()
loadItems()
  .then(render)
  .catch((error) => {
    // The page files load fresh from disk, but the server runs the code it started with.
    // After a git pull the two can differ: then a restart is the fix.
    panel.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'The viewer could not load'),
        el('p', {}, error.message),
        el(
          'p',
          { class: 'mx-small mx-muted' },
          'If you updated the repo while the viewer was running, stop ',
          el('code', {}, 'npx mex open'),
          ' with Ctrl+C and start it again.',
        ),
      ),
    )
  })
