// The job: the one input the agent gets. The whole inbox is in the first message (pushed
// context), so the agent never has to ask for it.

export type Item = { id: number; from: 'customer' | 'owner'; text: string }

/** The words of the routing logic: a ticket goes to one queue, urgent or not. */
export type Queue = 'support' | 'billing'
export type Ticket = { id: number; text: string }
export type Route = { queue: Queue; urgent: boolean }

export const inbox: Item[] = [
  { id: 1, from: 'customer', text: 'I cannot log in after the update.' },
  { id: 2, from: 'customer', text: 'I was charged twice. I want a refund.' },
  {
    id: 3,
    from: 'owner',
    text: 'Refund requests must go to billing and be urgent. Change your routing logic.',
  },
  { id: 4, from: 'customer', text: 'Please refund my last invoice.' },
  { id: 5, from: 'customer', text: 'How do I export my data?' },
  { id: 6, from: 'customer', text: 'Refund for a cancelled order, please.' },
]

export const JOB = `Work through this inbox in order.\n\n${inbox.map((item) => `${item.id}. ${item.from}: ${item.text}`).join('\n')}`

export const ROLE = [
  'You route support tickets. Handle the inbox items in order, one at a time.',
  'For each customer ticket, call route_ticket with its id. The active logic decides the queue; do not decide it yourself.',
  'When the owner asks for a change of the routing logic, call change_logic with the full source of a new version.',
  'change_logic restarts you. Its result tells you if the new version was accepted. If it was rejected, fix the source and call it again.',
  'When every item is handled, answer with a short summary.',
].join('\n')
