// Hybrid search
// Run: npx mex run hybrid-search ["your query"] [--split]
//      [--provider openrouter|openai] [--model embedding-model]
import { cliArgs, runCli } from '#shared/cli.ts'
import type { EmbeddingResult } from '#shared/embeddings.ts'
import { byId } from '#shared/input.ts'
import { costText, NO_USAGE, sumUsage } from '#shared/llm.ts'
import { bold, dim, green, red, section } from '#shared/print.ts'
import { NOTES, PRESETS } from './notes.ts'
import {
  type Hit,
  METHODS,
  type Method,
  type Rankings,
  rankOf,
  type Scoreboard,
  type SearchOptions,
  search,
  searchPresets,
} from './search.ts'

const LABEL: Record<Method, string> = {
  keyword: 'Keyword (BM25)',
  semantic: 'Semantic (cosine similarity)',
  hybrid: 'Hybrid (RRF, k = 60)',
}
const NAME: Record<Method, string> = {
  keyword: 'Keyword',
  semantic: 'Semantic',
  hybrid: 'Hybrid',
}
const TOP = 3 // results printed per preset

async function main() {
  const { flags, words } = cliArgs({
    split: { type: 'boolean', default: false },
  })
  const query = words.join(' ').trim()
  const options = {
    provider: flags.provider,
    model: flags.model,
    split: flags.split,
  }

  if (query) {
    await searchQuery(query, options)
  } else {
    await searchAllPresets(options)
  }
}

/** One query of your own: the top 5 of each method. */
async function searchQuery(query: string, options: SearchOptions) {
  const run = await search([query], options)

  const notes = `${NOTES.length} notes as ${run.docs} texts`
  console.log(dim(`${notes} · ${run.provider} · ${run.model}`))
  console.log(dim(usageLine(run.corpus, run.queries)))

  section(`"${query}"`)
  printRankings(run.rankings[0], [], 5)
}

/** Every preset, checked against the answer key, then the scoreboard. */
async function searchAllPresets(options: SearchOptions) {
  const run = await searchPresets(options)

  const split = options.split ? ' (long notes split into paragraphs)' : ''
  const notes = `${NOTES.length} notes as ${run.docs} texts${split}`
  console.log(dim(`${notes} · ${run.provider} · ${run.model}`))
  console.log(dim(usageLine(run.corpus, run.queries)))

  for (const preset of PRESETS) {
    const relevant = preset.relevant.map(titleOf).join(', ')
    section(`${preset.label} · "${preset.query}"`)
    console.log(dim(`  ${preset.about}`))
    console.log(dim(`  Relevant: ${relevant}`))
    printRankings(run.presets[preset.id], preset.relevant, TOP)
  }

  printScoreboard(run.scoreboard)
}

// "2 requests · notes 1682 tokens + queries 51 tokens · $0.000035 est."
function usageLine(notes: EmbeddingResult, queries: EmbeddingResult) {
  const both = [notes, queries].map((r) => ({ ...NO_USAGE, ...r.usage }))
  const cost = costText(sumUsage(both))
  const noteTokens = `notes ${notes.usage.inputTokens} tokens`
  const queryTokens = `queries ${queries.usage.inputTokens} tokens`

  return `2 requests · ${noteTokens} + ${queryTokens} · ${cost}`
}

// The top results of each method; ✓ marks a relevant note.
// Relevant notes below the top get their rank.
function printRankings(rankings: Rankings, relevant: string[], top: number) {
  for (const method of METHODS) {
    const hits = rankings[method]
    const digits = method === 'hybrid' ? 4 : 3

    console.log(bold(`  ${LABEL[method]}`))
    if (!hits.length) {
      console.log(dim('    no note has a word of the query'))
    }

    for (const [i, hit] of hits.slice(0, top).entries()) {
      const mark = relevant.includes(hit.noteId) ? green('✓') : ' '
      const score = dim(hit.score.toFixed(digits))
      console.log(`    ${i + 1}. ${mark} ${noteName(hit)} ${score}`)
    }

    const missed = relevant.filter((id) => (rankOf(hits, id) ?? Infinity) > top)
    for (const id of missed) {
      const rank = rankOf(hits, id)
      const where = rank === null ? 'not found' : `rank ${rank}`
      console.log(red(`       missed: ${titleOf(id)} · ${where}`))
    }
  }
}

function noteName(hit: Hit) {
  const title = titleOf(hit.noteId)
  if (!hit.part) {
    return title
  }

  return `${title} ${dim(`(paragraph ${hit.part})`)}`
}

function titleOf(id: string) {
  return byId(NOTES, id, 'note').title
}

// One row per preset: the rank of the first relevant note in each list.
// Rank 1 wins the query.
function printScoreboard(scoreboard: Scoreboard) {
  section('Which method puts a relevant note first?')
  const header = METHODS.map((m) => NAME[m].padEnd(12)).join('')
  console.log(dim(`${'query'.padEnd(24)}${header}`))

  for (const preset of PRESETS) {
    const ranks = scoreboard.ranks[preset.id]
    const cells = METHODS.map((m) => rankCell(ranks[m])).join('')
    console.log(`${preset.label.padEnd(24)}${cells}`)
  }

  const wins = METHODS.map((m) =>
    `${scoreboard.wins[m]} of ${PRESETS.length}`.padEnd(12),
  ).join('')
  console.log(bold(`${'wins'.padEnd(24)}${wins}`))
  console.log(
    dim(
      'Each number is the rank of the first relevant note. A method wins a query when that rank is 1.',
    ),
  )
}

// Pad before coloring: color codes would count as width.
function rankCell(rank: number | null) {
  if (rank === 1) {
    return green('1 ✓'.padEnd(12))
  }
  if (rank === null) {
    return 'not found'.padEnd(12)
  }

  return String(rank).padEnd(12)
}

await runCli(main)
