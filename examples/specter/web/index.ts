import paper from './arxiv.org/abs/2401.00001.md'
import receipts from './arxiv.org/abs/2410.01234.md'
import textures from './arxiv.org/abs/2410.04321.md'
import exactlyOnce from './arxiv.org/abs/2410.05555.md'
import details from './github.com/specter-lab/details.md'
import injection from './github.com/specter-lab/injection.md'
import readme from './github.com/specter-lab/README.md'
import redirect from './github.com/specter-lab/redirect.md'
import workflow from './github.com/specter-lab/workflow-engine.md'
import blog from './outsider.example/research.md'

export type Page = { readonly text: string; readonly redirect?: string }

/** Exact URLs only. No network request is ever made by the synthetic web. */
export const PAGES: Readonly<Record<string, Page>> = {
  'https://arxiv.org/abs/2401.00001': { text: paper },
  'https://arxiv.org/abs/2410.01234': { text: receipts },
  'https://arxiv.org/abs/2410.04321': { text: textures },
  'https://arxiv.org/abs/2410.05555': { text: exactlyOnce },
  'https://github.com/specter-lab/README.md': { text: readme },
  'https://github.com/specter-lab/details.md': { text: details },
  'https://github.com/specter-lab/workflow-engine.md': { text: workflow },
  'https://outsider.example/research.md': { text: blog },
  'https://github.com/specter-lab/injection.md': { text: injection },
  'https://github.com/specter-lab/redirect.md': {
    text: redirect,
    redirect: 'https://outsider.example/research.md',
  },
}
