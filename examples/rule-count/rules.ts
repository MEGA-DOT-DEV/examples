// 50 review rules. Each one is a separate requirement, and code checks it on
// the answer: the JSON, the code text, or what the code returns when it runs.
// The order mixes the kinds of rules, so the first 3, 10 or 25 are a fair sample.

export type Order = { unitCents: number; quantity: number; coupon: number }
export type Receipt = {
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
}

/** The receipt that the corrected checkout(order) must return. */
export function expected(order: Order): Receipt {
  const subtotal = order.unitCents * order.quantity
  const discount = Math.floor((subtotal * order.coupon) / 100)
  const shipping = subtotal >= 2000 ? 0 : 300
  const tax = Math.floor((subtotal - discount) / 10)
  return {
    subtotal,
    discount,
    shipping,
    tax,
    total: subtotal - discount + shipping + tax,
  }
}

/** Two orders per seeded defect: each pair gives a wrong receipt while that defect is in the code. */
export const DEFECT_PROBES: { line: number; orders: Order[] }[] = [
  {
    line: 8,
    orders: [
      { unitCents: 2050, quantity: 1, coupon: 20 },
      { unitCents: 500, quantity: 4, coupon: 10 },
    ],
  },
  {
    line: 9,
    orders: [
      { unitCents: 1499, quantity: 1, coupon: 0 },
      { unitCents: 900, quantity: 1, coupon: 5 },
    ],
  },
  {
    line: 10,
    orders: [
      { unitCents: 997, quantity: 1, coupon: 15 },
      { unitCents: 701, quantity: 1, coupon: 25 },
    ],
  },
]
/** The orders that test the fix: the defect probes, then a grid of prices, quantities and coupons. */
export const TEST_ORDERS: Order[] = [
  ...DEFECT_PROBES.flatMap((p) => p.orders),
  ...[199, 999, 1000, 1501, 1999, 2099].flatMap((unitCents, u) =>
    [1, 2, 3].map((quantity, q) => ({
      unitCents,
      quantity,
      coupon: [0, 5, 10, 20, 30][(u + q) % 5],
    })),
  ),
]

/** What the answer's code did, from one sandbox run (FACTS_SCRIPT). */
export interface Facts {
  receipts: unknown[]
  base: Record<string, unknown> | null
  keys: string[] | null
  frozen: boolean | null
  small: Record<string, unknown> | null
  qty0: string
  qtyHalf: string
  coupon150: string
  negativePrice: string
  textCoupon: Record<string, unknown> | null
}

// Runs after the answer's code, in the sandbox. `data` is TEST_ORDERS.
// A call that throws gives the error's name, so one bad order does not stop the rest.
export const FACTS_SCRIPT = `
if (typeof checkout !== 'function') throw new Error('the code does not define checkout(order)')
const __try = (o) => { try { return { value: checkout(o) } } catch (e) { return { thrown: (e && e.name) || 'Error' } } }
const __base = __try({ unitCents: 1000, quantity: 2, coupon: 10 }).value ?? null
return {
  receipts: data.map((o) => __try(o).value ?? null),
  base: __base,
  keys: __base && typeof __base === 'object' ? Object.keys(__base) : null,
  frozen: __base && typeof __base === 'object' ? Object.isFrozen(__base) : null,
  small: __try({ unitCents: 500, quantity: 1, coupon: 0 }).value ?? null,
  qty0: __try({ unitCents: 1000, quantity: 0, coupon: 10 }).thrown ?? 'nothing',
  qtyHalf: __try({ unitCents: 1000, quantity: 1.5, coupon: 10 }).thrown ?? 'nothing',
  coupon150: __try({ unitCents: 1000, quantity: 1, coupon: 150 }).thrown ?? 'nothing',
  negativePrice: __try({ unitCents: -1, quantity: 1, coupon: 0 }).thrown ?? 'nothing',
  textCoupon: __try({ unitCents: 1000, quantity: 2, coupon: '10' }).value ?? null,
}`

export type Finding = {
  line?: unknown
  reason?: unknown
  fix?: unknown
  severity?: unknown
}
/** The parsed answer: the whole JSON object, its code and its findings. */
export interface Answer {
  json: Record<string, unknown>
  text: string
  code: string
  findings: Finding[]
}

const reasons = (a: Answer) => a.findings.map((f) => String(f.reason ?? ''))
const everyReason = (a: Answer, test: (reason: string) => boolean) =>
  a.findings.length > 0 && reasons(a).every(test)
const lines = (a: Answer) => a.findings.map((f) => f.line)
const count = (text: string, pattern: RegExp) =>
  (text.match(pattern) ?? []).length
// Code without comments and string literals, so a "?" or "==" in a message does not count.
const bare = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""')
const summary = (a: Answer) =>
  typeof a.json.summary === 'string' ? a.json.summary : null
const sameReceipt = (value: unknown, receipt: Receipt) =>
  !!value &&
  typeof value === 'object' &&
  (Object.keys(receipt) as (keyof Receipt)[]).every(
    (k) => (value as Record<string, unknown>)[k] === receipt[k],
  )

export const RULES: {
  id: number
  text: string
  check: (a: Answer, f: Facts) => boolean
}[] = (
  [
    [
      'Keep the subtotal minus the discount in a local variable named `netCents`. The word `discounted` must not appear in the code. The receipt keeps its `subtotal` field.',
      (a) => /\bnetCents\b/.test(a.code) && !a.code.includes('discounted'),
    ],
    [
      'Report exactly one finding for each of lines 8, 9 and 10, and no others.',
      (a) =>
        lines(a).every((l) => typeof l === 'number') &&
        lines(a)
          .map(Number)
          .sort((x, y) => x - y)
          .join() === '8,9,10',
    ],
    [
      'Return the receipt with its keys in alphabetical order.',
      (_a, f) => !!f.keys && f.keys.join() === [...f.keys].sort().join(),
    ],
    [
      'Add a top-level `summary` of 200 characters or fewer.',
      (a) => typeof a.json.summary === 'string' && a.json.summary.length <= 200,
    ],
    [
      'Do not use the ternary operator `? :`.',
      (a) => !/(^|[^?])\?(?![.?])/.test(bare(a.code)),
    ],
    [
      'Throw a `TypeError` when the quantity is not a positive integer.',
      (_a, f) => f.qty0 === 'TypeError' && f.qtyHalf === 'TypeError',
    ],
    [
      'Write the code without semicolons: no `;` character at all.',
      (a) => !a.code.includes(';'),
    ],
    [
      'Sort the findings by line, highest first.',
      (a) =>
        a.findings.length > 1 &&
        lines(a).every(
          (l, i, all) => i === 0 || Number(all[i - 1]) > Number(l),
        ),
    ],
    [
      'Declare `const SHIPPING_FEE_CENTS = 300` and use it.',
      (a) =>
        /const\s+SHIPPING_FEE_CENTS\s*=\s*300\b/.test(a.code) &&
        count(a.code, /SHIPPING_FEE_CENTS/g) >= 2,
    ],
    [
      'Add `currency: "EUR"` to the receipt.',
      (_a, f) => f.base?.currency === 'EUR',
    ],
    [
      'Add a top-level `summary` that starts with `Verdict:`.',
      (a) => !!summary(a)?.startsWith('Verdict:'),
    ],
    [
      'Declare `const FREE_SHIPPING_MIN_CENTS = 2000` and use it.',
      (a) =>
        /const\s+FREE_SHIPPING_MIN_CENTS\s*=\s*2000\b/.test(a.code) &&
        count(a.code, /FREE_SHIPPING_MIN_CENTS/g) >= 2,
    ],
    [
      'Do not use the word "simply" anywhere in the answer.',
      (a) => !/simply/i.test(a.text),
    ],
    [
      'Start every finding reason with `[high]`, `[medium]` or `[low]`.',
      (a) => everyReason(a, (r) => /^\[(high|medium|low)\]/.test(r)),
    ],
    [
      'Start the code with the comment line `// checkout v2`.',
      (a) => a.code.trimStart().startsWith('// checkout v2'),
    ],
    [
      'Add `items` to the receipt: the quantity.',
      (_a, f) => f.base?.items === 2,
    ],
    [
      'Add a top-level `summary` that uses the word "rounding".',
      (a) => /rounding/i.test(summary(a) ?? ''),
    ],
    ['Do not use `Math.ceil`.', (a) => !a.code.includes('Math.ceil')],
    [
      'Throw a `RangeError` when the coupon is above 100.',
      (_a, f) => f.coupon150 === 'RangeError',
    ],
    [
      'Keep every finding reason at 140 characters or fewer.',
      (a) => everyReason(a, (r) => r.length <= 140),
    ],
    ['Do not use `let` or `var`.', (a) => !/\b(let|var)\s/.test(bare(a.code))],
    [
      'Return a frozen receipt (`Object.freeze`).',
      (_a, f) => f.frozen === true,
    ],
    [
      'Add a top-level `rulesVersion` field: the number 3.',
      (a) => a.json.rulesVersion === 3,
    ],
    [
      'Keep the code at 60 lines or fewer.',
      (a) => a.code.split('\n').length <= 60,
    ],
    [
      'Keep every code line at 80 characters or fewer.',
      (a) => a.code.split('\n').every((l) => l.length <= 80),
    ],
    [
      'End every finding reason with a period.',
      (a) => everyReason(a, (r) => r.trimEnd().endsWith('.')),
    ],
    [
      'Put a JSDoc block with `@param` and `@returns` right above `function checkout`.',
      (a) =>
        /\/\*\*(?:(?!\*\/)[\s\S])*@param(?:(?!\*\/)[\s\S])*@returns(?:(?!\*\/)[\s\S])*\*\/\s*function checkout\b/.test(
          a.code,
        ),
    ],
    [
      'Add `freeShipping` to the receipt: true when shipping is free, false when it is not.',
      (_a, f) =>
        f.base?.freeShipping === true && f.small?.freeShipping === false,
    ],
    [
      'Add a top-level `riskScore` field: an integer from 1 to 5.',
      (a) =>
        Number.isInteger(a.json.riskScore) &&
        (a.json.riskScore as number) >= 1 &&
        (a.json.riskScore as number) <= 5,
    ],
    [
      'Use only strict equality: no `==` and no `!=`.',
      (a) => !/(^|[^=!<>])==(?!=)|!=(?!=)/.test(bare(a.code)),
    ],
    [
      'Use the word "cents" in every finding reason.',
      (a) => everyReason(a, (r) => /cents/i.test(r)),
    ],
    [
      'Accept the coupon as a digit string too: coupon "10" gives the same receipt as coupon 10.',
      (_a, f) =>
        sameReceipt(
          f.textCoupon,
          expected({ unitCents: 1000, quantity: 2, coupon: 10 }),
        ),
    ],
    [
      'The code must not use template literals (backticks).',
      (a) => !a.code.includes('`'),
    ],
    ['Add `taxRate: 0.1` to the receipt.', (_a, f) => f.base?.taxRate === 0.1],
    [
      'Add a top-level `testsToAdd` array with at least 3 strings.',
      (a) =>
        Array.isArray(a.json.testsToAdd) &&
        a.json.testsToAdd.filter((t) => typeof t === 'string').length >= 3,
    ],
    [
      'Define a helper `roundDown(value)` and use it for every rounding. `Math.floor` may appear only inside it.',
      (a) =>
        count(a.code, /Math\.floor/g) === 1 &&
        count(a.code, /roundDown\(/g) >= 3,
    ],
    [
      'Give every finding a `fix` field: the corrected line as a string.',
      (a) =>
        a.findings.length > 0 &&
        a.findings.every(
          (f) => typeof f.fix === 'string' && f.fix.trim() !== '',
        ),
    ],
    [
      'Do not use exclamation marks in finding reasons or the summary.',
      (a) => ![...reasons(a), summary(a) ?? ''].join(' ').includes('!'),
    ],
    [
      'Mark the shipping decision with the comment `// from the original subtotal`.',
      (a) => a.code.includes('// from the original subtotal'),
    ],
    [
      'Add `discountPercent` to the receipt: the coupon as a number.',
      (_a, f) => f.base?.discountPercent === 10,
    ],
    [
      'Add a top-level `reviewer` field: "mex-bot".',
      (a) => a.json.reviewer === 'mex-bot',
    ],
    [
      'Use `Number.isInteger` for the input checks.',
      (a) => a.code.includes('Number.isInteger'),
    ],
    [
      'Give every finding a `severity` field: "high", "medium" or "low".',
      (a) =>
        a.findings.length > 0 &&
        a.findings.every((f) =>
          ['high', 'medium', 'low'].includes(String(f.severity)),
        ),
    ],
    [
      'Keep the signature `function checkout(order)`.',
      (a) => /function checkout\s*\(\s*order\s*\)/.test(a.code),
    ],
    [
      'Throw a `RangeError` when unitCents is negative.',
      (_a, f) => f.negativePrice === 'RangeError',
    ],
    [
      'Indent with two spaces, never with tabs.',
      (a) =>
        !a.code.includes('\t') &&
        a.code
          .split('\n')
          .filter((l) => !l.trimStart().startsWith('*'))
          .every((l) => (l.length - l.trimStart().length) % 2 === 0),
    ],
    [
      'Add `netCents` to the receipt: the subtotal minus the discount.',
      (_a, f) => f.base?.netCents === 1800,
    ],
    [
      'Add a top-level `lines` array: the finding lines, in the same order as the findings.',
      (a) =>
        Array.isArray(a.json.lines) &&
        JSON.stringify(a.json.lines) === JSON.stringify(lines(a)),
    ],
    [
      'Quote the changed code in backticks in every finding reason.',
      (a) => everyReason(a, (r) => /`[^`]+`/.test(r)),
    ],
    ['Do not use `Math.round`.', (a) => !a.code.includes('Math.round')],
  ] as [string, (a: Answer, f: Facts) => boolean][]
).map(([text, check], i) => ({ id: i + 1, text, check }))

/** The ids of the given rules that the answer breaks. A check that throws counts as broken. */
export function brokenRules(
  ids: number[],
  answer: Answer,
  facts: Facts,
): number[] {
  return ids.filter((id) => {
    try {
      return !RULES[id - 1].check(answer, facts)
    } catch {
      return true
    }
  })
}

/** How many test orders the fix gets right, and which seeded defects it left. */
export interface FixScore {
  correct: number
  total: number
  defectsLeft: number[]
}

/** How the fix does on TEST_ORDERS, and which seeded defects are still in it. */
export function scoreFix(facts: Facts): FixScore {
  const correct = TEST_ORDERS.filter((order, i) =>
    sameReceipt(facts.receipts[i], expected(order)),
  ).length

  let start = 0
  const defectsLeft = DEFECT_PROBES.filter((probe) => {
    const left = probe.orders.some(
      (order, n) => !sameReceipt(facts.receipts[start + n], expected(order)),
    )
    start += probe.orders.length
    return left
  }).map((probe) => probe.line)

  return { correct, total: TEST_ORDERS.length, defectsLeft }
}
