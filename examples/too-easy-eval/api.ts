// Functions that the browser page (ui/) calls through `npx mex open`.
// compare() scores both search versions on both datasets; no model runs.
import { oneOf } from '#shared/input.ts'
import { DATASETS, NOTES, PAIRS, scoreBoth } from './search.ts'

export function compare(input: { dataset?: unknown }) {
  const dataset = oneOf(input.dataset, DATASETS, 'dataset')
  if (!dataset) {
    throw new Error('Send a dataset.')
  }

  return {
    selected: dataset,
    datasets: scoreBoth(),
    pairs: PAIRS,
    notes: NOTES,
  }
}
