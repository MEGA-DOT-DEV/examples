import type { InboundEvent } from '../src/types.ts'
import burst from './burst.json'
import correctNote from './correct-note.json'
import deleteNote from './delete-note.json'
import injectionLink from './injection-link.json'
import linkNote from './link-note.json'
import linkSaved from './link-saved.json'
import noteEdit from './note-edit.json'
import redirectLink from './redirect-link.json'
import untrustedLink from './untrusted-link.json'

export type Sample = {
  readonly name: string
  readonly title: string
  readonly events: readonly InboundEvent[]
}

const files = {
  'link-saved': linkSaved,
  'note-edit': noteEdit,
  'correct-note': correctNote,
  'link-note': linkNote,
  'delete-note': deleteNote,
  'untrusted-link': untrustedLink,
  'redirect-link': redirectLink,
  'injection-link': injectionLink,
  burst,
}

export const SAMPLES: readonly Sample[] = Object.entries(files).map(
  ([name, sample]) => ({
    name,
    title: sample.title,
    events: sample.events as InboundEvent[],
  }),
)
