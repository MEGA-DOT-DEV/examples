import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT } from '../../shared/env.ts'
import { scanDocs } from './docs.ts'
import { lessonProblems } from './lessons.ts'
import { str } from './meta.ts'
import { type Item, metaFileName, scan } from './repo.ts'

export const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Lesson numbers do not belong in names. Lessons link to folders by idea. */
export const LESSON_NUMBER = /s\d\de\d\d|week-\d|lesson-\d/i
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

/** Returns the problems with a name, or [] when it is valid. */
export function nameProblems(name: string): string[] {
  const problems: string[] = []
  if (!KEBAB.test(name)) {
    problems.push(`"${name}" is not kebab-case`)
  }
  if (LESSON_NUMBER.test(name)) {
    problems.push(
      `"${name}" contains a lesson number; name the idea, not the lesson`,
    )
  }
  if (name.length > 64) {
    problems.push(`"${name}" is longer than 64 characters`)
  }
  return problems
}

// "/kit/kit.js" breaks when the viewer runs under a path (/examples/). Pages use
// "../../kit/kit.js", and call the API through the kit.
const ABSOLUTE_URL =
  /(?:\b(?:href|src|action)\s*=\s*["']|\bfrom\s*["']|\bimport\(\s*["']|\bfetch\(\s*["'`]|\burl\(\s*["']?)\/(?!\/)/

function absoluteUrlProblems(dir: string): string[] {
  const problems: string[] = []
  for (const name of readdirSync(dir)) {
    if (!/\.(html|js|css)$/.test(name)) {
      continue
    }
    const lines = readFileSync(join(dir, name), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (ABSOLUTE_URL.test(line)) {
        problems.push(
          `ui/${name}:${i + 1}: use a relative URL (../../kit/kit.js), not one that starts with "/"`,
        )
      }
    })
  }
  return problems
}

function itemProblems(item: Item): string[] {
  const problems = [...nameProblems(item.folder)]
  if (item.error) {
    return [...problems, item.error]
  }
  const meta = item.meta!
  const file = metaFileName(item.kind)
  const name = str(meta, 'name')

  if (!name) {
    problems.push(`${file}: missing "name"`)
  } else if (name !== item.folder) {
    problems.push(
      `${file}: name "${name}" does not match folder "${item.folder}"`,
    )
  }

  const order = str(meta, 'order')
  if (order && !/^\d+$/.test(order)) {
    problems.push(`${file}: "order" must be a whole number`)
  }

  // ui/index.html is the page that `mex open` shows; api.ts only serves that page.
  if (existsSync(join(item.dir, 'ui')) && !item.ui) {
    problems.push('ui/ needs an index.html')
  }
  if (item.kind === 'skill' && (item.ui || item.api)) {
    problems.push('a skill has no ui/ or api.ts')
  } else if (item.api && !item.ui) {
    problems.push('api.ts serves a ui page; add ui/index.html or remove api.ts')
  }
  if (item.ui) {
    problems.push(...absoluteUrlProblems(join(item.dir, 'ui')))
  }

  if (item.kind === 'skill') {
    const description = str(meta, 'description')
    if (!description) {
      problems.push(`${file}: missing "description"`)
    }
    if (description.length > 1024) {
      problems.push(`${file}: "description" is longer than 1024 characters`)
    }
    return problems
  }

  for (const key of ['title', 'summary', 'kind']) {
    if (!str(meta, key)) {
      problems.push(`${file}: missing "${key}"`)
    }
  }
  const kind = str(meta, 'kind')
  if (kind && kind !== item.kind) {
    problems.push(
      `${file}: kind "${kind}" must be "${item.kind}" in this folder`,
    )
  }
  const summary = str(meta, 'summary')
  if (summary && (!summary.endsWith('.') || summary.length > 200)) {
    problems.push(
      `${file}: "summary" must be one sentence that ends with a period, max 200 characters`,
    )
  }
  for (const key of ['needs', 'needsAny']) {
    const value = meta[key]
    if (value === undefined) {
      continue
    }
    if (typeof value === 'string' && value !== '') {
      problems.push(`${file}: "${key}" must be a list, like [OPENAI_API_KEY]`)
    }
    for (const env of Array.isArray(value) ? value : []) {
      if (!ENV_NAME.test(env)) {
        problems.push(
          `${file}: "${env}" in "${key}" is not an env variable name`,
        )
      }
    }
  }
  if (item.entry && !existsSync(item.entry)) {
    problems.push(`missing entry file ${relative(item.dir, item.entry)}`)
  }
  return problems
}

export interface CheckResult {
  items: Item[]
  /** Each problem starts with the item path. */
  problems: string[]
}

/** Validates every folder under examples/, skills/ and tools/. */
export function checkRepo(root: string = ROOT): CheckResult {
  const items = scan(root)
  const problems: string[] = []
  const seen = new Map<string, Item>()
  for (const item of items) {
    const where = relative(root, item.dir)
    for (const problem of itemProblems(item)) {
      problems.push(`${where}: ${problem}`)
    }
    const other = seen.get(item.name)
    if (other) {
      problems.push(
        `${where}: name "${item.name}" is also used by ${relative(root, other.dir)}`,
      )
    }
    seen.set(item.name, item)
  }
  // docs/*.md pages share the viewer's address space (#/<name>) with items.
  for (const doc of scanDocs(root)) {
    const where = relative(root, doc.file)
    const docProblems = [...nameProblems(doc.name)]
    if (doc.error) {
      docProblems.push(doc.error)
    } else {
      if (str(doc.meta!, 'name') !== doc.name) {
        docProblems.push(
          `name "${str(doc.meta!, 'name')}" does not match file "${doc.name}.md"`,
        )
      }
      for (const key of ['title', 'summary']) {
        if (!str(doc.meta!, key)) {
          docProblems.push(`missing "${key}"`)
        }
      }
    }
    if (seen.has(doc.name)) {
      docProblems.push(
        `name "${doc.name}" is also used by ${relative(root, seen.get(doc.name)!.dir)}`,
      )
    }
    for (const problem of docProblems) {
      problems.push(`${where}: ${problem}`)
    }
  }
  // lessons.json: every name it lists is a folder, and each one is in one lesson.
  problems.push(
    ...lessonProblems(new Set(items.map((item) => item.name)), root),
  )
  return { items, problems }
}
