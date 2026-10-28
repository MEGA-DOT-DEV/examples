// The data: 24 raw items of a made-up three-person design studio, as they
// arrive in its inbox, and the 10 tasks a tester runs against any structure.
//
// The key works for every structure the designer can pick, because it names
// items, not paths:
//   lookup  describes one item in other words. The right answer is the path
//           the designer gave that item.
//   file    gives a new item with a twin among the 24: the same kind, client,
//           vendor and month. The right answer is a new file in the folder
//           where the designer put the twin.

export interface Item {
  id: string
  text: string
}

export interface Task {
  id: string
  kind: 'lookup' | 'file'
  /** What the tester reads. */
  text: string
  /** lookup: the item it describes. file: the twin of the new item. */
  item: string
}

export const ITEMS: Item[] = [
  {
    id: 'i01',
    text: 'Call with Harbor Coffee, 10 Sept 2026. Jonas (owner) and Ola. They want the rebrand ready before the winter menu on 1 Nov. Jonas dislikes the green from round 1. Next: Bram sends three new palettes by Friday.',
  },
  {
    id: 'i02',
    text: 'Harbor Coffee palette, decided 15 Sept 2026: deep navy #1F2A44 with copper #B87333 accents. The green is dropped. Jonas signed off by email.',
  },
  {
    id: 'i03',
    text: 'Jonas Ek, owner of Harbor Coffee. jonas@harborcoffee.example, +46 70 555 0142. Prefers calls before 10:00.',
  },
  {
    id: 'i04',
    text: 'Exporting the Harbor logo: the master file is harbor-logo.ai. Export SVG for the web, PNG at 2x for social, PDF in CMYK for the print shop. Never send the .ai file to the client.',
  },
  {
    id: 'i05',
    text: 'Drukarnia Fala, print shop: 200 Harbor Coffee loyalty card proofs, 22 Sept 2026, 86.00 EUR, billed to the Harbor project.',
  },
  {
    id: 'i06',
    text: 'What if the Harbor cups had a different small illustration each season? Could turn into a yearly retainer.',
  },
  {
    id: 'i07',
    text: 'Linden School kickoff, 8 Sept 2026, with Marta Nowak (head teacher) and Pieter (IT). The site must work for parents on phones. Teachers send content through a shared form. Launch before the open day on 20 Oct.',
  },
  {
    id: 'i08',
    text: "Linden School site: we build on the school's existing WordPress, not a new static site, because Pieter has to maintain it. Decided 12 Sept 2026.",
  },
  {
    id: 'i09',
    text: 'Marta Nowak, head teacher at Linden School. m.nowak@linden.example. Answers email on Tuesdays and Thursdays.',
  },
  {
    id: 'i10',
    text: 'Photos for the Linden site: crop to 3:2, resize to 1600 px wide, export WebP at quality 80, strip the location data from photos of children before upload.',
  },
  {
    id: 'i11',
    text: 'PhotoBank licence, 3 images of a school library, 14 Sept 2026, 39.00 EUR, billed to the Linden project.',
  },
  {
    id: 'i12',
    text: 'Linden content review, 29 Sept 2026. Teachers sent 14 of 22 pages. Marta wants a calendar page. Bram adds the events plugin.',
  },
  {
    id: 'i13',
    text: 'From October the studio stops using Dropbox. All project files move to the NAS in the office, backed up every night to an external disk. Reason: the Dropbox bill doubled and we hit the storage cap twice. Decided at the 5 Sept studio meeting.',
  },
  {
    id: 'i14',
    text: 'Studio meeting, 5 Sept 2026: Dropbox to NAS (see the decision). Ines is on holiday 13 to 24 Oct. New rule: every project gets a one-page brief before work starts.',
  },
  {
    id: 'i15',
    text: 'Henrik Dahl, our accountant, Dahl & Co. henrik@dahlco.example. Send him all receipts by the 5th of each month.',
  },
  {
    id: 'i16',
    text: 'Kopi-Service, Tomas. +46 8 555 0199. Fixes our Ricoh MP C3004, contract number KS-2291.',
  },
  {
    id: 'i17',
    text: 'Restoring a file from the backup disk: plug the orange disk into the NAS, open Hyper Backup, pick the date, restore to a new folder, never over the original.',
  },
  {
    id: 'i18',
    text: 'First day of a freelancer: laptop from the cupboard, Wi-Fi tidewater-guest (the password is on the card under the router), a NAS account from Ola, add them to #studio on Slack.',
  },
  {
    id: 'i19',
    text: 'Papierhaus: printer ink, 4 cartridges, 3 Sept 2026, 61.80 EUR, studio supplies.',
  },
  {
    id: 'i20',
    text: 'Wacom Intuos Pro for Ines, 11 Sept 2026, 379.00 EUR, studio equipment.',
  },
  {
    id: 'i21',
    text: 'Sell prints of our old sketchbook pages in a small online shop? Ines has about 40 good pages.',
  },
  {
    id: 'i22',
    text: 'A half-day lettering workshop for local schools. Linden could be the first.',
  },
  {
    id: 'i23',
    text: 'Day rate for 2027: 640 EUR, up from 600. New clients pay it from January; Harbor and Linden keep 600 until their projects end. Decided 26 Sept 2026.',
  },
  {
    id: 'i24',
    text: 'Greta Lind, our landlord. Rent is due on the 1st. Heating problems: send her an SMS, +46 70 555 0177.',
  },
]

export const TASKS: Task[] = [
  {
    id: 't01',
    kind: 'lookup',
    item: 'i24',
    text: 'Who to text when the heating fails.',
  },
  {
    id: 't02',
    kind: 'lookup',
    item: 'i15',
    text: 'The day of the month by which receipts must be handed in.',
  },
  {
    id: 't03',
    kind: 'lookup',
    item: 'i14',
    text: 'When Ines is away in October.',
  },
  {
    id: 't04',
    kind: 'lookup',
    item: 'i04',
    text: 'Which file must never go to Harbor Coffee.',
  },
  {
    id: 't05',
    kind: 'lookup',
    item: 'i18',
    text: 'Where the Wi-Fi password is.',
  },
  {
    id: 't06',
    kind: 'lookup',
    item: 'i13',
    text: "Why the studio's files moved off the cloud.",
  },
  {
    id: 't07',
    kind: 'file',
    item: 'i19',
    text: 'Papierhaus: A3 printer paper, 5 reams, 18 Sept 2026, 24.50 EUR, studio supplies.',
  },
  {
    id: 't08',
    kind: 'file',
    item: 'i01',
    text: 'Call with Jonas from Harbor Coffee, 24 Sept 2026. He likes the navy and copper mock-ups and wants menu boards next.',
  },
  {
    id: 't09',
    kind: 'file',
    item: 'i22',
    text: 'A drawing club for Linden pupils on Friday afternoons. It could become paid work.',
  },
  {
    id: 't10',
    kind: 'file',
    item: 'i17',
    text: "Checking that last night's backup ran: open Hyper Backup on the NAS, look for a green tick next to the date, tell Ola if it is red.",
  },
]

export const ITEM_IDS = ITEMS.map((i) => i.id)
