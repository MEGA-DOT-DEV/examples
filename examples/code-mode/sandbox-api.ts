// The `api` that the model's code gets in the sandbox (#shared/sandbox.ts).
// The sandbox loads this module inside its worker thread: the catalog
// functions run there, and only JSON goes in and out of the model's code.
import { CATALOG, invoke } from './catalog.ts'

export const names = () => CATALOG.map((f) => f.name)

export function call(name: string, input: unknown): unknown {
  const f = CATALOG.find((c) => c.name === name)
  if (!f) {
    throw new Error(`No function api.${name}.`)
  }

  return invoke(f, input)
}
