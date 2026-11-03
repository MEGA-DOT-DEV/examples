// Angie's morning: the sources that the research agent reads today,
// research.md as yesterday's research run left it, and the code that checks
// which day's facts a sent brief carries.

export const TODAY = 'Tuesday 20 October 2026'
export const YESTERDAY = 'Monday 19 October 2026'

export type SourceId = 'weather' | 'calendar' | 'news'
export const SOURCE_IDS: SourceId[] = ['weather', 'calendar', 'news']

/** Today's sources. Each one answers after a delay in minutes, drawn for each run from `minutes`. */
export const SOURCES: Record<
  SourceId,
  { text: string; minutes: [number, number] }
> = {
  weather: {
    text: `${TODAY}, city centre: sunny all day, 21 °C at noon, light wind.`,
    minutes: [2, 8],
  },
  calendar: {
    text: `${TODAY}, Angie's calendar: 09:30 call with Marek from the bank. 14:00 dentist, Oak Street 5.`,
    minutes: [1, 3],
  },
  news: {
    text: `${TODAY}, city news: Bridge Street is closed for repairs until Friday. Bus 12 takes a detour.`,
    minutes: [15, 45],
  },
}

/** research.md before today's research run writes it. */
export const YESTERDAY_FILE = `Date: ${YESTERDAY}
- Weather: heavy rain all day, 9 °C, strong wind.
- Calendar: 10:00 design review with Ines. 16:00 gym.
- News: a strike stops tram line 4 all day.`

export type Day = 'today' | 'yesterday'

// Words that only one day's facts use. The check looks for them in the sent brief.
const MARKERS: Record<Day, Record<SourceId, RegExp>> = {
  yesterday: {
    weather: /\brain|\b9\s?°|\b9 degrees/i,
    calendar: /\bInes\b|design review|\bgym\b/i,
    news: /\bstrike|\btram\b/i,
  },
  today: {
    weather: /\bsunny|\bsunshine|\b21\s?°|\b21 degrees/i,
    calendar: /\bMarek\b|\bdentist/i,
    news: /Bridge Street|\bbus 12\b|\bdetour/i,
  },
}

export interface Segment {
  text: string
  /** True when this sentence carries a fact from yesterday's file. */
  stale: boolean
}

export interface BriefCheck {
  /** For each source: whose facts the brief carries. */
  facts: Record<SourceId, Day | 'both' | null>
  /** The brief cut into sentences and line breaks, so a page can mark the stale ones. */
  segments: Segment[]
}

/** Checks a sent brief in code: today's facts, yesterday's facts, or none. */
export function checkBrief(text: string): BriefCheck {
  const dayOf = (id: SourceId) =>
    factDay(MARKERS.today[id].test(text), MARKERS.yesterday[id].test(text))
  const facts = {
    weather: dayOf('weather'),
    calendar: dayOf('calendar'),
    news: dayOf('news'),
  }

  // split() with a group keeps the separators: line breaks, and spaces after . ! ?
  const segments = text
    .split(/(\n+|(?<=[.!?])[ \t]+)/)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      stale: SOURCE_IDS.some((id) => MARKERS.yesterday[id].test(part)),
    }))

  return { facts, segments }
}

function factDay(today: boolean, yesterday: boolean): Day | 'both' | null {
  if (today && yesterday) {
    return 'both'
  }
  if (today) {
    return 'today'
  }
  if (yesterday) {
    return 'yesterday'
  }

  return null
}

// Words that tell the reader the research is from yesterday: its date in any
// form ("Mon 19 Oct", "dated Monday 19 October"), or words such as "outdated".
const OLD =
  /\b(yesterday|outdated|out[ -]of[ -]date|stale|not (?:yet )?(?:been )?(?:updated|refreshed)|previous day|not (?:from |for )?today|Mon(?:day)?|19 Oct(?:ober)?|Oct(?:ober)? 19|2026-10-19|old (?:research|file|data|information|notes))\b/i

/** The first sentence that says the research is from yesterday, or null. */
export function saysOld(text: string): string | null {
  const sentence = text.split(/\n+|(?<=[.!?])\s+/).find((s) => OLD.test(s))
  return sentence?.trim() || null
}
