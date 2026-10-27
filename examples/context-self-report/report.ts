// A sample agent context in six parts, one plain question about it, and a
// check of which parts the answer names. Shared by the CLI (index.ts) and the
// page (api.ts).
import {
  assistantMessage,
  createResponse,
  type FunctionTool,
  userMessage,
} from '#shared/llm.ts'

export const DEFAULT_QUESTION =
  'Explain how you see our interaction: what is in your context, where each part comes from, and how you use it.'
export const MAX_QUESTION = 2000

// The texts as the model reads them. requestFor() puts them together.
const SYSTEM = `You are Cody, a coding agent that works in the user's terminal.
The project is a web shop in /work/shop. Node and git are installed.
Read a file before you edit it. Run the tests after each change.
Commit each fix with git, with a short message.
Answer in short plain text. Do not use Markdown headings or tables.`

const MEMORY = `Contents of MEMORY.md (notes you saved in earlier sessions):
- 2026-03-02: CI runs the tests on Node 20.
- 2026-05-14: Prices are stored in cents. Never use floats for money.
- The user prefers small commits.`

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
): FunctionTool => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
})

const TOOLS = [
  tool('read_file', 'Read a file in the project.', {
    path: { type: 'string' },
  }),
  tool('edit_file', 'Replace text in a file in the project.', {
    path: { type: 'string' },
    old_text: { type: 'string' },
    new_text: { type: 'string' },
  }),
  tool('run_tests', 'Run the test suite and return its output.', {}),
]

const ASKED =
  'The checkout test fails since this morning. Can you find out why?'
const REPLIED =
  'I read src/cart.ts and ran the tests. checkout.test.ts fails: the total is 19.99, and the test expects 1999. Can you paste the CI log, so I can compare it with my run?'

const LOG = `Here is the CI log:

$ node --version
v22.18.0
$ npm test
✗ checkout.test.ts > total in cents
  Expected: 1999
  Received: 19.99
1 failed, 41 passed`

// A harness adds its reminders to the user's next message, as tagged text.
const REMINDER = `<system-reminder>
src/cart.ts changed on disk after you last read it. Read it again before you edit it.
</system-reminder>`

const lines = (text: string) => `${text.split('\n').length} lines`

/**
 * The parts of the context, in the order of the request. `where` starts with
 * the request field. `words` are the names of a part, and facts that only this
 * part holds (Node 20 is only in the memory). A part counts as described when
 * the answer holds one of its words.
 */
export const PARTS = [
  {
    id: 'system',
    title: 'System prompt',
    where: 'instructions',
    size: lines(SYSTEM),
    text: SYSTEM,
    words: [
      'system prompt',
      'system message',
      'developer message',
      'instruction',
      'Cody',
      'web shop',
      '/work/shop',
      'git',
      'commit each fix',
    ],
  },
  {
    id: 'memory',
    title: 'Memory',
    where: 'instructions, under the system prompt',
    size: lines(MEMORY),
    text: MEMORY,
    words: [
      'memory',
      'memories',
      'notes',
      'Node 20',
      'small commits',
      'floats',
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    where: 'tools',
    size: `${TOOLS.length} tools`,
    text: JSON.stringify(TOOLS, null, 2),
    lang: 'json',
    words: ['tool', ...TOOLS.map((t) => t.name)],
  },
  {
    id: 'history',
    title: 'Earlier messages',
    where: 'input',
    size: '2 messages: a question and a reply',
    text: `User: ${ASKED}\n\nAssistant: ${REPLIED}`,
    words: [
      'conversation',
      'history',
      'earlier message',
      'previous message',
      'first message',
      'earlier reply',
      'previous reply',
      'earlier assistant',
      'this morning',
    ],
  },
  {
    id: 'log',
    title: 'Pasted CI log',
    where: 'input, the next user message',
    size: lines(LOG),
    text: LOG,
    words: ['log', 'pasted', 'CI result', 'CI output', 'Node 22', 'v22'],
  },
  {
    id: 'reminder',
    title: 'Reminder',
    where: 'input, last message, above your question',
    size: lines(REMINDER),
    text: REMINDER,
    words: ['reminder', 'changed on disk', 'changed since', 'file change'],
  },
]

export function requestFor(question: string, model?: string) {
  return {
    ...(model ? { model } : {}),
    instructions: `${SYSTEM}\n\n${MEMORY}`,
    tools: TOOLS,
    // The agent answers in words: it may not call a tool in this turn.
    tool_choice: 'none',
    input: [
      userMessage(ASKED),
      assistantMessage(REPLIED),
      userMessage(LOG),
      userMessage(`${REMINDER}\n\n${question}`),
    ],
  }
}

// Whole words, any case: "system prompt" matches "System-Prompts", and "tool"
// matches "tools" but not "toolbox". A tool name matches only as written:
// "run tests" in a sentence is not the run_tests tool.
const pattern = (word: string) =>
  word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+')

export interface DescribedPart {
  id: string
  title: string
  /** The first of the part's words in the answer, as written there. */
  word: string | null
}

/** For each part: the first of its words in the answer, or null. */
export function describedParts(answer: string): DescribedPart[] {
  return PARTS.map(({ id, title, words }) => {
    const found = new RegExp(
      `(?<![a-z0-9])(?:${words.map(pattern).join('|')})s?(?![a-z0-9])`,
      'i',
    ).exec(answer)

    return { id, title, word: found ? found[0] : null }
  })
}

/** Sends one request: the sample context, with your question last. */
export async function ask(
  options: { question?: string; provider?: string; model?: string } = {},
) {
  const question = options.question?.trim() || DEFAULT_QUESTION
  const result = await createResponse(requestFor(question, options.model), {
    provider: options.provider,
  })

  return {
    model: result.model,
    answer: result.text,
    parts: describedParts(result.text),
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}
