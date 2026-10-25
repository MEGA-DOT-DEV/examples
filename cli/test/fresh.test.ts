import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { folderVersion, importFresh } from '../src/viewer/fresh.ts'

const dir = mkdtempSync(join(tmpdir(), 'mex-fresh-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, text: string, time: number) => {
  const file = join(dir, name)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
  utimesSync(file, time, time)
}

test('a new folder version reloads api.ts and the modules it imports; the same version reuses them', async () => {
  write(
    'api.ts',
    "import { value } from './lib/dep.ts'\nexport const read = () => value\n",
    1000,
  )
  write('lib/dep.ts', 'export const value = 1\n', 1000)
  write('ui/app.js', '// the page: not part of the version\n', 5000)
  const v1 = folderVersion(dir)
  assert.equal(v1, '1000000', 'the newest source file, not ui/')
  assert.equal(
    ((await importFresh(join(dir, 'api.ts'), v1)).read as () => number)(),
    1,
  )

  // An edit to the imported module, not to api.ts.
  write('lib/dep.ts', 'export const value = 2\n', 2000)
  assert.equal(
    ((await importFresh(join(dir, 'api.ts'), v1)).read as () => number)(),
    1,
    'same version: the loaded modules stay',
  )
  const v2 = folderVersion(dir)
  assert.notEqual(v2, v1)
  assert.equal(
    ((await importFresh(join(dir, 'api.ts'), v2)).read as () => number)(),
    2,
    'new version: the import is fresh too',
  )
})
