// Four questions about the Larder codebase (shop.ts), in a customer's words.
// Each has one right number, in one policy file. Other policy files hold
// numbers of the same kind (other days, other limits, other retries), so a
// wrong file gives a wrong number. A test checks each answer against the code.
import { byId } from '#shared/input.ts'

export interface Task {
  id: string
  label: string
  text: string
  /** The one right number. */
  answer: number
  /** The file that holds it. */
  file: string
}

export const TASKS: Task[] = [
  {
    id: 'reset-link',
    label: 'Password reset link',
    text: 'A customer forgot their password and asked for a new one. For how many minutes does the link in that email work?',
    answer: 45,
    file: 'services/accounts/src/recovery/policy.ts',
  },
  {
    id: 'card-retries',
    label: 'Failed card payment',
    text: "A customer's card payment failed. How many more times will the shop try to charge the card?",
    answer: 3,
    file: 'services/payments/src/dunning/policy.ts',
  },
  {
    id: 'send-back',
    label: 'Sending an item back',
    text: 'A customer wants to send an item back. How many days after delivery do they have?',
    answer: 30,
    file: 'services/returns/src/eligibility/policy.ts',
  },
  {
    id: 'promo-cap',
    label: 'Promo code discount',
    text: 'What is the biggest discount, in percent, that one promo code can give?',
    answer: 40,
    file: 'services/promotions/src/codes/policy.ts',
  },
]

/** The preset with this id. A missing id is an unknown task too. */
export function taskFor(id: unknown): Task {
  return byId(TASKS, String(id), 'task')
}
