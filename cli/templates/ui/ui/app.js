// The page runs in the browser. It calls functions from ../api.ts with call().
// Use the kit classes (mx-*) from /kit/kit.css, so every example looks the same.
import { call, el } from '../../kit/kit.js'

const notice = document.getElementById('notice')

document.getElementById('run').addEventListener('click', async () => {
  try {
    const { message } = await call('hello', {
      name: document.getElementById('name').value,
    })
    document.getElementById('result').textContent = message
    notice.replaceChildren()
  } catch (error) {
    const hint = error.missingKey
      ? ` Run npx mex setup to add ${error.missingKey}.`
      : ''
    notice.replaceChildren(
      el('p', { class: 'mx-callout mx-callout--warn' }, error.message + hint),
    )
  }
})
