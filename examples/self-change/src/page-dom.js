// Small helpers that make the elements of the page: an element, an icon, a badge.

const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  out: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  play: '<path d="M6 4v16l14-8z"/>',
  pause: '<path d="M7 4v16"/><path d="M17 4v16"/>',
  info: '<path d="M12 16v-5"/><path d="M12 7.5v.01"/>',
  restart:
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
}

/** Make an element. Null, undefined and false children are left out, so they never print as text. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value !== undefined && value !== false && value !== null) {
      el.setAttribute(key, value)
    }
  }
  el.append(
    ...children
      .flat(Infinity)
      .filter((c) => c !== null && c !== undefined && c !== false && c !== ''),
  )
  return el
}
export function icon(name) {
  const span = h('span', { style: 'display: contents' })
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`
  return span
}
export const badge = (tone, text, dot = false) =>
  h(
    'span',
    { class: `badge ${tone}` },
    dot ? h('span', { class: `dot${dot === 'pulse' ? ' pulse' : ''}` }) : null,
    text,
  )
export const mark = (name) =>
  h('span', { class: 'mark', 'aria-hidden': 'true' }, icon(name))
/** What a version did with a ticket, as badges. `null` means it gave no valid answer. */
export const chips = (route) =>
  h(
    'span',
    { class: 'chips' },
    route
      ? [
          badge('plain', route.queue),
          route.urgent ? badge('warn', 'urgent') : null,
        ]
      : badge('bad', 'no answer'),
  )
