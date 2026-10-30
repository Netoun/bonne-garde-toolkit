/**
 * `fn` over `items` with at most `limit` calls in flight, results in input order. The first failure
 * is the one rethrown, and no call starts after it; calls already running are left to finish.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  const queue = items.entries();
  let failure: { error: unknown } | undefined;

  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const next = queue.next();
      if (next.done) {
        return;
      }
      const [index, item] = next.value;
      try {
        results[index] = await fn(item, index);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== undefined) {
    throw failure.error;
  }
  return results;
}
