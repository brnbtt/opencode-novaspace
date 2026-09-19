import type { Quota } from "./usage"

export const REFRESH_MS = 5 * 60_000
export type UsageState = { quota?: Quota; loading: boolean; error?: string }

// Shared across mounted cards in one TUI; no model calls or background browser.
export function createUsageStore(load: (signal: AbortSignal) => Promise<Quota>, now = Date.now) {
  let state: UsageState = { loading: false }
  let attemptedAt: number | undefined
  let pending: Promise<void> | undefined
  let disposed = false
  const controller = new AbortController()
  const listeners = new Set<(state: UsageState) => void>()
  const publish = (next: UsageState) => {
    state = next
    for (const listener of listeners) listener(state)
  }

  return {
    subscribe(listener: (state: UsageState) => void) {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    refresh(force = false): Promise<void> {
      if (disposed) return Promise.resolve()
      if (pending) return pending
      if (!force && attemptedAt !== undefined && now() - attemptedAt < REFRESH_MS) return Promise.resolve()
      attemptedAt = now()
      publish({ ...state, loading: true })
      pending = load(controller.signal).then(
        quota => { if (!disposed) publish({ quota, loading: false }) },
        error => {
          if (!disposed) publish({ ...state, loading: false, error: error instanceof Error ? error.message : "Usage refresh failed" })
        },
      ).finally(() => { pending = undefined })
      return pending
    },
    dispose() {
      disposed = true
      controller.abort()
      listeners.clear()
    },
  }
}

export type UsageStore = ReturnType<typeof createUsageStore>
