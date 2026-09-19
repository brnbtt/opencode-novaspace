import { createMemoBackend } from "./backend"
import type { MemoryStatus } from "./types"

export const REFRESH_MS = 30_000

export type MemoryState = {
  loading: boolean
  status?: MemoryStatus
  error?: string
}

export function createMemoryStore(load = () => createMemoBackend().status()) {
  let state: MemoryState = { loading: false }
  let active: Promise<void> | undefined
  let disposed = false
  const listeners = new Set<(state: MemoryState) => void>()

  const publish = (next: MemoryState) => {
    state = next
    for (const listener of listeners) listener(state)
  }

  const refresh = async (force = false) => {
    if (disposed) return
    if (active && !force) return active
    const request = (async () => {
      publish({ ...state, loading: true })
      try {
        const status = await load()
        if (!disposed) publish({ loading: false, status })
      } catch (error) {
        if (!disposed) publish({
          loading: false,
          status: state.status,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    active = request
    await request
    if (active === request) active = undefined
  }

  return {
    subscribe(listener: (state: MemoryState) => void) {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    refresh,
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}

export type MemoryStore = ReturnType<typeof createMemoryStore>
