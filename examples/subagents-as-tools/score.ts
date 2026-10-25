// Checks an answer against the contracts, field by field, and says what
// kind of mistake each wrong value is: a value that a later order form or
// amendment replaced, another number from the same contract (a wrong tier, a
// payment period), or a value found only in another vendor's contract.
import {
  contractOf,
  expected,
  FIELD_NAMES,
  type FieldName,
  longDate,
  tierPrice,
  VENDORS,
  type Vendor,
} from './contracts.ts'

export type ErrorKind =
  | 'earlier'
  | 'same-contract'
  | 'other-vendor'
  | 'missing'
  | 'other'

export const ERROR_LABELS: Record<ErrorKind, string> = {
  earlier: 'A value that a later part replaced',
  'same-contract': 'Another value from the same contract',
  'other-vendor': "A value from another vendor's contract",
  missing: 'Missing',
  other: 'A value from nowhere',
}

/** One wrong field of one contract. */
export interface Cell {
  file: string
  vendor: string
  field: FieldName
  want: string | number
  got: unknown
  ok: boolean
  kind: ErrorKind
  /** Why the value is wrong, in a few words. */
  note: string | null
}

export interface Score {
  right: number
  total: number
  /** Wrong cells only, in contract order. */
  wrong: Cell[]
  kinds: Record<ErrorKind, number>
}

const normalize = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const city = (region: string) => /\(([^,)]+)/.exec(region)?.[1] ?? region

function same(field: FieldName, got: unknown, want: string | number): boolean {
  if (got === null || got === undefined || got === '') {
    return false
  }
  if (field === 'data_region') {
    return normalize(got).includes(normalize(city(String(want))))
  }
  if (field === 'price_per_seat_eur') {
    return Math.abs(Number(got) - Number(want)) < 0.005
  }
  if (field === 'term_end') {
    return String(got).trim() === want
  }

  return Number(got) === want
}

/** The value a reader gets when they stop before the order form or the amendment. */
function earlier(
  vendor: Vendor,
  field: FieldName,
): { value: number | string; note: string } | null {
  const basePrice = tierPrice(vendor, vendor.seats)
  const newTier = basePrice !== expected(vendor).price_per_seat_eur

  if (field === 'seats' && vendor.addedSeats) {
    return { value: vendor.seats, note: 'missed Order Form No. 2' }
  }
  if (field === 'price_per_seat_eur' && vendor.addedSeats && newTier) {
    return { value: basePrice, note: 'the tier before Order Form No. 2' }
  }
  if (field === 'notice_days' && vendor.amendedNoticeDays) {
    return { value: vendor.noticeDays, note: 'missed the amendment' }
  }
  if (field === 'term_end' && vendor.amendedTermEnd) {
    return { value: vendor.termEnd, note: 'missed the amendment' }
  }

  return null
}

/** Whether a contract's text holds this value, written the way the contracts write it. */
function holds(text: string, field: FieldName, got: unknown): boolean {
  const number = Number(got)
  if (field === 'price_per_seat_eur') {
    return Number.isFinite(number) && text.includes(`EUR ${number.toFixed(2)}`)
  }
  if (field === 'notice_days') {
    const days = new RegExp(`\\b${number} days`)
    return Number.isInteger(number) && days.test(text)
  }
  if (field === 'seats') {
    const seats = new RegExp(`\\b${number} Seats`)
    return Number.isInteger(number) && seats.test(text)
  }
  if (field === 'term_end') {
    const date = String(got)
    return /^\d{4}-\d\d-\d\d$/.test(date) && text.includes(longDate(date))
  }

  const place = normalize(got)
  return place.length > 2 && normalize(text).includes(place)
}

function classify(
  vendor: Vendor,
  field: FieldName,
  got: unknown,
): { kind: ErrorKind; note: string | null } {
  if (got === null || got === undefined || got === '') {
    return { kind: 'missing', note: null }
  }

  const before = earlier(vendor, field)
  if (before && same(field, got, before.value)) {
    return { kind: 'earlier', note: before.note }
  }

  // Its own contract first: a wrong tier or another period is a misreading, not a mix-up.
  const subRegion =
    field === 'data_region' &&
    vendor.subRegions.some((region) => same(field, got, region))
  if (subRegion) {
    return { kind: 'same-contract', note: "a sub-processor's location" }
  }
  if (holds(contractOf(vendor), field, got)) {
    const note = field === 'price_per_seat_eur' ? 'another price tier' : null
    return { kind: 'same-contract', note }
  }

  const owner = VENDORS.find(
    (other) => other !== vendor && holds(contractOf(other), field, got),
  )
  if (owner) {
    return { kind: 'other-vendor', note: `found in ${owner.name}` }
  }

  return { kind: 'other', note: null }
}

/** The JSON answer of a main thread, or null when it is not one. */
export function readAnswer(
  text: string,
): { vendors: Record<string, unknown>[] } | null {
  try {
    const value = JSON.parse(text)
    return value && Array.isArray(value.vendors) ? value : null
  } catch {
    return null
  }
}

/** Finds the answer's row for a contract: by its file, then by the vendor's name. */
function rowFor(rows: Record<string, unknown>[], vendor: Vendor) {
  const file = (row: Record<string, unknown>) =>
    String(row.file ?? '')
      .split('/')
      .pop()

  return (
    rows.find((row) => file(row) === vendor.file) ??
    rows.find((row) => normalize(row.vendor) === normalize(vendor.name))
  )
}

export function score(
  answer: { vendors: Record<string, unknown>[] } | null,
): Score {
  const rows = answer?.vendors ?? []
  const wrong: Cell[] = []
  const kinds: Record<ErrorKind, number> = {
    earlier: 0,
    'same-contract': 0,
    'other-vendor': 0,
    missing: 0,
    other: 0,
  }
  let right = 0

  for (const vendor of VENDORS) {
    const row = rowFor(rows, vendor)
    const want = expected(vendor)
    for (const field of FIELD_NAMES) {
      const got = row?.[field]
      if (same(field, got, want[field])) {
        right++
        continue
      }

      const { kind, note } = classify(vendor, field, got)
      kinds[kind]++
      wrong.push({
        file: vendor.file,
        vendor: vendor.name,
        field,
        want: want[field],
        got: got ?? null,
        ok: false,
        kind,
        note,
      })
    }
  }

  const total = VENDORS.length * FIELD_NAMES.length
  return { right, total, wrong, kinds }
}
