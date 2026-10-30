// The outbound gate: plain code that checks each send_email and http_get
// before it runs. It does not read the inbox; it reads only the call. So it
// stops a call that leaks or goes somewhere new, whatever text caused it:
//
//   - a secret in any argument: the canary, or a string shaped like a key
//   - a recipient or a host outside the allowlist
//   - data in a URL query (a long value can carry anything out)
//   - an injection phrase in the outgoing text (one agent's mail is another's inbox)
//
// A blocked call never runs. The model gets the reasons as the tool result.
import { ALLOWED_DOMAINS, CANARY } from './items.ts'
import { sanitize } from './sanitize.ts'

export type OutboundTool = 'send_email' | 'http_get'

const SECRET_LIKE =
  /\b[a-z]{2,8}_(live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b/
/** The longest query value the gate lets out. */
export const MAX_QUERY_VALUE = 15

/** True when the text holds the canary, also with its separators changed or dropped. */
export function hasCanary(text: string): boolean {
  return (
    text.includes(CANARY) ||
    text
      .replace(/[^A-Za-z0-9]/g, '')
      .includes(CANARY.replace(/[^A-Za-z0-9]/g, ''))
  )
}

const allowed = (domain: string) =>
  ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))

/** The addresses in a `to` field: "a@x.example, b@y.example". */
export const recipients = (to: string) => to.split(/[,;\s]+/).filter(Boolean)

export function checkOutbound(
  tool: OutboundTool,
  args: Record<string, unknown>,
): string[] {
  const reasons: string[] = []
  const text = Object.values(args).map(String).join('\n')

  if (hasCanary(text) || SECRET_LIKE.test(text)) {
    reasons.push('it holds a secret')
  }
  if (tool === 'send_email') {
    reasons.push(...recipientReasons(String(args.to ?? '')))
  } else {
    reasons.push(...urlReasons(String(args.url ?? '')))
  }

  // The sanitizer's phrase list, on the clean form of the outgoing text.
  const flags = sanitize(text).flags
  if (flags.length) {
    reasons.push(`it holds an injection phrase: ${flags.join(', ')}`)
  }

  return reasons
}

function recipientReasons(to: string): string[] {
  return recipients(to)
    .filter((address) => {
      // The raw domain, not a cleaned one: a Cyrillic "о" makes it a different domain.
      const domain = address.split('@')[1]?.toLowerCase() ?? ''
      return !allowed(domain)
    })
    .map((address) => `${address} is not on the allowlist`)
}

function urlReasons(text: string): string[] {
  if (!URL.canParse(text)) {
    return ['the URL is not valid']
  }

  const url = new URL(text)
  const query = [...url.searchParams.values()]
  const reasons: string[] = []
  if (!['http:', 'https:'].includes(url.protocol)) {
    reasons.push(`${url.protocol} is not http or https`)
  }
  if (!allowed(url.hostname)) {
    reasons.push(`${url.hostname} is not on the allowlist`)
  }
  if (query.some((value) => value.length > MAX_QUERY_VALUE)) {
    reasons.push('the URL carries data in its query')
  }

  return reasons
}
