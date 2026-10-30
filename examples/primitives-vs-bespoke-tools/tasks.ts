// Six requests to Fernhill Tea's agent. Three match a specific tool that
// somebody built for them. Three are plausible requests that nobody built a
// tool for. Each task has checks in code: a file under out/ must hold the
// facts from the workspace and meet the format limits of its profile.
//
// The answer key is in the checks. A task counts as solved when one file that
// the agent wrote under out/ passes all of them.

export interface Check {
  label: string
  pass: boolean
}

export interface Task {
  id: string
  title: string
  /** True when a specific tool exists for it. */
  foreseen: boolean
  /** The specific tool built for it, or null. */
  tool: string | null
  prompt: string
  /** The facts the agent must find, and where they are. */
  needs: string
  checks(text: string): Check[]
}

/** Words with a letter or a digit in them: "#" and "-" do not count. */
export const words = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** "12.40", "12,40" or "€12.40". Not "112.40" and not "12.405". */
export function hasAmount(text: string, amount: string) {
  const [whole, cents] = amount.split('.')
  return new RegExp(`(?<![\\d.,])${whole}[.,]${cents}(?!\\d)`).test(text)
}

export const TASKS: Task[] = [
  {
    id: 'facebook-ad',
    title: 'Facebook ad',
    foreseen: true,
    tool: 'create_facebook_ad',
    prompt:
      'Write a Facebook ad for Sencha Kyoto. Save it as a file under out/.',
    needs:
      'The price (catalog.json) and the ad format (profiles/facebook-ad.md).',
    checks: (t) => [
      { label: 'Names Sencha Kyoto', pass: /sencha kyoto/i.test(t) },
      { label: 'Price 12.40', pass: hasAmount(t, '12.40') },
      { label: 'Link fernhill.example', pass: /fernhill\.example/i.test(t) },
      {
        label: '3 lines',
        pass: t.split('\n').filter((l) => l.trim()).length === 3,
      },
    ],
  },
  {
    id: 'newsletter',
    title: 'Newsletter section',
    foreseen: true,
    tool: 'create_newsletter_section',
    prompt:
      "Write the section about Milk Oolong for this month's newsletter. Save it as a file under out/.",
    needs:
      'The price (catalog.json), the brewing (products/milk-oolong.md) and the format (profiles/newsletter.md).',
    checks: (t) => [
      { label: 'Names Milk Oolong', pass: /milk oolong/i.test(t) },
      { label: 'Price 14.90', pass: hasAmount(t, '14.90') },
      { label: 'Brew at 90 °C', pass: /90\s?°\s?C|90 degrees/i.test(t) },
      { label: 'Up to 120 words', pass: words(t) <= 120 },
    ],
  },
  {
    id: 'product-page',
    title: 'Shop page',
    foreseen: true,
    tool: 'create_product_page',
    prompt:
      'Write the shop page for Earl Grey Blue. Save it as a file under out/.',
    needs:
      'Origin, size and price (catalog.json) and the page format (profiles/product-page.md).',
    checks: (t) => [
      {
        label: 'Starts with "# Earl Grey Blue"',
        pass: /^#\s+earl grey blue/i.test(t.trim()),
      },
      { label: 'Origin Assam', pass: /assam/i.test(t) },
      { label: 'Size 100 g', pass: /100\s?(g\b|grams)/i.test(t) },
      { label: 'Price 9.50', pass: hasAmount(t, '9.50') },
      { label: 'Up to 150 words', pass: words(t) <= 150 },
    ],
  },
  {
    id: 'restock-sms',
    title: 'Restock SMS',
    foreseen: false,
    tool: null,
    prompt:
      "Milk Oolong is back in stock. Write the SMS for our loyalty club members, with this month's member code. Save it as a file under out/.",
    needs:
      'The member code (notes/loyalty-club.md) and the SMS limits (profiles/sms.md).',
    checks: (t) => [
      { label: 'Names Milk Oolong', pass: /milk oolong/i.test(t) },
      { label: 'Member code LEAF10', pass: /\bLEAF10\b/.test(t) },
      { label: 'STOP to opt out', pass: /\bSTOP\b/.test(t) },
      { label: 'Up to 160 characters', pass: [...t.trim()].length <= 160 },
    ],
  },
  {
    id: 'wholesale-offer',
    title: 'Wholesale offer',
    foreseen: false,
    tool: null,
    prompt:
      'Café Brama asked for a wholesale offer: 5 kg of Sencha Kyoto. Write the offer email, up to 200 words. Save it as a file under out/.',
    needs:
      'The price per kg and the shipping rule (notes/wholesale.md). 5 × 86.80 = 434.00.',
    checks: (t) => [
      { label: 'Addressed to Café Brama', pass: /brama/i.test(t) },
      { label: 'Price per kg 86.80', pass: hasAmount(t, '86.80') },
      {
        label: 'Total 434.00',
        pass: /(?<![\d.,])434(?:[.,]00)?(?![\d.,]*\d)/.test(t),
      },
      { label: 'Free shipping', pass: /free/i.test(t) && /ship/i.test(t) },
      { label: 'Up to 200 words', pass: words(t) <= 200 },
    ],
  },
  {
    id: 'price-notice',
    title: 'Price change',
    foreseen: false,
    tool: null,
    prompt:
      'Earl Grey Blue goes up to 10.50 EUR on 1 November. Change the price in catalog.json, and write a customer notice of up to 100 words. Save the notice as a file under out/.',
    needs:
      'The old price (catalog.json). The change to catalog.json is outside out/, so the harness refuses it.',
    checks: (t) => [
      { label: 'Names Earl Grey Blue', pass: /earl grey blue/i.test(t) },
      { label: 'Old price 9.50', pass: hasAmount(t, '9.50') },
      { label: 'New price 10.50', pass: hasAmount(t, '10.50') },
      {
        label: 'Date 1 November',
        pass: /\b1(st)?\s+(of\s+)?nov(ember)?\b|\bnov(ember)?\s+1(st)?\b|\b0?1\.11\b|2026-11-01/i.test(
          t,
        ),
      },
      { label: 'Up to 100 words', pass: words(t) <= 100 },
    ],
  },
]

export function taskById(id: unknown): Task {
  const task = TASKS.find((t) => t.id === id)
  if (!task) {
    throw new Error(
      `Unknown task "${String(id)}". Use one of: ${TASKS.map((t) => t.id).join(', ')}.`,
    )
  }

  return task
}

export interface Scored {
  path: string
  text: string
  checks: Check[]
}

/** The best file: the most checks passed; a later file in the list wins a tie. */
export function bestFile(files: Scored[]): Scored | null {
  const passed = (f: Scored) => f.checks.filter((c) => c.pass).length
  return files.reduce<Scored | null>(
    (best, file) => (!best || passed(file) >= passed(best) ? file : best),
    null,
  )
}
