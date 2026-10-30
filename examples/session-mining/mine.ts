// The script half of "script first": it counts and extracts, and judges
// nothing. No model, no cost, milliseconds.
//   - how often each skill was loaded, and when last
//   - every user follow-up that looks like a correction, with its session
import { plural } from '#shared/print.ts'
import { type Session, SKILLS } from './sessions.ts'

/**
 * Words that people use when they correct someone. A crude filter on
 * purpose: it keeps every correction and some follow-ups that are not
 * corrections ("No rush"). The model sorts that out.
 */
export const CORRECTION =
  /\b(no|not|don't|do not|never|stop|again|instead|wrong|should|still|too|next time|did you|you said)\b/i

export interface SkillLoads {
  skill: string
  loads: number
  sessions: string[]
  last: string | null
  lastDate: string | null
}
export interface Correction {
  session: string
  date: string
  skills: string[]
  text: string
}

export function countLoads(sessions: Session[]): SkillLoads[] {
  return SKILLS.map(({ name }) => {
    const hits = sessions.filter((s) => s.skills.includes(name))

    return {
      skill: name,
      loads: hits.length,
      sessions: hits.map((s) => s.id),
      last: hits.at(-1)?.id ?? null,
      lastDate: hits.at(-1)?.date ?? null,
    }
  })
}

/** User turns that answer the agent (not the first request) and match CORRECTION. */
export function extractCorrections(sessions: Session[]): Correction[] {
  return sessions.flatMap((s) =>
    s.turns
      .filter(
        ([role, text], i) => role === 'user' && i > 0 && CORRECTION.test(text),
      )
      .map(([, text]) => ({
        session: s.id,
        date: s.date,
        skills: s.skills,
        text,
      })),
  )
}

export function mine(sessions: Session[]) {
  const started = performance.now()
  const loads = countLoads(sessions)
  const corrections = extractCorrections(sessions)
  const followUps = sessions.reduce(
    (n, s) =>
      n + s.turns.filter(([role], i) => role === 'user' && i > 0).length,
    0,
  )

  return {
    loads,
    corrections,
    followUps,
    ms: Math.round((performance.now() - started) * 100) / 100,
  }
}

export type Mined = ReturnType<typeof mine>

/** What "script first" sends to the model: the counts and the extracted lines, nothing else. */
export function findingsText(sessions: Session[], mined: Mined): string {
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  const span = `${sessions.length} sessions, ${first.id} on ${first.date} to ${last.id} on ${last.date}.`
  const kept = `${mined.corrections.length} of ${mined.followUps} follow-ups, kept by a keyword filter, so some are not corrections`

  return [
    `${span} A script read them and counted; it did not judge anything.`,
    '',
    'Skill loads:',
    ...mined.loads.map(loadLine),
    '',
    `User follow-ups that may be corrections (${kept}):`,
    ...mined.corrections.map(
      (c) =>
        `- ${c.session} (${c.date}, skills: ${c.skills.join(', ') || 'none'}): "${c.text}"`,
    ),
  ].join('\n')
}

/** One line of the load counts. Sessions are listed only for a rare skill. */
function loadLine({ skill, loads, sessions, last, lastDate }: SkillLoads) {
  if (!loads) {
    return `- ${skill}: never loaded`
  }

  const where = loads <= 6 ? ` (${sessions.join(', ')})` : ''
  const count = plural(loads, 'session')

  return `- ${skill}: loaded in ${count}${where}, last in ${last} on ${lastDate}`
}

/** What "read everything" sends: every session in full. */
export function transcriptsText(sessions: Session[]): string {
  return sessions
    .map((s) =>
      [
        `=== ${s.id} · ${s.date} · skills loaded: ${s.skills.join(', ') || 'none'} ===`,
        ...s.turns.map(([role, text]) => `${role}: ${text}`),
      ].join('\n'),
    )
    .join('\n\n')
}
