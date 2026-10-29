// Eight synthetic pull requests. Files are the base-branch versions of the touched files;
// the diff is the proposed change. The key is never sent to the reviewer.
export const TEAM_RULES = `Team review rules for the billing and account service:
- Amounts stored or passed to payment functions are integer cents, never dollars.
- Do not write customer email addresses to console logs.
- Every new conditional branch in a route or billing calculation needs a test for each outcome in the same PR.
- Report only actionable defects supported by the changed lines and the supplied files. Do not demand unrelated refactors.`

export type Kind = 'bug' | 'rule' | 'missing_test'
export interface Case {
  id: string
  title: string
  diff: string
  files: Record<string, string>
  seed?: { kind: Kind; file: string; evidence: string; explanation: string }
}

export const CASES: Case[] = [
  {
    id: 'refund-rounding',
    title: 'Partial refund arithmetic',
    files: {
      'src/billing/refund.ts': `import { payment } from './gateway.ts'\nexport async function refund(totalCents: number, refundedCents: number) {\n  const remainingCents = totalCents - refundedCents\n  return payment.refund(remainingCents)\n}`,
      'src/billing/gateway.ts': `export const payment = { refund(cents: number) { return { refundedCents: cents } } }`,
      'src/billing/refund.test.ts': `import { refund } from './refund.ts'\ntest('full refund', async () => { expect((await refund(500, 0)).refundedCents).toBe(500) })`,
    },
    diff: `diff --git a/src/billing/refund.ts b/src/billing/refund.ts
--- a/src/billing/refund.ts
+++ b/src/billing/refund.ts
@@ -1,5 +1,5 @@
 import { payment } from './gateway.ts'
 export async function refund(totalCents: number, refundedCents: number) {
-  const remainingCents = totalCents - refundedCents
+  const remainingCents = totalCents + refundedCents
   return payment.refund(remainingCents)
 }`,
    seed: {
      kind: 'bug',
      file: 'src/billing/refund.ts',
      evidence: 'const remainingCents = totalCents + refundedCents',
      explanation:
        'A partial refund grows the remaining amount instead of subtracting the prior refund.',
    },
  },
  {
    id: 'expiry-boundary',
    title: 'Coupon expiry boundary',
    files: {
      'src/promos/coupon.ts': `export function validUntil(expiryMs: number, nowMs: number) {\n  return nowMs < expiryMs\n}`,
      'src/promos/coupon.test.ts': `import { validUntil } from './coupon.ts'\ntest('before expiry', () => { expect(validUntil(100, 99)).toBe(true) })\ntest('at expiry', () => { expect(validUntil(100, 100)).toBe(false) })`,
    },
    diff: `diff --git a/src/promos/coupon.ts b/src/promos/coupon.ts
--- a/src/promos/coupon.ts
+++ b/src/promos/coupon.ts
@@ -1,3 +1,3 @@
 export function validUntil(expiryMs: number, nowMs: number) {
-  return nowMs < expiryMs
+  return nowMs <= expiryMs
 }`,
    seed: {
      kind: 'bug',
      file: 'src/promos/coupon.ts',
      evidence: 'return nowMs <= expiryMs',
      explanation:
        'The coupon remains valid at its expiry instant; the existing boundary test expects false.',
    },
  },
  {
    id: 'dollars-to-gateway',
    title: 'Payment amount conversion',
    files: {
      'src/billing/charge.ts': `import { gateway } from './gateway.ts'\nexport async function charge(totalCents: number) {\n  return gateway.capture({ amountCents: totalCents })\n}`,
      'src/billing/gateway.ts': `export const gateway = { capture(input: { amountCents: number }) { return input } }`,
    },
    diff: `diff --git a/src/billing/charge.ts b/src/billing/charge.ts
--- a/src/billing/charge.ts
+++ b/src/billing/charge.ts
@@ -1,4 +1,4 @@
 import { gateway } from './gateway.ts'
 export async function charge(totalCents: number) {
-  return gateway.capture({ amountCents: totalCents })
+  return gateway.capture({ amountCents: totalCents / 100 })
 }`,
    seed: {
      kind: 'rule',
      file: 'src/billing/charge.ts',
      evidence: 'return gateway.capture({ amountCents: totalCents / 100 })',
      explanation:
        'The gateway requires integer cents; this passes dollars and breaks the team amount rule.',
    },
  },
  {
    id: 'email-log',
    title: 'Account lookup tracing',
    files: {
      'src/accounts/lookup.ts': `import { store } from './store.ts'\nexport async function findAccount(email: string) {\n  return store.findByEmail(email)\n}`,
      'src/accounts/store.ts': `export const store = { findByEmail(email: string) { return { email, id: 'a1' } } }`,
    },
    diff: `diff --git a/src/accounts/lookup.ts b/src/accounts/lookup.ts
--- a/src/accounts/lookup.ts
+++ b/src/accounts/lookup.ts
@@ -1,4 +1,5 @@
 import { store } from './store.ts'
 export async function findAccount(email: string) {
+  console.log('account lookup', email)
   return store.findByEmail(email)
 }`,
    seed: {
      kind: 'rule',
      file: 'src/accounts/lookup.ts',
      evidence: "console.log('account lookup', email)",
      explanation:
        'The log sends a customer email to console, contrary to the team privacy rule.',
    },
  },
  {
    id: 'free-shipping',
    title: 'Free shipping threshold',
    files: {
      'src/checkout/shipping.ts': `export function shippingCents(subtotalCents: number) {\n  return 600\n}`,
      'src/checkout/shipping.test.ts': `import { shippingCents } from './shipping.ts'\ntest('standard rate', () => { expect(shippingCents(1500)).toBe(600) })`,
    },
    diff: `diff --git a/src/checkout/shipping.ts b/src/checkout/shipping.ts
--- a/src/checkout/shipping.ts
+++ b/src/checkout/shipping.ts
@@ -1,3 +1,4 @@
 export function shippingCents(subtotalCents: number) {
+  if (subtotalCents >= 5000) return 0
   return 600
 }`,
    seed: {
      kind: 'missing_test',
      file: 'src/checkout/shipping.ts',
      evidence: 'if (subtotalCents >= 5000) return 0',
      explanation:
        'A new threshold branch has no same-PR test for its free and paid outcomes.',
    },
  },
  {
    id: 'account-lock',
    title: 'Account lock response',
    files: {
      'src/accounts/status.ts': `export function accountStatus(failedLogins: number) {\n  return 'active'\n}`,
      'src/accounts/status.test.ts': `import { accountStatus } from './status.ts'\ntest('active', () => { expect(accountStatus(0)).toBe('active') })`,
    },
    diff: `diff --git a/src/accounts/status.ts b/src/accounts/status.ts
--- a/src/accounts/status.ts
+++ b/src/accounts/status.ts
@@ -1,3 +1,4 @@
 export function accountStatus(failedLogins: number) {
+  if (failedLogins >= 5) return 'locked'
   return 'active'
 }`,
    seed: {
      kind: 'missing_test',
      file: 'src/accounts/status.ts',
      evidence: "if (failedLogins >= 5) return 'locked'",
      explanation:
        'The new locked branch has no same-PR test for locked and active outcomes.',
    },
  },
  {
    id: 'shipping-tests',
    title: 'Threshold tests',
    files: {
      'src/checkout/shipping.ts': `export function shippingCents(subtotalCents: number) {\n  if (subtotalCents >= 5000) return 0\n  return 600\n}`,
      'src/checkout/shipping.test.ts': `import { shippingCents } from './shipping.ts'\ntest('standard rate', () => { expect(shippingCents(1500)).toBe(600) })`,
    },
    diff: `diff --git a/src/checkout/shipping.test.ts b/src/checkout/shipping.test.ts
--- a/src/checkout/shipping.test.ts
+++ b/src/checkout/shipping.test.ts
@@ -1,2 +1,4 @@
 import { shippingCents } from './shipping.ts'
 test('standard rate', () => { expect(shippingCents(1500)).toBe(600) })
+test('at threshold', () => { expect(shippingCents(5000)).toBe(0) })
+test('below threshold', () => { expect(shippingCents(4999)).toBe(600) })`,
  },
  {
    id: 'lookup-error',
    title: 'Lookup error message',
    files: {
      'src/accounts/errors.ts': `export function missingAccount() {\n  return { status: 404, message: 'Not found' }\n}`,
      'src/accounts/errors.test.ts': `import { missingAccount } from './errors.ts'\ntest('missing account', () => { expect(missingAccount().status).toBe(404) })`,
    },
    diff: `diff --git a/src/accounts/errors.ts b/src/accounts/errors.ts
--- a/src/accounts/errors.ts
+++ b/src/accounts/errors.ts
@@ -1,3 +1,3 @@
 export function missingAccount() {
-  return { status: 404, message: 'Not found' }
+  return { status: 404, message: 'Account not found' }
 }`,
  },
]

export function caseById(id: string): Case {
  const found = CASES.find((item) => item.id === id)
  if (!found) {
    throw new Error(`Unknown pull request "${id}".`)
  }
  return found
}
