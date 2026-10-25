// Sets the theme before the page paints. Load it in <head> without defer.
// Same rule and storage key as mega.dev: a saved choice wins, then the system.
;(() => {
  const KEY = 'mega-theme'
  const root = document.documentElement
  const stored = () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }
  const resolve = () => {
    const saved = stored()
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
    return matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  const apply = () => {
    root.dataset.theme = resolve()
  }
  apply()
  // Another page of the viewer changed the theme (an example frame, or the viewer).
  addEventListener('storage', (event) => {
    if (event.key === KEY) {
      apply()
    }
  })
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply)
  window.mxTheme = {
    get: resolve,
    set(theme) {
      try {
        localStorage.setItem(KEY, theme)
      } catch {}
      apply()
      // Other pages hear the storage event; this page hears this one.
      dispatchEvent(new Event('mx-theme'))
    },
  }
})()
