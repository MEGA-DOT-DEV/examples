// A tiny JavaScript repo copied for each agent run. The rounding rule is not
// stated in code: only the ADR or the extra test supplies its intent.
export type Mode = 'code' | 'decision' | 'test'
export const MODES: Mode[] = ['code', 'decision', 'test']
export type Files = Record<string, string>

const BILLING: Files = {
  'billing/tax.js': `const round = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
const rate = (market) => market === 'harbor' ? 0.1 : 0.2;
module.exports = { round, rate };
`,
  'billing/invoice.js': `const { round } = require('./tax.js');
const { lineTax } = require('./helpers.js');
const { money } = require('./format.js');
function total(invoice) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const tax = round(invoice.lines.reduce((sum, line) => sum + lineTax(line, invoice.market), 0));
  return round(subtotal + tax);
}
module.exports = { total, displayTotal: (invoice) => money(total(invoice)) };
`,
  'billing/export.js': `const { round, rate } = require('./tax.js');
function total(invoice) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const tax = round(subtotal * rate(invoice.market));
  return round(subtotal + tax);
}
module.exports = { total };
`,
  'billing/format.js': `const money = (amount) => '$' + amount.toFixed(2);
module.exports = { money };
`,
  'billing/helpers.js': `const { round, rate } = require('./tax.js');
const lineTax = (line, market) => round(line.price * line.quantity * rate(market));
module.exports = { lineTax };
`,
  'tests/invoice.js': `const { total, displayTotal } = require('../billing/invoice.js');
if (total({ market: 'inland', lines: [{ price: 10, quantity: 1 }] }) !== 12) throw Error('ordinary invoice');
if (displayTotal({ market: 'inland', lines: [{ price: 10, quantity: 1 }] }) !== '$12.00') throw Error('display');
const { total: exportTotal } = require('../billing/export.js');
if (exportTotal({ market: 'inland', lines: [{ price: 10, quantity: 1 }] }) !== 12) throw Error('ordinary export');
`,
  'billing/README.md': `Billing uses invoice.js for customer invoices, export.js for accounting exports, and format.js for display.\n`,
}

const ADR = `# 0001 · Round tax on each line in harbor

## Context
Harbor law requires tax to be rounded on each invoice line before adding the
line taxes, for invoices and every report built from them. On two 5-cent lines
at 10%, each line adds 1 cent tax; rounding the combined tax adds only 1 cent.

## Decision
Use the per-line tax rule for invoices and accounting exports alike.
The final round in total() is still useful for floating-point addition.

## Consequence
Reports must preserve the invoice's line-tax amounts, not recalculate tax on
the combined subtotal. A reconciliation fix must keep the lawful totals.
`

const PIN = `const { total: harborTotal } = require('../billing/invoice.js');
if (harborTotal({ market: 'harbor', lines: [{ price: 0.05, quantity: 1 }, { price: 0.05, quantity: 1 }] }) !== 0.12) throw Error('harbor line tax');
`

export const INVOICES = [
  {
    market: 'harbor',
    lines: [
      { price: 0.05, quantity: 1 },
      { price: 0.05, quantity: 1 },
    ],
  },
  {
    market: 'harbor',
    lines: [
      { price: 0.15, quantity: 1 },
      { price: 0.15, quantity: 1 },
      { price: 0.15, quantity: 1 },
      { price: 0.15, quantity: 1 },
    ],
  },
  {
    market: 'harbor',
    lines: [
      { price: 19.99, quantity: 2 },
      { price: 0.05, quantity: 3 },
    ],
  },
  {
    market: 'inland',
    lines: [
      { price: 10, quantity: 1 },
      { price: 4.25, quantity: 2 },
    ],
  },
  { market: 'inland', lines: [{ price: 0.99, quantity: 3 }] },
]

export function repo(mode: Mode): Files {
  const files = { ...BILLING }
  if (mode === 'decision') {
    files['decisions/0001-line-tax-rounding.md'] = ADR
  }
  if (mode === 'test') {
    files['tests/invoice.js'] += PIN
  }
  return files
}
