// Eight vendor contracts that look alike: similar names, the same clause
// numbers, the same layout, and many numbers in days, euros and dates. Each
// contract has its own seat count, price tiers, notice period, term end and
// data region, and some change a value in an amendment at the end. The text is
// built from a fixed table, so every run reads the same contracts and the
// answer key below is exact.

export interface Vendor {
  file: string
  name: string
  /** Seats in the agreement (clause 2.2). */
  seats: number
  /** Seats added later by an order form in Schedule D. */
  addedSeats: number
  /** Price per seat and month, by the first seat of each tier. */
  tiers: { from: number; to: number | null; price: number }[]
  noticeDays: number
  /** Set when an amendment replaces the notice period. */
  amendedNoticeDays?: number
  termEnd: string
  /** Set when an amendment moves the end of the term. */
  amendedTermEnd?: string
  region: string
  /** Sub-processors in other regions: distractors, not the hosting region. */
  subRegions: string[]
  paymentDays: number
  cureDays: number
  deletionDays: number
}

// A small seeded generator: the same contracts on every run.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'Northwind Analytics GmbH',
  'Northwind Logistics B.V.',
  'Northgate Analytics Ltd',
  'Westwind Analytics S.A.',
  'Norwind Data Systems AB',
  'Northwind Insights Oy',
  'Southwind Analytics SRL',
  'Northwind Analytica sp. z o.o.',
  'Northwind Analytics Nordic AS',
  'Northgate Data GmbH',
  'Eastwind Analytics Kft.',
  'Northwind Metrics ApS',
  'Northfield Analytics Ltd',
  'Northwind Labs S.L.',
  'Nordwind Analytik AG',
  'Northwind Analytics Iberia S.L.',
]
const REGIONS = [
  'EU (Frankfurt, Germany)',
  'EU (Amsterdam, Netherlands)',
  'UK (London)',
  'EU (Paris, France)',
  'EU (Stockholm, Sweden)',
  'EU (Helsinki, Finland)',
  'EU (Milan, Italy)',
  'EU (Warsaw, Poland)',
  'Norway (Oslo)',
  'EU (Dublin, Ireland)',
  'EU (Budapest, Hungary)',
  'EU (Copenhagen, Denmark)',
  'UK (Manchester)',
  'EU (Madrid, Spain)',
  'Switzerland (Zurich)',
  'EU (Lisbon, Portugal)',
]
const ELSEWHERE = [
  'United States',
  'India',
  'Canada',
  'United Kingdom',
  'Switzerland',
  'Singapore',
  'EU (Dublin, Ireland)',
  'Australia',
]
const DAYS = [30, 45, 60, 90]

function makeVendors(): Vendor[] {
  const rnd = random(20261005)
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]
  return NAMES.map((name, i) => {
    // Tier edges, then seats placed so that the added seats cross into the next tier half the time.
    const edge = pick([50, 100, 150, 200])
    const edge2 = edge + pick([100, 150, 200])
    const base = Math.round(edge * (0.6 + rnd() * 0.3))
    const crosses = i % 2 === 0
    // Every contract adds seats later; half of them cross into the next price tier.
    const addedSeats = crosses
      ? edge - base + 10 + Math.floor(rnd() * 30)
      : 1 + Math.floor(rnd() * Math.min(9, edge - base - 1))
    const top = 18 + Math.floor(rnd() * 10)
    const tiers = [
      { from: 1, to: edge, price: top + 0.5 * Math.floor(rnd() * 2) },
      {
        from: edge + 1,
        to: edge2,
        price: top - 2 - 0.25 * Math.floor(rnd() * 4),
      },
      { from: edge2 + 1, to: null, price: top - 5 },
    ]
    const noticeDays = pick(DAYS)
    // Every contract has an amendment: the notice period in half of them, the term end in the other half.
    const amendedNoticeDays =
      i % 2 === 1 ? pick(DAYS.filter((d) => d !== noticeDays)) : undefined
    const year = 2026 + (i % 2)
    const month = 1 + Math.floor(rnd() * 12)
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const termEnd = `${year}-${String(month).padStart(2, '0')}-${last}`
    const later = new Date(Date.UTC(year, month + 6, 0))
    const amendedTermEnd =
      i % 2 === 0 ? later.toISOString().slice(0, 10) : undefined
    return {
      file: `${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(
          /-(gmbh|b-v|ltd|s-a|ab|oy|srl|sp-z-o-o|as|kft|aps|s-l|ag)-?$/,
          '',
        )
        .replace(/-+$/, '')}.md`,
      name,
      seats: base,
      addedSeats,
      tiers,
      noticeDays,
      amendedNoticeDays,
      termEnd,
      amendedTermEnd,
      region: REGIONS[i],
      subRegions: [
        pick(ELSEWHERE),
        pick(REGIONS.filter((r) => r !== REGIONS[i])),
      ],
      paymentDays: pick(DAYS),
      cureDays: pick([15, 30, 45]),
      deletionDays: pick(DAYS),
    }
  })
}

export const VENDORS: Vendor[] = makeVendors()

// Schedule C: the long, ordinary part of a real contract. Every clause has its
// own numbers in days, hours and euros, different in each contract.
const TOPICS = [
  [
    'Access control',
    'Administrator accounts use hardware keys. Access reviews take place every {d} days, and unused accounts are disabled after {d} days.',
  ],
  [
    'Encryption',
    'Data at rest uses AES-256. Keys rotate every {d} days. Backups are encrypted with a separate key that rotates every {d} days.',
  ],
  [
    'Vulnerability management',
    'Critical vulnerabilities are fixed within {h} hours, high ones within {d} days, and medium ones within {d} days.',
  ],
  [
    'Penetration tests',
    'An independent firm tests the Service every {m} months. The Customer receives a summary within {d} days of each test.',
  ],
  [
    'Incident notice',
    'The Provider notifies the Customer of a security incident within {h} hours and sends a full report within {d} days.',
  ],
  [
    'Business continuity',
    'The recovery time objective is {h} hours and the recovery point objective is {h} hours. Continuity plans are tested every {m} months.',
  ],
  [
    'Audit rights',
    "The Customer may audit the Provider once per year with {d} days' notice. An audit lasts at most {b} Business Days.",
  ],
  [
    'Insurance',
    'The Provider holds cyber insurance of at least EUR {k} and professional liability insurance of at least EUR {k}.',
  ],
  [
    'Subcontracting',
    'The Provider informs the Customer of a new sub-processor {d} days in advance. The Customer may object within {d} days.',
  ],
  [
    'Change management',
    "Changes to the hosting setup follow a review with {b} Business Days of notice to the Customer's security contact.",
  ],
  [
    'Logging',
    'Security logs are kept for {d} days in hot storage and {m} months in archive storage.',
  ],
  [
    'Personnel',
    'Staff with access to production complete security training every {m} months. Background checks are renewed every {m} months.',
  ],
  [
    'Transition assistance',
    'On request, the Provider supports a transition to another provider for up to {d} days after termination, at the rates of Schedule E.',
  ],
  [
    'Export on exit',
    'The Customer may export all Customer Data during {d} days after the end of the term, in the formats of Schedule A.',
  ],
  [
    'Escrow',
    'The Provider deposits the source code of its connectors with an escrow agent every {m} months; the release period is {d} days.',
  ],
  [
    'Training',
    'The Provider gives {b} onboarding sessions and {b} sessions per year for new administrators, each of {h} hours.',
  ],
  [
    'Reporting',
    'The Provider sends a service report every {m} months, within {b} Business Days after the period ends.',
  ],
  [
    'Disputes',
    'Disputes go first to the account managers for {d} days, then to the executives for {d} days, before any court.',
  ],
] as const

const ROUNDS = [
  '',
  'production environment',
  'disaster recovery environment',
  'staging environment',
  'support systems',
]

function scheduleC(i: number): string {
  const rnd = random(1000 + i)
  const fill = (text: string) =>
    text
      .replace(/\{d\}/g, () =>
        String(
          [7, 10, 14, 15, 20, 21, 28, 30, 45, 60, 90, 120, 180][
            Math.floor(rnd() * 13)
          ],
        ),
      )
      .replace(/\{h\}/g, () =>
        String([2, 4, 6, 8, 12, 24, 48, 72][Math.floor(rnd() * 8)]),
      )
      .replace(/\{m\}/g, () =>
        String([3, 6, 12, 18, 24][Math.floor(rnd() * 5)]),
      )
      .replace(/\{b\}/g, () => String(2 + Math.floor(rnd() * 9)))
      .replace(
        /\{k\}/g,
        () => `${(1 + Math.floor(rnd() * 9)).toLocaleString('en-GB')},000,000`,
      )
  // Each topic once per system, with other numbers: the length of a real security annex.
  const parts: string[] = []
  for (let round = 0; round < ROUNDS.length; round++) {
    for (const [t, [title, text]] of TOPICS.entries()) {
      parts.push(
        `C.${round * TOPICS.length + t + 1} ${title}${round ? ` (${ROUNDS[round]})` : ''}. ${fill(text)}`,
      )
    }
  }
  return parts.join('\n')
}

/** What a correct extraction says for one vendor. */
export interface Fields {
  vendor: string
  seats: number
  price_per_seat_eur: number
  notice_days: number
  term_end: string
  data_region: string
}

export const FIELD_NAMES = [
  'seats',
  'price_per_seat_eur',
  'notice_days',
  'term_end',
  'data_region',
] as const
export type FieldName = (typeof FIELD_NAMES)[number]

export const totalSeats = (v: Vendor) => v.seats + v.addedSeats

/** The price of the tier that holds `seats`; by default all seats, after the order form. */
export function tierPrice(v: Vendor, seats = totalSeats(v)): number {
  const tier = v.tiers.find(
    (t) => seats >= t.from && (t.to === null || seats <= t.to),
  )
  if (!tier) {
    throw new Error(`${v.name} has no price tier for ${seats} seats.`)
  }

  return tier.price
}

export function expected(v: Vendor): Fields {
  return {
    vendor: v.name,
    seats: totalSeats(v),
    price_per_seat_eur: tierPrice(v),
    notice_days: v.amendedNoticeDays ?? v.noticeDays,
    term_end: v.amendedTermEnd ?? v.termEnd,
    data_region: v.region,
  }
}

const eur = (n: number) => `EUR ${n.toFixed(2)}`
export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** The contract as Markdown. Clause numbers and wording are the same in every contract on purpose. */
export function contractText(v: Vendor): string {
  const tiers = v.tiers
    .map(
      (t) =>
        `| ${t.to === null ? `${t.from} and more` : `${t.from} to ${t.to}`} | ${eur(t.price)} |`,
    )
    .join('\n')
  const amendments: string[] = []
  if (v.amendedNoticeDays) {
    amendments.push(
      `**Amendment No. 1** (signed 2 June 2026). In clause 9.2, "${v.noticeDays} days" is replaced by "${v.amendedNoticeDays} days". All other terms stay unchanged.`,
    )
  }
  if (v.amendedTermEnd) {
    amendments.push(
      `**Amendment No. ${amendments.length + 1}** (signed 14 July 2026). In clause 9.1, the date "${longDate(v.termEnd)}" is replaced by "${longDate(v.amendedTermEnd)}". All other terms stay unchanged.`,
    )
  }
  return `# Master Services Agreement

**Provider:** ${v.name}
**Customer:** Atlas Travel Technologies S.L.
**Effective date:** 1 April 2025

## 1. Definitions

1.1 "Customer Data" means all data that the Customer or its users submit to the Service.
1.2 "Seat" means one named user account with access to the Service. A Seat may be moved to another user once per calendar month.
1.3 "Service" means the hosted analytics platform described in Schedule A, including its application programming interfaces.
1.4 "Business Day" means a day other than a Saturday, a Sunday or a public holiday in the country of the Provider's registered office.

## 2. Scope of the Service

2.1 The Provider makes the Service available to the Customer for the Customer's internal business purposes.
2.2 The Customer licenses **${v.seats} Seats** for the term of this Agreement. Additional Seats may be ordered at any time and are billed from the first day of the following month.
2.3 The Provider may improve the Service, provided that no change materially reduces its functionality during the term.

## 3. Fees

3.1 The monthly fee per Seat depends on the number of Seats licensed under clause 2.2:

| Seats | Price per Seat per month |
|---|---|
${tiers}

3.2 The price of the tier that contains the total number of licensed Seats applies to all Seats.
3.3 Fees exclude value added tax, which the Provider adds at the applicable rate.
3.4 The Provider may increase prices once per year with ${v.cureDays} days' written notice, by no more than 5 percent.

## 4. Invoicing and payment

4.1 The Provider invoices monthly in advance.
4.2 Invoices are payable within **${v.paymentDays} days** of the invoice date.
4.3 Late payments bear interest at 4 percent above the reference rate of the European Central Bank.
4.4 If an undisputed invoice remains unpaid for ${v.cureDays + 15} days after a reminder, the Provider may suspend access to the Service.

## 5. Service levels

5.1 The Provider makes the Service available 99.9 percent of each calendar month, excluding scheduled maintenance announced 5 Business Days in advance.
5.2 Support requests of severity 1 receive a first response within 2 hours, all others within 1 Business Day.
5.3 If availability falls below the commitment in clause 5.1, the Customer receives a service credit of 10 percent of the monthly fee for each full 0.5 percent below it, up to 30 percent.

## 6. Data protection

6.1 The Provider processes Customer Data only on documented instructions of the Customer.
6.2 Customer Data is hosted in **${v.region}**. The Provider does not move the hosting location without 90 days' prior written notice.
6.3 The Provider uses the sub-processors listed in Schedule B. They process support ticket metadata and backups of configuration only; no Customer Data is stored with them.
6.4 After termination, the Provider deletes Customer Data within **${v.deletionDays} days**, unless the law requires longer storage.

## 7. Confidentiality

7.1 Each party keeps the other party's confidential information secret and uses it only to perform this Agreement.
7.2 This obligation survives termination for 3 years.

## 8. Liability

8.1 Each party's total liability in any 12-month period is limited to the fees paid or payable in that period.
8.2 The limit does not apply to breaches of clause 7, to wilful misconduct, or to gross negligence.

## 9. Term and termination

9.1 The initial term ends on **${longDate(v.termEnd)}**. It then renews for successive periods of 12 months.
9.2 Either party may terminate at the end of the initial term or of a renewal period by written notice of at least **${v.noticeDays} days**.
9.3 Either party may terminate for material breach if the breach is not cured within ${v.cureDays} days of written notice.

## 10. General

10.1 This Agreement is governed by the laws of Spain. The courts of Barcelona have exclusive jurisdiction.
10.2 Changes to this Agreement are valid only in writing and signed by both parties.
10.3 If a clause is invalid, the other clauses remain in force.

## Schedule A. Service description

The Service includes dashboards, scheduled reports, a query editor, data connectors for 40 common sources, and an API with a limit of 600 requests per minute per Customer. Each Seat includes 25 GB of storage; storage is pooled across all Seats. Exports are available in CSV, Parquet and JSON. Single sign-on through SAML 2.0 and SCIM provisioning are included from 50 Seats. Audit logs are kept for 365 days.

## Schedule B. Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| Helpdesk provider | Support ticket metadata | ${v.subRegions[0]} |
| Backup provider | Encrypted configuration backups | ${v.subRegions[1]} |
| Email provider | Transactional email | ${v.subRegions[0]} |

## Schedule C. Security and operations

${scheduleC(VENDORS.indexOf(v))}

## Schedule D. Order forms

**Order Form No. 1** (1 April 2025): ${v.seats} Seats, as in clause 2.2.
${v.addedSeats ? `\n**Order Form No. 2** (1 September 2025): the Customer adds ${v.addedSeats} Seats. From this date the Customer licenses ${totalSeats(v)} Seats in total, and clause 3.2 applies to the new total.\n` : ''}${amendments.length ? `\n## Amendments\n\n${amendments.join('\n\n')}\n` : ''}`
}

export const CONTRACTS: ReadonlyMap<string, string> = new Map(
  VENDORS.map((v) => [v.file, contractText(v)]),
)

/** The text of one vendor's contract. */
export function contractOf(v: Vendor): string {
  const text = CONTRACTS.get(v.file)
  if (text === undefined) {
    throw new Error(`No contract for ${v.file}.`)
  }

  return text
}
