// The default skills and test requests, and the checks for what a user edits.
// Shared by the CLI (index.ts), the page (api.ts) and the tests.

export interface Skill {
  /** Lowercase letters, digits and hyphens, as in the Agent Skills format. */
  name: string
  /** What the skill does and when to load it. The model sees only this and the name. */
  description: string
  /** The SKILL.md body. It reaches the context only when the skill loads. */
  body: string
}

export interface TestCase {
  request: string
  /** The skill that must load, or null when no skill must load. */
  expected: string | null
}

export const MAX_SKILLS = 12
export const MAX_TESTS = 30
export const MAX_DESCRIPTION = 1024
export const MAX_REQUEST = 500
export const MAX_BODY = 4000
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Most descriptions say what the skill does and when to load it.
// Two are weak on purpose: `debug` and `explain-error` overlap and say
// little, and `code-review` ends with "feedback on their work", which is
// broader than code.
export const DEFAULT_SKILLS: Skill[] = [
  {
    name: 'code-review',
    description:
      'Review code and give feedback: bugs, risks, naming and structure. Use when the user asks for a review or for feedback on their work.',
    body: `# Code review

1. Read the whole change first. Note what it is meant to do.
2. Look for bugs: wrong conditions, missing error handling, unsafe input, race conditions.
3. Look for risks: breaking changes, missing tests, secrets in code.
4. Comment on naming and structure only when it hurts reading.
5. Reply with a list: file, line, problem, a concrete fix. Put blocking issues first.`,
  },
  {
    name: 'debug',
    description: 'Help with errors and bugs in code.',
    body: `# Debug

1. Reproduce the problem. Ask for the exact command and output if you do not have them.
2. Read the stack trace from the top frame in the user's code.
3. Form one hypothesis at a time. Check it with a log line or a small test.
4. Fix the cause, not the symptom. Keep the change small.
5. Run the failing case again and show that it passes.`,
  },
  {
    name: 'explain-error',
    description: 'Explain an error message.',
    body: `# Explain an error

1. Quote the error. Name the tool or runtime that printed it.
2. Say in one sentence what it means in plain words.
3. List the two or three most common causes, most likely first.
4. For each cause, give one check the user can run.
5. Do not change code. Point to the debug skill when the user wants a fix.`,
  },
  {
    name: 'write-tests',
    description:
      "Write unit tests for existing functions with the project's test runner. Use when the user asks for tests, test cases or more coverage for code.",
    body: `# Write tests

1. Find the test runner and the test file pattern in package.json or the repo.
2. List the cases: the normal case, edge cases, invalid input, errors.
3. Write one test per case. Name each test after the behavior it checks.
4. Do not mock what you can run. Mock only the network and the clock.
5. Run the tests and show the result.`,
  },
  {
    name: 'commit-message',
    description:
      'Write a git commit message from a diff or staged changes, in the Conventional Commits format. Use when the user asks for a commit message or wants to commit their changes.',
    body: `# Commit message

1. Read the staged diff with \`git diff --staged\`.
2. Pick the type: feat, fix, refactor, docs, test or chore.
3. Write a subject line under 72 characters, in the imperative mood.
4. Add a body only when the reason for the change is not obvious.
5. Do not run \`git commit\` unless the user asks.`,
  },
  {
    name: 'sql-migration',
    description:
      'Write a PostgreSQL schema migration (tables, columns, indexes) with an up and a down step. Use when the user wants to change the database schema.',
    body: `# SQL migration

1. Find the migration folder and the naming pattern in the repo.
2. Write the up step. Add new columns as nullable or with a default.
3. Create indexes on large tables with CREATE INDEX CONCURRENTLY.
4. Write a down step that undoes the up step exactly.
5. Never edit a migration that already ran in production. Add a new one.`,
  },
]

// Hits first, then near misses: requests that sound related but need no skill.
export const DEFAULT_TESTS: TestCase[] = [
  {
    request:
      'Can you review this pull request before I merge it? It adds rate limiting to the login endpoint.',
    expected: 'code-review',
  },
  {
    request:
      'Look over this function and tell me what you would change: function sum(a){return a.reduce((x,y)=>x+y)}',
    expected: 'code-review',
  },
  {
    request:
      'My app crashes on start with "TypeError: Cannot read properties of undefined (reading \'map\')" in UserList.tsx. Find the cause and fix it.',
    expected: 'debug',
  },
  {
    request:
      'The checkout total is off by one cent for some carts. There is no error, just a wrong number. Fix it.',
    expected: 'debug',
  },
  {
    request:
      'I get "ModuleNotFoundError: No module named requests" when I run my script. Make it work.',
    expected: 'debug',
  },
  {
    request: 'What does "connect ECONNREFUSED 127.0.0.1:5432" mean?',
    expected: 'explain-error',
  },
  {
    request: 'Add tests for the parseDate function in utils/date.ts.',
    expected: 'write-tests',
  },
  {
    request: 'Write a commit message for my staged changes.',
    expected: 'commit-message',
  },
  {
    request:
      'Add a nullable archived_at timestamp column to the projects table.',
    expected: 'sql-migration',
  },
  {
    request: 'Review my cover letter for a junior developer job.',
    expected: null,
  },
  {
    request: 'What is the difference between unit tests and integration tests?',
    expected: null,
  },
  { request: 'Explain what a closure is in JavaScript.', expected: null },
  { request: 'How do I undo my last git commit?', expected: null },
  {
    request:
      'We are moving our team chat from Slack to Teams. Draft a short announcement.',
    expected: null,
  },
  {
    request:
      'Our error rate dropped after the release. Write two sentences for the weekly update.',
    expected: null,
  },
]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Checks the skills a user sends. Throws a readable error. */
export function readSkills(value: unknown): Skill[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('Give at least one skill.')
  }
  if (value.length > MAX_SKILLS) {
    throw new Error(`Keep the catalog at ${MAX_SKILLS} skills or fewer.`)
  }

  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`Skill ${index + 1} must be an object.`)
    }

    const name = readName(item.name, index)
    if (seen.has(name)) {
      throw new Error(`Two skills are named "${name}".`)
    }
    seen.add(name)

    return {
      name,
      description: readDescription(item.description, name),
      body: readBody(item.body, name),
    }
  })
}

function readName(value: unknown, index: number): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!NAME.test(name) || name.length > 64) {
    const shown = name.slice(0, 70)
    throw new Error(
      `Skill ${index + 1}: the name must use lowercase letters, digits and single hyphens (max 64), got "${shown}".`,
    )
  }

  return name
}

function readDescription(value: unknown, name: string): string {
  const description = typeof value === 'string' ? value.trim() : ''
  if (!description) {
    throw new Error(`Skill "${name}" needs a description.`)
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(
      `The description of "${name}" is longer than ${MAX_DESCRIPTION} characters.`,
    )
  }

  return description
}

function readBody(value: unknown, name: string): string {
  const body = typeof value === 'string' ? value : ''
  if (body.length > MAX_BODY) {
    throw new Error(
      `The body of "${name}" is longer than ${MAX_BODY} characters.`,
    )
  }

  return body
}

/** Checks one expected value: a skill name from the catalog, or null for none. */
export function readExpected(value: unknown, skills: Skill[]): string | null {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 'none'
  ) {
    return null
  }
  if (typeof value !== 'string' || !skills.some((s) => s.name === value)) {
    throw new Error(
      `"${String(value).slice(0, 70)}" is not a skill in the catalog.`,
    )
  }
  return value
}

/** Checks one request text. */
export function readRequest(value: unknown): string {
  const request = typeof value === 'string' ? value.trim() : ''
  if (!request) {
    throw new Error('A test request is empty.')
  }
  if (request.length > MAX_REQUEST) {
    throw new Error(`Keep each request under ${MAX_REQUEST} characters.`)
  }
  return request
}

/** Checks the test list a user sends. */
export function readTests(value: unknown, skills: Skill[]): TestCase[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('Give at least one test request.')
  }
  if (value.length > MAX_TESTS) {
    throw new Error(`Keep the test list at ${MAX_TESTS} requests or fewer.`)
  }

  return value.map((item) => {
    if (!isObject(item)) {
      throw new Error(
        'Each test must be an object with "request" and "expected".',
      )
    }

    return {
      request: readRequest(item.request),
      expected: readExpected(item.expected, skills),
    }
  })
}
