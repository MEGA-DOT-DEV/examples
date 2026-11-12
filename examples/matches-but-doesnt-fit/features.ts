// Six shipped features of one workspace product, observed after 30 days.
// The agreement and signals are identical in both modes; only context changes.
export interface Feature {
  id: string
  name: string
  agreement: { goal: string; barPercent: number; scope: string }
  signals: { measuredPercent: number; quotes: [string, string] }
  clash: boolean
}

export const FEATURES: Feature[] = [
  {
    id: 'weekly-email',
    name: 'Weekly return email',
    agreement: {
      goal: 'Bring inactive users back within 30 days',
      barPercent: 15,
      scope: 'One email per week to inactive users',
    },
    signals: {
      measuredPercent: 18,
      quotes: [
        'The reminder brought me back to my workspace.',
        'I liked seeing what my team changed while I was away.',
      ],
    },
    clash: true,
  },
  {
    id: 'saved-views',
    name: 'Saved views',
    agreement: {
      goal: 'Get teams to reopen a saved view within 30 days',
      barPercent: 40,
      scope: 'Save a filtered view in the workspace',
    },
    signals: {
      measuredPercent: 43,
      quotes: [
        'My saved filter is waiting when I return.',
        'The view saves me a few clicks each morning.',
      ],
    },
    clash: false,
  },
  {
    id: 'invite-flow',
    name: 'Invite flow',
    agreement: {
      goal: 'Get invited teammates to join within 30 days',
      barPercent: 30,
      scope: 'Send an invite from the workspace',
    },
    signals: {
      measuredPercent: 36,
      quotes: [
        'My teammate joined without asking for help.',
        'The invitation made it clear which workspace to use.',
      ],
    },
    clash: false,
  },
  {
    id: 'mobile-offline',
    name: 'Offline reading',
    agreement: {
      goal: 'Get mobile users to read saved items offline within 30 days',
      barPercent: 20,
      scope: 'Cache recent workspace items for offline reading',
    },
    signals: {
      measuredPercent: 12,
      quotes: [
        'I saved an item but could not find it on the train.',
        'The cached list worked on my flight.',
      ],
    },
    clash: false,
  },
  {
    id: 'quick-search',
    name: 'Quick search',
    agreement: {
      goal: 'Get users to find an item using quick search within 30 days',
      barPercent: 25,
      scope: 'Search workspace items from the top bar',
    },
    signals: {
      measuredPercent: 19,
      quotes: [
        'I tried a title but got no useful results.',
        'Search found an older item in seconds.',
      ],
    },
    clash: false,
  },
  {
    id: 'activity-feed',
    name: 'Activity feed',
    agreement: {
      goal: 'Get users to review workspace activity within 30 days',
      barPercent: 70,
      scope: 'Show recent workspace changes in a dedicated feed',
    },
    signals: {
      measuredPercent: 72,
      quotes: [
        'The feed helps me catch changes after time away.',
        'I can follow my team without opening every item.',
      ],
    },
    clash: true,
  },
]

export const PRODUCT_CONTEXT = {
  vision: 'One calm place to catch up on work, without duplicate touchpoints.',
  otherFeatures: FEATURES.map(({ name }) => name),
  teamPlans: [
    'Marketing sends every user a Monday workspace newsletter; the weekly return email also lands on Monday.',
    'The platform team will retire the standalone activity feed next month and put the same activity in the workspace home. New entry points must use workspace home.',
  ],
}
