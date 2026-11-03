// A rule with its reason
// Run: npx mex run rule-with-reason [--runs 1|3]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { formatUsage, pickProvider } from '#shared/llm.ts'
import { printRequest, section } from '#shared/print.ts'
import { type Column, compare, type Mode, type Reply } from './compare.ts'

const TITLES: Record<Mode, string> = {
  rule: 'Rule only',
  reason: 'Rule + reason',
}

async function main() {
  const { flags, words } = cliArgs({ runs: { type: 'string', default: '1' } })
  if (words.length) {
    throw new Error(
      'Use --runs 1 or --runs 3, optionally with --provider and --model.',
    )
  }
  const runs = oneOf(flags.runs, ['1', '3'], 'number of runs')

  // Check the key before the first output.
  pickProvider(flags.provider)

  console.log('Public forum reply · rule only vs rule with its reason')
  const columns = await compare(runs === '3' ? 3 : 1, flags)
  for (const column of columns) {
    printColumn(column)
  }

  printTotals(columns)

  // The other replies still print, but a failed request fails the run.
  const replies = columns.flatMap((column) => column.replies)
  if (replies.some((reply) => 'error' in reply)) {
    process.exitCode = 1
  }
}

function printColumn(column: Column) {
  section(TITLES[column.mode])

  column.replies.forEach((reply, index) => {
    if ('error' in reply) {
      console.log(`Run ${index + 1}: request failed: ${reply.error}`)
      return
    }
    console.log(`Run ${index + 1}: ${checkLine(reply)}`)
    console.log(reply.text || '(No reply text returned.)')
    printRequest({ ...reply.request, headers: {} })
    console.log('Response:', JSON.stringify(reply.response, null, 2))
  })
}

/** Which details the reply wrote out, its usage, and a status that is not completed. */
function checkLine(reply: Reply) {
  const mark = (shown: boolean) => (shown ? 'written out' : 'held back')
  const { email, phone, address } = reply.shown
  const shown = `email ${mark(email)} · phone ${mark(phone)} · address ${mark(address)}`
  const parts = [shown, formatUsage(reply.usage)]
  if (reply.status !== 'completed') {
    const why = reply.incompleteReason ?? 'unknown reason'
    parts.push(`${reply.status} (${why})`)
  }

  return parts.join(' · ')
}

function printTotals(columns: Column[]) {
  for (const column of columns) {
    const replies = column.replies.filter(
      (reply): reply is Reply => !('error' in reply),
    )
    const leaked = replies.filter(
      (reply) => reply.shown.phone || reply.shown.address,
    ).length
    const count = `${leaked} of ${replies.length} replies`
    console.log(
      `${TITLES[column.mode]}: phone or address written out in ${count}`,
    )
  }
}

await runCli(main)
