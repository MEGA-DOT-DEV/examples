// The two tasks intentionally touch this one line. A full-file save from a stale
// read can replace the other Worker's change; Git can detect overlapping edits.
export function quote(subtotal, tier) {
  return { shipping: subtotal >= 50 ? 0 : 8, credit: tier === 'gold' ? 10 : 0 }
}
