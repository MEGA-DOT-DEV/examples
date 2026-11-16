// config.yaml for a node a script owns: the user's file with some values set,
// every other line and comment kept. The checks run the offline lab brain,
// whatever models the user chose for their own node.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { ROOT } from './lab-node.ts'

/**
 * The user's config.yaml with `models` on the lab brain, then each `path →
 * value` of `set` applied.
 */
export function labConfig(set: Readonly<Record<string, unknown>> = {}): string {
  const doc = parseDocument(readFileSync(join(ROOT, 'config.yaml'), 'utf8'))
  doc.setIn(['models', 'primary'], 'lab/brain')
  doc.setIn(['models', 'secondary'], 'lab/brain')
  for (const [path, value] of Object.entries(set)) {
    doc.setIn(path.split('.'), value)
  }
  return doc.toString()
}
