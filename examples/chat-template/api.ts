// Functions that the browser page (ui/) calls through `npx mex open`.
import {
  checkMessages,
  DEFAULT_MESSAGES,
  FORMAT_NAMES,
  MAX_CONTENT,
  MAX_MESSAGES,
  ROLE_LABELS,
  ROLES,
  render as renderOne,
  TOOL_MESSAGES,
  TOOL_ROLES,
} from './render.ts'

export function defaults() {
  return {
    messages: DEFAULT_MESSAGES,
    toolMessages: TOOL_MESSAGES,
    roles: ROLES,
    roleLabels: ROLE_LABELS,
    toolRoles: TOOL_ROLES,
    maxMessages: MAX_MESSAGES,
    maxContent: MAX_CONTENT,
  }
}

/** Both formats at once, so the page can compare their token counts. */
export function render(input: {
  messages?: unknown
  separator?: unknown
  open?: unknown
}) {
  const messages = checkMessages(input.messages)
  const separator = input.separator === 'im_sep' ? 'im_sep' : 'newline'
  const open = input.open !== false

  return Object.fromEntries(
    FORMAT_NAMES.map((format) => [
      format,
      renderOne(messages, format, { separator, open }),
    ]),
  )
}
