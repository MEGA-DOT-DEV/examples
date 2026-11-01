// Synthetic memories, separate from the active conversation. The answer key is
// only for scoring: it is never included in retrieval or answer prompts.
export const PROFILE =
  'Mara Chen lives in Portland. She works on the Atlas app with teammate Sam and trains for a spring 10K. She prefers short, practical answers. Her father is named Sam too.'

export interface Memory {
  id: string
  title: string
  text: string
}
export const MEMORIES: Memory[] = [
  {
    id: 'knee-rehab',
    title: 'Mara running knee rehab',
    text: 'For Mara’s return to running, the physical therapist prescribed a 15-minute easy run followed by 8 minutes of band exercises. Stop if the left knee hurts.',
  },
  {
    id: 'race-plan',
    title: 'Spring 10K race plan',
    text: 'Mara’s spring 10K goal is to finish comfortably. Long runs are on Saturdays at 7 am; avoid pace targets until April.',
  },
  {
    id: 'dad-visit',
    title: 'Sam Chen visit',
    text: 'Mara’s father Sam arrives Friday at 6:20 pm on train 508. He needs a step-free route from Union Station.',
  },
  {
    id: 'sam-coworker',
    title: 'Sam at Atlas',
    text: 'Sam, Mara’s Atlas teammate, owns the search release. Their Friday review is at 2 pm in the Alder room.',
  },
  {
    id: 'atlas-release',
    title: 'Atlas release checklist',
    text: 'Before the Atlas app release, Mara needs a rollback snapshot and approval from the security team. Production deploys happen after 4 pm.',
  },
  {
    id: 'atlas-search',
    title: 'Atlas search feedback',
    text: 'The Atlas search feature needs keyboard focus states and a no-results message. Sam will review the interaction copy.',
  },
  {
    id: 'dog-care',
    title: 'Juniper the dog',
    text: 'Juniper is Mara’s dog. Give her the blue allergy pill with breakfast, not the orange evening supplement.',
  },
  {
    id: 'garden',
    title: 'Balcony garden',
    text: 'Mara’s balcony basil needs water every other morning. The rosemary pot stays dry until the top soil is fully dry.',
  },
  {
    id: 'flight',
    title: 'Seattle conference flight',
    text: 'Mara’s Seattle conference flight leaves at 8:10 am from PDX. Bring the paper conference badge and a photo ID.',
  },
  {
    id: 'conference-talk',
    title: 'Seattle talk',
    text: 'Mara’s conference talk is on accessible search. The talk begins at 11:30 am; the live demo uses the Atlas staging account.',
  },
  {
    id: 'meal',
    title: 'Weeknight dinner',
    text: 'Mara’s weeknight dinner plan is lentil soup. Her partner Eli avoids peanuts; coconut milk is fine.',
  },
  {
    id: 'birthday',
    title: 'Eli birthday plan',
    text: 'For Eli’s birthday, Mara booked the Cedar Table restaurant for 7:15 pm. Ask for a peanut-free dessert.',
  },
  {
    id: 'invoice',
    title: 'Freelance invoice',
    text: 'Mara’s invoice for the Harbor design project is due on the 12th. Send it to billing@harbor.example and include purchase order H-82.',
  },
  {
    id: 'harbor-meeting',
    title: 'Harbor kickoff',
    text: 'The Harbor design kickoff is on the 18th. The client prefers wireframes before a visual review.',
  },
  {
    id: 'reading',
    title: 'Book club',
    text: 'Mara’s book club meets on the first Thursday at 7 pm. This month they are reading The Left Hand of Darkness.',
  },
  {
    id: 'library',
    title: 'Library returns',
    text: 'Mara’s library books are due on the 22nd. The downtown branch has an overnight return slot.',
  },
  {
    id: 'budget',
    title: 'Household budget',
    text: 'Mara sets aside $180 each month for transit. Her annual bike service is paid from the maintenance fund.',
  },
  {
    id: 'bike',
    title: 'Commuter bike',
    text: 'Mara’s commuter bike needs a new rear brake pad before the wet-season rides. The shop opens at 9 am.',
  },
  {
    id: 'music',
    title: 'Piano practice',
    text: 'Mara practices piano on Tuesdays. She is learning the opening of Clair de Lune at half tempo.',
  },
  {
    id: 'volunteer',
    title: 'Community workshop',
    text: 'Mara volunteers at the neighborhood tech workshop on Sundays. Bring two spare laptop chargers and the sign-in sheet.',
  },
]

export interface Turn {
  role: 'user' | 'assistant'
  text: string
}
export interface Thread {
  id: string
  title: string
  turns: Turn[]
  key: { documents: string[]; facts: string[] }
}

export const THREADS: Thread[] = [
  {
    id: 'run',
    title: 'Tomorrow’s workout',
    turns: [
      {
        role: 'user',
        text: 'My left knee has been sore since March, but I want to return to running. What did my physical therapist say about easing in?',
      },
      {
        role: 'assistant',
        text: 'Let me check your running rehab note before I suggest a plan.',
      },
      { role: 'user', text: 'What should I do tomorrow?' },
    ],
    key: {
      documents: ['knee-rehab'],
      facts: ['15-minute easy run', '8 minutes of band exercises'],
    },
  },
  {
    id: 'pickup',
    title: 'Pick up Sam',
    turns: [
      {
        role: 'user',
        text: 'Dad Sam is coming to Portland by train. His mobility makes stairs difficult. My teammate Sam is not part of this.',
      },
      {
        role: 'assistant',
        text: 'I will use the note about your father’s visit.',
      },
      { role: 'user', text: 'When and where should I meet him?' },
    ],
    key: { documents: ['dad-visit'], facts: ['6:20 pm', 'Union Station'] },
  },
  {
    id: 'release',
    title: 'Ship the app',
    turns: [
      {
        role: 'user',
        text: 'I am about to ship the Atlas app to production, not just review its search copy. What is the release process?',
      },
      {
        role: 'assistant',
        text: 'I will look up the production release checklist.',
      },
      { role: 'user', text: 'What needs to happen first?' },
    ],
    key: {
      documents: ['atlas-release'],
      facts: ['rollback snapshot', 'security team'],
    },
  },
  {
    id: 'dog',
    title: 'Juniper’s breakfast',
    turns: [
      {
        role: 'user',
        text: 'I am feeding my dog Juniper before work. I need to give her the right allergy medication.',
      },
      {
        role: 'assistant',
        text: 'I will check Juniper’s care note, not your meal plan.',
      },
      { role: 'user', text: 'Which one goes with this?' },
    ],
    key: { documents: ['dog-care'], facts: ['blue allergy pill', 'breakfast'] },
  },
  {
    id: 'travel',
    title: 'Leave for Seattle',
    turns: [
      {
        role: 'user',
        text: 'I am packing for my Seattle conference flight, rather than preparing the talk itself.',
      },
      { role: 'assistant', text: 'I will check your travel details.' },
      { role: 'user', text: 'When do I leave, and what should I bring?' },
    ],
    key: {
      documents: ['flight'],
      facts: ['8:10 am', 'paper conference badge'],
    },
  },
  {
    id: 'dinner',
    title: 'Dinner with Eli',
    turns: [
      {
        role: 'user',
        text: 'I am cooking our usual weeknight dinner for Eli, not booking his birthday meal. He has a food restriction.',
      },
      { role: 'assistant', text: 'I will check your dinner note.' },
      { role: 'user', text: 'What should I make and avoid?' },
    ],
    key: { documents: ['meal'], facts: ['lentil soup', 'peanuts'] },
  },
  {
    id: 'invoice',
    title: 'Bill Harbor',
    turns: [
      {
        role: 'user',
        text: 'The Harbor design work is done. I need to send the invoice, not schedule the kickoff.',
      },
      { role: 'assistant', text: 'I will check the billing note.' },
      { role: 'user', text: 'Where do I send it and what do I include?' },
    ],
    key: { documents: ['invoice'], facts: ['billing@harbor.example', 'H-82'] },
  },
  {
    id: 'commute',
    title: 'Wet-weather commute',
    turns: [
      {
        role: 'user',
        text: 'I am riding my commuter bike in the rain this week. Is it ready, or do I need the shop?',
      },
      { role: 'assistant', text: 'I will look at your bike maintenance note.' },
      { role: 'user', text: 'What should I do before that?' },
    ],
    key: { documents: ['bike'], facts: ['rear brake pad', '9 am'] },
  },
]
