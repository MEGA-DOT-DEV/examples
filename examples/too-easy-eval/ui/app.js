import { call, el, showError } from '../../kit/kit.js'

const selection = document.getElementById('dataset')
const button = document.getElementById('score')
const notice = document.getElementById('notice')
const results = document.getElementById('results')

function resultCell(hit, correct) {
  return el(
    'td',
    { class: correct ? 'mx-good' : 'mx-bad' },
    `${correct ? '✓' : '✗'} ${hit?.title ?? 'No match'}`,
  )
}

const LABELS = { titleOnly: 'Title-only', textAware: 'Title + note text' }

button.addEventListener('click', async () => {
  button.disabled = true
  try {
    const result = await call('compare', { dataset: selection.value })
    renderScores(result)
    renderCases(result)
    renderFolds(result)

    results.hidden = false
    document.getElementById('empty').hidden = true
    showError(notice, null)
  } catch (error) {
    showError(notice, error)
  } finally {
    button.disabled = false
  }
})

function renderScores({ datasets, pairs }) {
  document
    .getElementById('scores')
    .replaceChildren(
      ...Object.entries(LABELS).map(([method, label]) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, label),
          el('td', {}, `${datasets.title.scores[method]} / ${pairs.length}`),
          el('td', {}, `${datasets.user.scores[method]} / ${pairs.length}`),
        ),
      ),
    )

  const title = datasets.title.scores.titleOnly
  const user = datasets.user.scores.titleOnly
  document.getElementById('meaning').textContent =
    `On copied titles, title-only search finds ${title} of ${pairs.length}. On user wording it finds ${user} of ${pairs.length}; note text gives another path to the answer.`
}

function renderCases({ selected, datasets }) {
  document.getElementById('queries-title').textContent =
    `${selected === 'title' ? 'Title' : 'User'} questions · expected versus returned`
  document
    .getElementById('cases')
    .replaceChildren(
      ...datasets[selected].rows.map((row) =>
        el(
          'tr',
          {},
          el('td', {}, row.query),
          el('td', {}, row.expected),
          resultCell(row.results.titleOnly, row.correct.titleOnly),
          resultCell(row.results.textAware, row.correct.textAware),
        ),
      ),
    )
}

function renderFolds({ pairs, notes }) {
  document
    .getElementById('pairs')
    .replaceChildren(
      ...pairs.map((pair) =>
        el(
          'li',
          {},
          el(
            'strong',
            {},
            notes.find((note) => note.id === pair.expectedId).title,
          ),
          el('span', {}, `Title: ${pair.titleQuery}`),
          el('span', {}, `User: ${pair.userQuery}`),
        ),
      ),
    )
  document
    .getElementById('notes')
    .replaceChildren(
      ...notes.map((note) =>
        el('li', {}, el('strong', {}, note.title), el('span', {}, note.body)),
      ),
    )
}
