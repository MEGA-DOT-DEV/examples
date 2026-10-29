// A fictional shop, the Worker's task, the Coordinator's correction, and
// the check in code. The correction is one exact fact on purpose, so code can
// tell whether a text follows it: the euro price, and no dollars.

export interface Product {
  id: string
  name: string
  about: string
  usd: number
  eur: number
}

export const SHOP = 'Fernhill Goods'

export const PRODUCTS: Product[] = [
  {
    id: 'ember-lamp',
    name: 'Ember desk lamp',
    about: 'brushed brass, dimmable, warm 2700 K LED, 45 cm tall',
    usd: 64,
    eur: 59,
  },
  {
    id: 'tide-mug',
    name: 'Tide mug',
    about: 'stoneware, 350 ml, hand-glazed in sea green, dishwasher safe',
    usd: 22,
    eur: 20,
  },
  {
    id: 'loom-throw',
    name: 'Loom throw',
    about: 'merino wool, 130 x 170 cm, herringbone weave, oat color',
    usd: 89,
    eur: 82,
  },
  {
    id: 'pine-shelf',
    name: 'Pine wall shelf',
    about: 'solid pine, 60 cm, oiled finish, hidden brackets included',
    usd: 48,
    eur: 44,
  },
  {
    id: 'dusk-candle',
    name: 'Dusk candle',
    about: 'soy wax, cedar and fig scent, burns about 40 hours',
    usd: 18,
    eur: 17,
  },
  {
    id: 'reed-basket',
    name: 'Reed basket',
    about: 'hand-woven reed, 35 cm wide, two rope handles',
    usd: 35,
    eur: 32,
  },
  {
    id: 'slate-board',
    name: 'Slate board',
    about: 'natural slate, 30 x 20 cm, comes with a soapstone chalk',
    usd: 29,
    eur: 27,
  },
  {
    id: 'quill-pen',
    name: 'Quill fountain pen',
    about: 'brass body, steel nib, refillable converter, gift tin',
    usd: 42,
    eur: 39,
  },
]

export const PRODUCT_IDS = PRODUCTS.map((p) => p.id)

export function productById(id: unknown): Product | undefined {
  return PRODUCTS.find((p) => p.id === id)
}

/** The catalog as the Worker reads it. */
export const CATALOG = PRODUCTS.map(
  (p) =>
    `- ${p.id}: ${p.name}. ${p.about}. price_usd ${p.usd}, price_eur ${p.eur}`,
).join('\n')

/** The task as the Worker starts it: prices in dollars. The correction changes that. */
export const BRIEF = `Write a short product text for each of the 8 products of ${SHOP}, in catalog order: about 50 words, warm and concrete, ending with the price in US dollars. Save each text with save_text as soon as it is written, one call per product. When all 8 are saved, answer "done".`

/** The Coordinator's correction. It is global: it also covers the texts the Worker already saved. */
export const CORRECTION =
  'Use euro prices in all 8 texts: write price_eur with the € sign. Never write USD, dollar or a $ sign. This also applies to the texts you already saved: save each of them again with the euro price. Then go on with your task.'

export const ARRIVES_AFTER = 3

export interface Check {
  /** The text names the product's euro price. */
  eur: boolean
  /** No "$", "USD" or "dollar". */
  noUsd: boolean
  pass: boolean
  /** Why it fails, in a few words: "dollar price". Empty when it passes. */
  why: string
}

/** Checks one text against the correction. Exact, in code. */
export function checkText(product: Product, text: string): Check {
  const n = `${product.eur}(?:[.,]00)?`
  // "€59", "€ 59.00", "59 €", "EUR 59", "59 EUR", "59 euros".
  const eur = new RegExp(
    `€\\s?${n}(?![\\d.,]*\\d)|(?<![\\d.,])${n}\\s?(€|eur\\b|euros?\\b)|\\beur\\s?${n}(?![\\d.,]*\\d)`,
    'i',
  ).test(text)
  const noUsd = !/\$|\busd\b|dollar/i.test(text)

  return { eur, noUsd, pass: eur && noUsd, why: failReason(eur, noUsd) }
}

function failReason(eur: boolean, noUsd: boolean) {
  if (!noUsd) {
    return 'dollar price'
  }
  if (!eur) {
    return 'no euro price'
  }

  return ''
}
