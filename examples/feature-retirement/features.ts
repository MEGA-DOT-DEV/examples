// A small B2B app: usage is visible in both modes, business stakes in one.
// The key is held by code, not sent to the model.
export type Decision = 'keep' | 'retire' | 'replace'
export type Mode = 'usage' | 'context'

export const FEATURES: {
  id: string
  name: string
  description: string
  monthlyUsers: number
  uses90d: number
  key: Decision
}[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Overview of live operations.',
    monthlyUsers: 780,
    uses90d: 9200,
    key: 'keep',
  },
  {
    id: 'alerts',
    name: 'Alerts',
    description: 'Notify owners when a rule fires.',
    monthlyUsers: 410,
    uses90d: 3100,
    key: 'keep',
  },
  {
    id: 'audit-export',
    name: 'Audit export',
    description: 'Download an archive of activity records.',
    monthlyUsers: 2,
    uses90d: 6,
    key: 'keep',
  },
  {
    id: 'quick-filters',
    name: 'Quick filters',
    description: 'Save a filtered view with one click.',
    monthlyUsers: 660,
    uses90d: 8100,
    key: 'replace',
  },
  {
    id: 'legacy-theme',
    name: 'Legacy theme',
    description: 'Apply the retired 2019 color palette.',
    monthlyUsers: 0,
    uses90d: 0,
    key: 'retire',
  },
  {
    id: 'fax-digest',
    name: 'Fax digest',
    description: 'Send a daily fax summary.',
    monthlyUsers: 0,
    uses90d: 0,
    key: 'retire',
  },
  {
    id: 'old-import',
    name: 'Old importer',
    description: 'Import data from a discontinued format.',
    monthlyUsers: 0,
    uses90d: 0,
    key: 'retire',
  },
  {
    id: 'bulk-edit',
    name: 'Bulk edit',
    description: 'Update many records in one operation.',
    monthlyUsers: 160,
    uses90d: 1100,
    key: 'keep',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    description: 'Send events to external systems.',
    monthlyUsers: 85,
    uses90d: 730,
    key: 'keep',
  },
  {
    id: 'permissions',
    name: 'Permissions',
    description: 'Control access by role.',
    monthlyUsers: 240,
    uses90d: 1700,
    key: 'keep',
  },
]

export const ACCOUNTS = [
  {
    name: 'Northstar Bank',
    yearlyRevenue: 1200000,
    features: [
      'dashboard',
      'alerts',
      'audit-export',
      'quick-filters',
      'permissions',
    ],
  },
  {
    name: 'Meridian Health',
    yearlyRevenue: 800000,
    features: ['dashboard', 'audit-export', 'bulk-edit', 'permissions'],
  },
  {
    name: 'Cedar Labs',
    yearlyRevenue: 180000,
    features: ['dashboard', 'alerts', 'quick-filters', 'webhooks'],
  },
  {
    name: 'Pine Retail',
    yearlyRevenue: 90000,
    features: ['dashboard', 'quick-filters', 'bulk-edit'],
  },
] as const

export const BUSINESS_CONTEXT = {
  renewalNotes: [
    'Northstar Bank: audit export is used every month for regulator reviews; renewal depends on it.',
    'Meridian Health: our compliance team runs the audit export every month for the yearly audit; renewal is in March.',
  ],
  productNote:
    'Saved views (part of the core workspace) already store and reopen any filtered view.',
}
