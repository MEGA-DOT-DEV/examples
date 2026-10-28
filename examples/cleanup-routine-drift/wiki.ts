// The wiki that the nightly cleanup works on, the answer key, and the
// measures that code takes after every night.
//
// A wiki is a plain map: note id → Markdown text. Links are [[note-id]].
// 16 notes, 30 tracked facts, 3 real duplicate pairs. Nothing is on disk.

export type Wiki = Record<string, string>

export const NOTES: Wiki = {
  index: `# Warehouse wiki

Start here. The notes of the Gdańsk warehouse team.

- Suppliers: [[suppliers]], [[supplier-contacts]]
- Returns: [[returns-policy]], [[returns-howto]]
- Records: [[retention]]
- The building: [[warehouse-layout]], [[fire-drill-2024]]
- Forklifts: [[forklift-safety]], [[forklift-checks]]
- People: [[onboarding]]
- Outbound: [[shipping-carriers]]
- Stock: [[inventory-counts]], [[pallets]]
- Other: [[glossary]], [[scratch]]
`,

  suppliers: `# Suppliers

Our main packaging supplier is Brenner GmbH. They deliver every Tuesday to the inbound dock (see [[warehouse-layout]]).
Our account manager there is Ana Kowalska. Orders above the usual volume go through her, not the web shop.
Pallets come from a separate pool, see [[pallets]].
`,

  'supplier-contacts': `# Supplier contacts

Who to call at our suppliers.

Brenner GmbH (packaging): Ana Kowalska is the account manager. Send purchase orders to orders@brenner.example, she reads that inbox too.
For pallets, see [[pallets]].
`,

  'returns-policy': `# Returns policy

Customers can return goods within 30 days of delivery. We charge a restocking fee of 15% on goods that come back opened.
Every return over 500 units needs approval from Tomasz Lis, the returns lead.
How to process a return on the floor: [[returns-howto]].
`,

  'returns-howto': `# How to handle a return

When a parcel comes back, check the date: we take returns up to 30 days after delivery.
If the box was opened, the customer pays the 15% restocking fee; note it on the slip.
Print the returns label on the LP-220 printer at [[warehouse-layout]] Dock 4.
Policy details: [[returns-policy]].
`,

  retention: `# Record retention

Keep invoices and delivery notes for 7 years (tax law). Old ones go to the archive boxes, not the bin.
CCTV footage is kept for 31 days, then the recorder overwrites it.
Ask in [[onboarding]] who has the archive key.
`,

  'warehouse-layout': `# Warehouse layout

Inbound trucks use Dock 1 and Dock 2. Returns arrive at Dock 4.
Hazardous goods (batteries, aerosols) live only in Aisle K7, behind the yellow line.
High racks hold at most 1200 kg per beam level; the label on each upright repeats it.
Forklifts charge in the bay described in [[forklift-safety]].
`,

  'forklift-safety': `# Forklift safety

Only trained staff drive forklifts. The licence must be renewed every 3 years.
Training and renewals are run by Marek Zielinski.
Forklifts charge only in Bay C3, never at the docks. Daily checks: [[forklift-checks]].
`,

  'forklift-checks': `# Forklift checks

Before the first shift, the driver fills in form F-12 for each truck (brakes, horn, forks, battery).
Reminder: a forklift licence is valid for 3 years. Charge only in Bay C3.
Full rules: [[forklift-safety]].
`,

  onboarding: `# Onboarding

On the first day a new hire meets Julia Nowak, the shift lead.
Badges are handed out in Room 2.14 on the second floor; bring an ID card.
The safety video takes 45 minutes and must be done before any floor work. Then read [[forklift-safety]] and [[warehouse-layout]].
`,

  'shipping-carriers': `# Shipping carriers

Pallet freight goes with DHL Freight on our account DE-88213.
The pickup cutoff is 14:30; anything packed later ships the next working day.
Pallet sizes and deposits: [[pallets]].
`,

  'fire-drill-2024': `# Fire drill notes (2024)

Notes from the drill on 12 March 2024. Everyone left the building in under five minutes.
The assembly point is Car park B2, not the front lawn: the lawn is too close to the gas line.
The drill report is filed as DR-031 with the building manager.
See [[warehouse-layout]] for the exits.
`,

  'inventory-counts': `# Inventory counts

We cycle count one zone on the second Friday of each month.
Counts are entered in the ScanCount app, never on paper. Stock rules for pallets: [[pallets]].
`,

  pallets: `# Pallets

We use Euro pallets with part number PX-4471 from the regional pallet pool.
Broken pallets go back to the pool, not the skip. Our pallet supplier contact is in [[supplier-contacts]].
`,

  glossary: `# Glossary

- ASN: advance shipping notice, the list a supplier sends before a truck.
- Cycle count: counting one zone at a time, see [[inventory-counts]].
- Cutoff: the last pickup time of a carrier, see [[shipping-carriers]].
`,

  scratch: `# Scratch

Loose notes, to sort out some day.
- The vendor portal moves to the new login on 1 December 2026.
- Spare keys for the office are in locker 17.
- Ask Julia about the summer rota.
`,
}

export interface Fact {
  id: string
  /** The exact value that must stay somewhere in the wiki. */
  value: string
  /** The note that holds it at the start. */
  note: string
  label: string
}

const fact = (note: string, value: string, label: string): Fact => ({
  id: `${note}:${value}`,
  value,
  note,
  label,
})

/** The answer key: 30 values that a faithful paraphrase keeps as they are. */
export const FACTS: Fact[] = [
  fact('suppliers', 'Brenner GmbH', 'Packaging supplier'),
  fact('suppliers', 'Ana Kowalska', 'Account manager at the supplier'),
  fact('supplier-contacts', 'orders@brenner.example', 'Purchase order address'),
  fact('returns-policy', '30 days', 'Return window'),
  fact('returns-policy', '15%', 'Restocking fee'),
  fact('returns-policy', 'Tomasz Lis', 'Approves big returns'),
  fact('returns-howto', 'LP-220', 'Returns label printer'),
  fact('retention', '7 years', 'Invoice retention'),
  fact('retention', '31 days', 'CCTV retention'),
  fact('warehouse-layout', 'Dock 4', 'Returns dock'),
  fact('warehouse-layout', 'Aisle K7', 'Hazardous goods aisle'),
  fact('warehouse-layout', '1200 kg', 'Rack load limit'),
  fact('forklift-safety', '3 years', 'Forklift licence validity'),
  fact('forklift-safety', 'Marek Zielinski', 'Forklift trainer'),
  fact('forklift-safety', 'Bay C3', 'Forklift charging bay'),
  fact('forklift-checks', 'F-12', 'Daily check form'),
  fact('onboarding', 'Julia Nowak', 'Shift lead'),
  fact('onboarding', 'Room 2.14', 'Badge room'),
  fact('onboarding', '45 minutes', 'Safety video length'),
  fact('shipping-carriers', 'DHL Freight', 'Pallet carrier'),
  fact('shipping-carriers', 'DE-88213', 'Carrier account'),
  fact('shipping-carriers', '14:30', 'Pickup cutoff'),
  fact('fire-drill-2024', '12 March 2024', 'Last fire drill'),
  fact('fire-drill-2024', 'Car park B2', 'Assembly point'),
  fact('fire-drill-2024', 'DR-031', 'Drill report'),
  fact('inventory-counts', 'second Friday', 'Cycle count day'),
  fact('inventory-counts', 'ScanCount', 'Count app'),
  fact('pallets', 'PX-4471', 'Pallet part number'),
  fact('scratch', '1 December 2026', 'Vendor portal change'),
  fact('scratch', 'locker 17', 'Spare office keys'),
]

/** Real duplicates: both notes hold the shared values at the start. */
export const DUPLICATES = [
  {
    a: 'suppliers',
    b: 'supplier-contacts',
    shared: ['Brenner GmbH', 'Ana Kowalska'],
  },
  { a: 'returns-policy', b: 'returns-howto', shared: ['30 days', '15%'] },
  { a: 'forklift-safety', b: 'forklift-checks', shared: ['3 years', 'Bay C3'] },
]

// The counting rule: case and spacing do not matter, and dashes count as "-".
// That is a lenient measure of loss: a fact counts as kept when its value is
// still anywhere in the wiki, even in another note.
const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')

export const holds = (text: string, value: string) =>
  normal(text).includes(normal(value))

export const factsIn = (text: string) =>
  FACTS.filter((f) => holds(text, f.value))

/** Facts whose value is not anywhere in the wiki. */
export function lostFacts(wiki: Wiki): Fact[] {
  const all = Object.values(wiki).join('\n')
  return FACTS.filter((f) => !holds(all, f.value))
}

/** The ids that a note links to, in order, without repeats. */
export function linksOf(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
        m[1].trim(),
      ),
    ),
  ]
}

export interface BrokenLink {
  note: string
  target: string
}

/** Links whose target note does not exist. */
export function brokenLinks(wiki: Wiki): BrokenLink[] {
  return Object.entries(wiki).flatMap(([note, text]) =>
    linksOf(text)
      .filter((t) => !(t in wiki))
      .map((target) => ({ note, target })),
  )
}

/** A duplicate pair is left while both notes exist and each still holds a shared value. */
export function duplicatesLeft(wiki: Wiki) {
  const still = (id: string, shared: string[]) =>
    id in wiki && shared.some((v) => holds(wiki[id], v))
  return DUPLICATES.filter((d) => still(d.a, d.shared) && still(d.b, d.shared))
}

export interface Measure {
  facts: number
  lost: string[]
  notes: number
  brokenLinks: BrokenLink[]
  duplicates: number
}

export function measure(wiki: Wiki): Measure {
  const lost = lostFacts(wiki)
  return {
    facts: FACTS.length - lost.length,
    lost: lost.map((f) => f.id),
    notes: Object.keys(wiki).length,
    brokenLinks: brokenLinks(wiki),
    duplicates: duplicatesLeft(wiki).length,
  }
}
