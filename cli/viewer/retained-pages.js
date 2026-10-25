// Keep visited pages connected: removing an iframe discards its runs and inputs.
export function retainedPages(root) {
  const pages = new Map()
  let active = null

  return {
    get active() {
      return active
    },
    hide() {
      root.hidden = true
      active = null
    },
    show(name, create) {
      let page = pages.get(name)
      if (!page) {
        page = create()
        pages.set(name, page)
        root.append(page)
      }
      for (const [key, cached] of pages) {
        cached.hidden = key !== name
      }
      root.hidden = false
      active = page
      return page
    },
  }
}
