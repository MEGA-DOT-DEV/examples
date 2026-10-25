// Which lesson each example comes from. One file in the repo root,
// lessons.json, holds the whole map, so folders and their metadata stay free
// of lesson numbers: moving an example to another lesson changes one line
// there. The viewer groups its sidebar by it. The file is optional, and an
// example that it does not list shows under "More examples".
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../shared/env.ts'

export const LESSONS_FILE = 'lessons.json'

export interface Lesson {
  /** As the course names it, for example S01E03. */
  episode: string
  title: string
  /** Example, tool or skill names, as their folders. */
  items: string[]
}

export interface LessonMap {
  lessons: Lesson[]
  /** Set when the file exists but cannot be read as a map. */
  error?: string
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

export function readLessons(root: string = ROOT): LessonMap {
  const file = join(root, LESSONS_FILE)
  if (!existsSync(file)) {
    return { lessons: [] }
  }
  return parseLessons(readFileSync(file, 'utf8'))
}

/** Reads the map from the text of lessons.json. */
export function parseLessons(text: string): LessonMap {
  let json: any
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { lessons: [], error: `not valid JSON: ${(error as Error).message}` }
  }
  if (!Array.isArray(json?.lessons)) {
    return { lessons: [], error: '"lessons" must be a list' }
  }
  const lessons: Lesson[] = []
  for (const [i, lesson] of json.lessons.entries()) {
    if (
      !isText(lesson?.episode) ||
      !isText(lesson?.title) ||
      !Array.isArray(lesson?.items) ||
      !lesson.items.every(isText)
    ) {
      return {
        lessons: [],
        error: `lesson ${i + 1} needs "episode", "title" and "items" (a list of folder names)`,
      }
    }
    lessons.push({
      episode: lesson.episode.trim(),
      title: lesson.title.trim(),
      items: lesson.items,
    })
  }
  return { lessons }
}

/** Problems with the map: names without a folder, a name in two lessons, an episode twice. */
export function lessonProblems(
  names: Set<string>,
  root: string = ROOT,
): string[] {
  const { lessons, error } = readLessons(root)
  if (error) {
    return [`${LESSONS_FILE}: ${error}`]
  }
  const problems: string[] = []
  const placed = new Map<string, string>()
  const episodes = new Set<string>()
  for (const lesson of lessons) {
    if (episodes.has(lesson.episode)) {
      problems.push(`${LESSONS_FILE}: ${lesson.episode} is listed twice`)
    }
    episodes.add(lesson.episode)
    for (const name of lesson.items) {
      if (!names.has(name)) {
        problems.push(
          `${LESSONS_FILE}: ${lesson.episode} lists "${name}", but no example, skill or tool has that name`,
        )
      }
      const other = placed.get(name)
      if (other) {
        problems.push(
          `${LESSONS_FILE}: "${name}" is in ${other} and in ${lesson.episode}; list it once`,
        )
      }
      placed.set(name, lesson.episode)
    }
  }
  return problems
}
