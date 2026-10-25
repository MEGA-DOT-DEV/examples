// Pages under docs/ (setup, and later other guides). The viewer lists them
// in a "Start here" group above the examples.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../shared/env.ts'
import { type Meta, parseFrontmatter, str } from './meta.ts'

export interface Doc {
  name: string
  file: string
  meta: Meta | null
  title: string
  summary: string
  order: number
  /** Show the live setup status (Node.js version, keys) above the text. */
  status: boolean
  error?: string
}

export function scanDocs(root: string = ROOT): Doc[] {
  const dir = join(root, 'docs')
  if (!existsSync(dir)) {
    return []
  }
  const docs: Doc[] = []
  for (const file of readdirSync(dir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('.'),
  )) {
    const path = join(dir, file)
    const doc: Doc = {
      name: file.slice(0, -3),
      file: path,
      meta: null,
      title: file.slice(0, -3),
      summary: '',
      order: Number.POSITIVE_INFINITY,
      status: false,
    }
    try {
      doc.meta = parseFrontmatter(readFileSync(path, 'utf8')).meta
    } catch (error) {
      doc.error = (error as Error).message
    }
    if (doc.meta) {
      doc.title = str(doc.meta, 'title') || doc.name
      doc.summary = str(doc.meta, 'summary')
      if (/^\d+$/.test(str(doc.meta, 'order'))) {
        doc.order = Number(str(doc.meta, 'order'))
      }
      doc.status = str(doc.meta, 'status') === 'true'
    } else if (!doc.error) {
      doc.error = 'no frontmatter'
    }
    docs.push(doc)
  }
  return docs.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}
