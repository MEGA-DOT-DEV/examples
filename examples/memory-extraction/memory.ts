// Three ways to keep memory across six dated conversations: one profile that
// a background extractor appends to, memory tools that the agent calls in the
// session, and one document per person. Each mode replays the sessions from
// scratch, and a score counts outdated facts, mixed-up people and duplicates.
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  type LlmResult,
  type ResponseBody,
  type ShownRequest,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

export type Mode = 'profile' | 'tools' | 'entities'
export const MODES: Mode[] = ['profile', 'tools', 'entities']
type Key = 'city' | 'role' | 'reply_style' | 'activity'
type Identity = 'alex-chen' | 'alex-rivera'
type Candidate = { entityId: Identity | null; key: Key; value: string }
type Fact = Candidate & { source: number; name: string }
type Note = { session: number; text: string; reason: string }
type Action = 'save' | 'update' | 'background'

interface Session {
  date: string
  context: string
  text: string
  checks: string
  identity: Identity | null
  expires?: string
}

// `checks` names the memory problem each session tests. The model never sees it.
export const SESSIONS: Session[] = [
  {
    date: '2026-09-01',
    context: 'Alex Chen, the product designer',
    text: 'I live in Berlin. I design products, and I prefer short answers.',
    checks: 'First facts',
    identity: 'alex-chen',
  },
  {
    date: '2026-09-08',
    context: 'Alex Rivera, the restaurant chef',
    text: 'I live in Porto and work as a chef.',
    checks: 'A second person named Alex',
    identity: 'alex-rivera',
  },
  {
    date: '2026-09-17',
    context: 'Alex Chen, the product designer',
    text: 'I have moved from Berlin to Vienna. Vienna is home now.',
    checks: 'A changed fact',
    identity: 'alex-chen',
  },
  {
    date: '2026-09-25',
    context: 'Alex Rivera, the restaurant chef',
    text: 'My kitchen shifts are still in Porto. I cook for a living.',
    checks: 'Known facts in new words',
    identity: 'alex-rivera',
  },
  {
    date: '2026-10-02',
    context: 'Alex (no surname, account or thread link)',
    text: 'Alex told me they have started cycling. I cannot tell which Alex.',
    checks: 'Which Alex?',
    identity: null,
  },
  {
    date: '2026-10-06',
    context: 'Alex Chen, the product designer',
    text: 'Keep replies brief as usual. I am staying in Lisbon for a conference until October 9, then I go home.',
    checks: 'A short stay and a repeat',
    identity: 'alex-chen',
    expires: '2026-10-09',
  },
]

const EXPECTED: { entityId: Identity; key: Key; value: string }[] = [
  { entityId: 'alex-chen', key: 'city', value: 'vienna' },
  { entityId: 'alex-chen', key: 'role', value: 'designer' },
  { entityId: 'alex-chen', key: 'reply_style', value: 'short answers' },
  { entityId: 'alex-rivera', key: 'city', value: 'porto' },
  { entityId: 'alex-rivera', key: 'role', value: 'chef' },
]
const KEYS: Key[] = ['city', 'role', 'reply_style', 'activity']
const IDS: Identity[] = ['alex-chen', 'alex-rivera']
// Grade semantic repeats, not punctuation or short-answer wording.
const synonyms: Record<string, string> = {
  'product designer': 'designer',
  cook: 'chef',
  'brief answers': 'short answers',
  'brief replies': 'short answers',
  'short replies': 'short answers',
  'concise answers': 'short answers',
}
const normalized = (value: string) => {
  const plain = value.trim().toLowerCase().replace(/[.!]$/, '')
  return synonyms[plain] ?? plain
}
const NAMES: Record<Identity, string> = {
  'alex-chen': 'Alex Chen',
  'alex-rivera': 'Alex Rivera',
}
const label = (id: Identity | null) => (id ? NAMES[id] : 'Alex (unknown)')
const UNKNOWN_ALEX =
  'Two people are named Alex, and the message does not say which one.'
const HELD = 'Held a note: the message does not say which Alex.'
const TITLES: Record<Mode, string> = {
  profile: 'One profile · background extraction',
  tools: 'Memory tools · the agent saves in session',
  entities: 'One document per person · background extraction',
}

export interface Options {
  provider?: string
  model?: string
}

export interface Snapshot {
  date: string
  context: string
  text: string
  checks: string
  changes: string[]
  memory: { document: string; facts: { key: Key; value: string }[] }[]
  pending: Note[]
  requests: { request: ShownRequest; response: unknown; usage: Usage }[]
}

export interface Score {
  retained: number
  possible: number
  stale: number
  crossPerson: number
  duplicates: number
  pending: number
  requests: number
  extraRequests: number
  cost: number | null
  costEstimated: boolean
}

export interface Outcome {
  mode: Mode
  title: string
  sessions: Snapshot[]
  score: Score
}

/** The memory one mode builds: its facts, and notes held for an unknown Alex. */
interface Store {
  mode: Mode
  facts: Fact[]
  pending: Note[]
}

/** One session replayed in one mode, and the changes it made. */
interface Turn {
  store: Store
  session: Session
  index: number
  changes: string[]
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entity_id: { type: 'string', enum: IDS },
    key: { type: 'string', enum: KEYS },
    value: { type: 'string' },
  },
  required: ['entity_id', 'key', 'value'],
}
const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'memory_save',
    description:
      'Add a new durable fact. Do not use for an existing person and key.',
    strict: true,
    parameters: schema,
  },
  {
    type: 'function',
    name: 'memory_update',
    description: 'Replace the existing value for the same person and key.',
    strict: true,
    parameters: schema,
  },
]

const RULES =
  'Extract only durable facts stated in this message. Use canonical values: city names, designer, chef, short answers, cycling. ' +
  'A paraphrase of a stored fact is not new. A move replaces an old city. A conference stay with an end date is temporary, not home. ' +
  'Two people share the name Alex; do not assign a surname when it is unknown.'
const AGENT_INSTRUCTIONS =
  'You are the agent in this session. Use memory_save for a new durable fact, memory_update for a changed fact. Do not call either for repeats, temporary stays or uncertain identities. Call tools only when needed.'
const EXTRACTOR_INSTRUCTIONS =
  'You are a background memory extractor. Extract durable facts only. Use null for an ambiguous person. No facts for temporary stays or repeats. Replace changed facts when the store supports it.'
const FACTS_FORMAT = {
  type: 'json_schema',
  name: 'memory_facts',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entity_id: { type: ['string', 'null'], enum: [...IDS, null] },
            key: { type: 'string', enum: KEYS },
            value: { type: 'string' },
          },
          required: ['entity_id', 'key', 'value'],
        },
      },
    },
    required: ['facts'],
  },
}

export function isMode(value: unknown): value is Mode {
  return MODES.some((mode) => mode === value)
}

/** Replays the six sessions in one mode, from empty memory, and scores it. */
export async function compare(
  mode: Mode,
  options: Options = {},
): Promise<Outcome> {
  if (!isMode(mode)) {
    throw new Error('Choose profile, tools or entities.')
  }

  const store: Store = { mode, facts: [], pending: [] }
  const sessions: Snapshot[] = []
  const requests: LlmResult[] = []

  for (const [index, session] of SESSIONS.entries()) {
    const turn: Turn = { store, session, index, changes: [] }
    const results =
      mode === 'tools'
        ? await runAgentSession(turn, options)
        : await runBackgroundSession(turn, options)

    requests.push(...results)
    sessions.push(snapshot(turn, results))
  }

  return {
    mode,
    title: TITLES[mode],
    sessions,
    score: score(store, requests),
  }
}

/** The message the model reads: the session, the memory so far, the rules. */
function sessionPrompt({ store, session }: Turn) {
  const message = `Date: ${session.date}. Speaker context: ${session.context}. Message: ${session.text}.`
  const existing = JSON.stringify(documents(store.mode, store.facts))
  const pending = JSON.stringify(store.pending)

  return `${message}\nExisting memory: ${existing}. Pending: ${pending}.\n${RULES}`
}

function ask(body: ResponseBody, options: Options) {
  return createResponse(
    {
      model: options.model,
      reasoning: { effort: 'low' },
      max_output_tokens: 450,
      ...body,
    },
    { provider: options.provider },
  )
}

// Mode `tools`: the agent itself decides, during the session, what to save.
async function runAgentSession(turn: Turn, options: Options) {
  const input: InputItem[] = [userMessage(sessionPrompt(turn))]
  const first = await ask(
    {
      instructions: AGENT_INSTRUCTIONS,
      input,
      tools: TOOLS,
      parallel_tool_calls: true,
    },
    options,
  )

  if (!first.functionCalls.length) {
    turn.changes.push('No memory tool called.')
    return [first]
  }

  // Each tool call costs one more request: the model reads the results.
  const outputs = first.functionCalls.map((call) => runMemoryTool(turn, call))
  const second = await ask(
    {
      instructions: 'Confirm briefly. No more memory tools.',
      input: [...input, ...continuation(first), ...outputs],
    },
    options,
  )

  return [first, second]
}

function runMemoryTool(turn: Turn, call: FunctionCall) {
  const item = candidate(call.args)
  if (call.name !== 'memory_save' && call.name !== 'memory_update') {
    return functionOutput(call.callId, { error: 'Unknown memory tool.' })
  }

  // The code, not the model, checks who is speaking.
  if (!item || item.entityId !== turn.session.identity) {
    return functionOutput(call.callId, {
      error: 'Person does not match the known speaker, or identity is unknown.',
    })
  }

  const before = turn.changes.length
  saveFact(turn, item, call.name === 'memory_update' ? 'update' : 'save')

  return functionOutput(call.callId, {
    status: turn.changes.length === before ? 'unchanged' : 'processed',
    detail: turn.changes.at(-1),
  })
}

// Modes `profile` and `entities`: an extractor reads the session afterwards.
async function runBackgroundSession(turn: Turn, options: Options) {
  const response = await ask(
    {
      instructions: EXTRACTOR_INSTRUCTIONS,
      input: [userMessage(sessionPrompt(turn))],
      text: { format: FACTS_FORMAT },
    },
    options,
  )
  const candidates = parseFacts(response.text)
    .map(candidate)
    .filter((item) => item !== null)

  if (turn.store.mode === 'entities' && !turn.session.identity) {
    holdNote(turn)
    return [response]
  }

  for (const item of candidates) {
    saveFact(turn, item, 'background')
  }
  if (!turn.changes.length) {
    turn.changes.push('No new fact.')
  }

  return [response]
}

function holdNote({ store, session, index, changes }: Turn) {
  store.pending.push({
    session: index + 1,
    text: session.text,
    reason: UNKNOWN_ALEX,
  })
  changes.push(HELD)
}

/** Stores one fact by the rules of the mode, and notes what happened. */
function saveFact(turn: Turn, item: Candidate, action: Action) {
  const { store, session, changes } = turn
  if (session.expires && (item.key === 'city' || item.key === 'activity')) {
    const ends = `the conference ends ${session.expires}`
    changes.push(`Skipped a short stay (${item.key}): ${ends}.`)
    return
  }

  const unknownSpeaker = !session.identity || item.entityId !== session.identity
  if (store.mode === 'entities' && unknownSpeaker) {
    holdNote(turn)
    return
  }

  // One profile ignores which Alex the model named: it has one document.
  const entityId = store.mode === 'profile' ? session.identity : item.entityId
  if (!replaceOldValue(turn, entityId, item.key, action)) {
    return
  }

  store.facts.push({ ...item, entityId, source: turn.index, name: 'Alex' })
  const verb = action === 'background' ? 'Extracted' : `memory_${action}`
  changes.push(`${verb} ${label(entityId)}: ${item.key} = ${item.value}`)
}

/**
 * Removes the old value of the same person and key, in the modes that
 * replace one. Returns false when memory_update finds nothing to replace.
 */
function replaceOldValue(
  turn: Turn,
  entityId: Identity | null,
  key: Key,
  action: Action,
) {
  const { facts, mode } = turn.store
  if (mode !== 'entities' && action !== 'update') {
    return true
  }

  const at = facts.findIndex(
    (fact) => fact.entityId === entityId && fact.key === key,
  )
  if (at >= 0) {
    facts.splice(at, 1)
    return true
  }
  if (action === 'update') {
    const missing = `${label(entityId)} has no ${key} to replace.`
    turn.changes.push(`memory_update: ${missing}`)
    return false
  }

  return true
}

function snapshot({ store, session, changes }: Turn, results: LlmResult[]) {
  return {
    date: session.date,
    context: session.context,
    text: session.text,
    checks: session.checks,
    changes,
    memory: documents(store.mode, store.facts),
    pending: [...store.pending],
    requests: results.map((result) => ({
      request: result.request,
      response: result.response,
      usage: result.usage,
    })),
  }
}

function candidate(value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const fields = value as Record<string, unknown>
  if (
    !KEYS.includes(fields.key as Key) ||
    typeof fields.value !== 'string' ||
    !fields.value.trim() ||
    fields.value.length > 100
  ) {
    return null
  }
  if (
    fields.entity_id !== null &&
    !IDS.includes(fields.entity_id as Identity)
  ) {
    return null
  }

  return {
    entityId: fields.entity_id as Identity | null,
    key: fields.key as Key,
    value: fields.value.trim(),
  }
}

function parseFacts(text: string): unknown[] {
  try {
    const json = JSON.parse(text)
    return json &&
      typeof json === 'object' &&
      Array.isArray(json.facts) &&
      json.facts.length <= 12
      ? json.facts
      : []
  } catch {
    return []
  }
}

function documents(mode: Mode, facts: Fact[]) {
  if (mode === 'profile') {
    return [
      {
        document: 'profile.md · Alex',
        facts: facts.map(({ key, value }) => ({ key, value })),
      },
    ]
  }

  return IDS.map((id) => ({
    document: `${id}.md · ${label(id)}`,
    facts: facts
      .filter((fact) => fact.entityId === id)
      .map(({ key, value }) => ({ key, value })),
  }))
}

function score({ mode, facts, pending }: Store, requests: LlmResult[]): Score {
  const retained = EXPECTED.filter((gold) =>
    facts.some(
      (fact) =>
        fact.entityId === gold.entityId &&
        fact.key === gold.key &&
        normalized(fact.value) === gold.value,
    ),
  ).length
  const stale = facts.filter((fact) =>
    EXPECTED.some(
      (gold) =>
        gold.entityId === fact.entityId &&
        gold.key === fact.key &&
        normalized(fact.value) !== gold.value,
    ),
  ).length
  const duplicates = facts.filter(
    (fact, index) =>
      facts.findIndex(
        (other) =>
          other.entityId === fact.entityId &&
          other.key === fact.key &&
          normalized(other.value) === normalized(fact.value),
      ) < index,
  ).length
  const total = sumUsage(requests.map((request) => request.usage))

  return {
    retained,
    possible: EXPECTED.length,
    stale,
    duplicates,
    crossPerson: mixedPeople(mode, facts),
    pending: pending.length,
    requests: requests.length,
    extraRequests: requests.length - SESSIONS.length,
    cost: total.cost,
    costEstimated: total.costSource === 'estimate',
  }
}

/**
 * One profile: the keys that hold values of both people. A document per
 * person: the facts saved under a person other than the speaker.
 */
function mixedPeople(mode: Mode, facts: Fact[]) {
  if (mode === 'profile') {
    return KEYS.filter((key) => {
      const people = facts
        .filter((fact) => fact.key === key && fact.entityId)
        .map((fact) => fact.entityId)
      return new Set(people).size > 1
    }).length
  }

  return facts.filter((fact) => {
    const speaker = SESSIONS[fact.source].identity
    return speaker !== null && fact.entityId !== speaker
  }).length
}
