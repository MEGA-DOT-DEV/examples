// Chat template
// Run: npx mex run chat-template [--system "..."] [--user "..."]
//      [--assistant "..."] [--tool-call name '{"json": "args"}']
//      [--tool name "result"] [--tool-example] [--im-sep] [--no-open]
import { runCli } from '#shared/cli.ts'
import { bold, dim, red, section } from '#shared/print.ts'
import {
  checkMessages,
  DEFAULT_MESSAGES,
  FORMAT_NAMES,
  type Message,
  type Rendered,
  ROLE_LABELS,
  render,
  TOOL_MESSAGES,
} from './render.ts'

const MAX_ROWS = 60
// Maps, not objects: a word like "constructor" must not match a flag.
const TEXT_FLAGS = new Map([
  ['--system', 'system'],
  ['--user', 'user'],
  ['--assistant', 'assistant'],
])
const TOOL_FLAGS = new Map([
  ['--tool-call', 'tool_call'],
  ['--tool', 'tool'],
])
const SWITCHES = ['--tool-example', '--im-sep', '--no-open']

async function main() {
  const { messages, separator, open } = readMessages(process.argv.slice(2))
  const list = messages.map(messageText).join(' · ')
  console.log(`${bold('Messages:')} ${list}`)

  for (const format of FORMAT_NAMES) {
    printRendered(render(messages, format, { separator, open }), open)
  }

  console.log(
    dim(
      '\nGPT-6 uses its own chat format, which is not public. ChatML and Harmony show the same idea:',
    ),
  )
  console.log(
    dim(
      'special tokens mark the roles, and the model continues the open assistant turn.',
    ),
  )
}

/**
 * Reads the command line by hand: the message flags add messages in the
 * order you give them, and --tool-call and --tool take two values each,
 * which node:util parseArgs cannot express.
 */
function readMessages(argv: string[]) {
  const given: { role: string; content: string; name?: string }[] = []
  const switches = new Set<string>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const role = TEXT_FLAGS.get(arg)
    const toolRole = TOOL_FLAGS.get(arg)
    if (role) {
      given.push({ role, content: argv[++i] ?? '' })
    } else if (toolRole) {
      const name = argv[++i] ?? ''
      given.push({ role: toolRole, name, content: argv[++i] ?? '' })
    } else if (SWITCHES.includes(arg)) {
      switches.add(arg)
    } else {
      throw new Error(
        `Unknown argument ${JSON.stringify(arg)}. Use --system, --user, --assistant, --tool-call, --tool, --tool-example, --im-sep or --no-open.`,
      )
    }
  }

  const example = switches.has('--tool-example')
    ? TOOL_MESSAGES
    : DEFAULT_MESSAGES

  return {
    messages: given.length ? checkMessages(given) : example,
    separator: switches.has('--im-sep') ? 'im_sep' : 'newline',
    open: !switches.has('--no-open'),
  } as const
}

function messageText(message: Message) {
  const name = message.name ? ` (${message.name})` : ''
  const content = JSON.stringify(message.content)

  return `${ROLE_LABELS[message.role]}${name}: ${content}`
}

function printRendered(result: Rendered, open: boolean) {
  section(`${result.label} ${dim(`${result.encoding} · ${result.usedBy}`)}`)

  // The raw text, with the special tokens in red.
  console.log(dim('The text the model reads:\n'))
  console.log(
    result.parts
      .map((p) => (p.kind === 'special' ? red(p.text) : p.text))
      .join(''),
  )

  if (open) {
    console.log(
      dim(
        '\n↑ The last turn is open. The model writes the next token after it.',
      ),
    )
  }

  console.log(dim(`\n  #  id       kind      token`))
  for (const [i, t] of result.tokens.slice(0, MAX_ROWS).entries()) {
    const index = String(i).padStart(3)
    const id = String(t.id).padEnd(7)
    const kind = t.kind === 'header' ? 'format' : t.kind
    const text = t.kind === 'special' ? red(t.text) : JSON.stringify(t.text)
    console.log(`${index}  ${id}  ${kind.padEnd(8)}  ${text}`)
  }

  if (result.tokens.length > MAX_ROWS) {
    console.log(dim(`     … ${result.tokens.length - MAX_ROWS} more tokens`))
  }

  const { total, special, content, wrapper } = result.counts
  console.log(
    `\n${bold(`${total} tokens`)}: ${content} for your content, ${wrapper} added by the chat format (${special} special tokens).`,
  )
}

await runCli(main)
