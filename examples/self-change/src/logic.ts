export const about = 'Every ticket goes to support, and nothing is urgent.'

export function route(_ticket: { text: string }) {
  return { queue: 'support', urgent: false }
}
