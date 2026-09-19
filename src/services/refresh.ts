// Serialize refreshes, coalesce pending work, and discard results made stale
// by a session move. Disposal aborts the active request and drops pending work.
export function createRefreshQueue<T, R>(
  load: (input: T, signal: AbortSignal) => Promise<R>,
  apply: (result: R) => void,
  failed: (error: unknown) => void,
) {
  let pending: { input: T; version: number } | undefined
  let version = 0
  let running = false
  let disposed = false
  let controller: AbortController | undefined

  async function drain() {
    if (running || disposed) return
    running = true
    try {
      while (pending && !disposed) {
        const current = pending
        pending = undefined
        controller = new AbortController()
        try {
          const result = await load(current.input, controller.signal)
          if (!disposed && current.version === version) apply(result)
        } catch (error) {
          if (!disposed && current.version === version) failed(error)
        }
      }
    } finally {
      running = false
      controller = undefined
    }
  }

  return {
    request(input: T) {
      if (disposed) return
      pending = { input, version: ++version }
      void drain()
    },
    dispose() {
      disposed = true
      pending = undefined
      controller?.abort()
    },
  }
}
