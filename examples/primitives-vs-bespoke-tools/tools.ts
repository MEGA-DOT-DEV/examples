// The two tool sets. Both can reach the same writer: a nested model call that
// writes one text, specialized by a profile file (voice and format).
//
//   specific    8 narrow tools that someone built for known jobs. Each writer
//               has its kind, its profile and its output path fixed in code.
//   primitives  4 general tools: search, read, generate_creation and write.
//               The agent picks the kind, the profile, the facts and the path.
//               The harness checks every write path against one rule.
import type { FunctionTool } from '#shared/llm.ts'
import type { Tool } from '../agent-loop/agent.ts'
import { RULE, type Workspace } from './workspace.ts'

export type ModeId = 'specific' | 'primitives'

export interface Creation {
  /** The tool that asked for it. */
  tool: string
  kind: string
  /** Path of the profile file. */
  profile: string
  /** The brief and the facts: all the writer sees besides the profile. */
  input: string
}

export interface ToolContext {
  workspace: Workspace
  /** One nested model call. Returns the text. */
  create(creation: Creation): Promise<string>
  /** The agent's current step, and the next number in the task's timeline. */
  step(): number
  next(): number
}

interface Entry {
  definition: FunctionTool
  run(context: ToolContext, args: Record<string, unknown>): unknown
}

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): FunctionTool {
  return {
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
  }
}

const str = (description: string) => ({ type: 'string', description })
const PRODUCT_IDS = [
  'sencha-kyoto',
  'milk-oolong',
  'earl-grey-blue',
  'rooibos-vanilla',
]
const productId = { type: 'string', enum: PRODUCT_IDS, description: 'The tea.' }

type CatalogEntry = { id: string; name: string; price_eur: string }
const catalog = (workspace: Workspace) =>
  JSON.parse(workspace.read('catalog.json')) as CatalogEntry[]

/** The catalog entry and the product notes of one tea, as the specific tools read them. */
function product(workspace: Workspace, id: unknown): string {
  const entry = catalog(workspace).find((p) => p.id === id)
  if (!entry) {
    throw new Error(
      `No product "${String(id)}". Use one of: ${PRODUCT_IDS.join(', ')}.`,
    )
  }

  const notes = workspace.read(`products/${entry.id}.md`)

  return `${JSON.stringify(entry)}\n\n${notes}`
}

/** A specific writer: kind, profile and path are fixed. Only the tea (and one brief field) comes from the model. */
function writer(
  name: string,
  description: string,
  kind: string,
  folder: string,
  brief?: { field: string; about: string },
): Entry {
  return {
    definition: fn(name, description, {
      product_id: productId,
      ...(brief ? { [brief.field]: str(brief.about) } : {}),
    }),
    run: async (context, args) => {
      const facts = product(context.workspace, args.product_id)
      const input = brief
        ? `${facts}\n\n${brief.field}: ${String(args[brief.field] ?? '')}`
        : facts

      const text = await context.create({
        tool: name,
        kind,
        profile: `profiles/${folder}.md`,
        input,
      })

      const path = `out/${folder}/${args.product_id}.md`
      context.workspace.write(path, text, name, context.step(), context.next())

      return { saved: path, text }
    },
  }
}

const SPECIFIC: Entry[] = [
  {
    definition: fn(
      'list_products',
      'Lists the teas in the shop: id, name and price.',
    ),
    run: (c) =>
      catalog(c.workspace).map(({ id, name, price_eur }) => ({
        id,
        name,
        price_eur,
      })),
  },
  {
    definition: fn(
      'get_product',
      'Returns the catalog entry and the product notes of one tea.',
      { product_id: productId },
    ),
    run: (c, a) => product(c.workspace, a.product_id),
  },
  writer(
    'create_facebook_ad',
    'Writes a Facebook ad for one tea and saves it to out/facebook-ad/<product_id>.md.',
    'Facebook ad',
    'facebook-ad',
  ),
  writer(
    'create_instagram_post',
    'Writes an Instagram post about one tea and saves it to out/instagram-post/<product_id>.md.',
    'Instagram post',
    'instagram-post',
  ),
  writer(
    'create_newsletter_section',
    'Writes the section about one tea for the monthly newsletter and saves it to out/newsletter/<product_id>.md.',
    'newsletter section',
    'newsletter',
  ),
  writer(
    'create_product_page',
    'Writes the shop page of one tea and saves it to out/product-page/<product_id>.md.',
    'shop page',
    'product-page',
  ),
  writer(
    'create_promo_email',
    'Writes a promo email to shop customers about one tea and one offer, and saves it to out/promo-email/<product_id>.md.',
    'promo email',
    'promo-email',
    { field: 'offer', about: 'The offer, in one sentence.' },
  ),
  writer(
    'create_blog_post',
    'Writes a blog post about one tea and saves it to out/blog-post/<product_id>.md.',
    'blog post',
    'blog-post',
    { field: 'topic', about: 'What the post teaches.' },
  ),
]

const PRIMITIVES: Entry[] = [
  {
    definition: fn(
      'search',
      'Searches every file of the shop (catalog, products, profiles, notes) and returns matching lines with their path. An empty query lists all files.',
      { query: str('Words to look for.') },
    ),
    run: (c, a) => ({ hits: c.workspace.search(a.query) }),
  },
  {
    definition: fn('read', 'Returns the full text of one file.', {
      path: str('File path, for example catalog.json.'),
    }),
    run: (c, a) => c.workspace.read(a.path),
  },
  {
    // The general writer: the same nested call as the specific writers, specialized by the profile the agent picks.
    definition: fn(
      'generate_creation',
      'Writes one text of any kind (an ad, an email, a page, a message) with a writer model. The profile file sets the voice and the format. The writer sees only the profile and input.',
      {
        kind: str('What to write, for example "Facebook ad".'),
        profile: str(
          'Path of a profile file, for example profiles/brand-voice.md.',
        ),
        input: str('The brief and every fact the text must hold.'),
      },
    ),
    run: async (c, a) => ({
      text: await c.create({
        tool: 'generate_creation',
        kind: String(a.kind ?? ''),
        profile: String(a.profile ?? ''),
        input: String(a.input ?? ''),
      }),
    }),
  },
  {
    definition: fn(
      'write',
      'Saves a text file. Only paths under out/ are allowed.',
      {
        path: str('File path, for example out/notes.md.'),
        content: str('The full text of the file.'),
      },
    ),
    run: (context, args) => {
      const check = context.workspace.write(
        args.path,
        String(args.content ?? ''),
        'write',
        context.step(),
        context.next(),
      )

      // The rule lives in the harness: a refused write returns the reason to the model and changes nothing.
      return check.ok
        ? { saved: check.path }
        : { status: 'refused', rule: RULE, reason: check.reason }
    },
  },
]

const SETS: Record<ModeId, Entry[]> = {
  specific: SPECIFIC,
  primitives: PRIMITIVES,
}

/** The tool definitions that a mode sends with every request. */
export const definitions = (mode: ModeId): FunctionTool[] =>
  SETS[mode].map((e) => e.definition)

/** The tools of a mode, bound to one task's workspace. */
export function toolsFor(mode: ModeId, context: ToolContext): Tool[] {
  return SETS[mode].map((e) => ({
    definition: e.definition,
    run: (args) => e.run(context, args ?? {}),
  }))
}
