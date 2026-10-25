/**
 * Runs `fn(0)` to `fn(count - 1)` with at most `limit` of them at the same
 * time. Each result stays at its index; a failed call gives a rejected result
 * and does not stop the others.
 */
export async function mapLimit<T>(
  count: number,
  limit: number,
  fn: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(count)
  let next = 0
  async function worker() {
    while (next < count) {
      const index = next++
      try {
        results[index] = { status: 'fulfilled', value: await fn(index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  const workers = Math.min(limit, count)
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}
