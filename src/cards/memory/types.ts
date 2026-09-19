// Shapes of the OptMem `memo` CLI JSON responses. Owned by the memory card;
// produced in backend.ts and consumed by store.ts, format.ts, and index.tsx.
export type MemoryStatus = {
  memories: number
  firstDate: string | null
  lastDate: string | null
  averageTextBytes: number
  superseded: number
  redacted: number
  summaries: number
  pending: number
  wake: { lines: number; bytes: number; budget: number }
  storeBytes: number
  scopes: Record<string, number>
  legacyUnscoped: number
}

export type MemoryEntry = {
  id: number
  date: string
  scope: string | null
  text: string
  active: boolean
  supersededBy: number | null
  redacted: boolean
}

export type MemoryContext = {
  scope: string
  entries: MemoryEntry[]
  omitted: number
}

export type MemorySearch = {
  query: string
  matches: MemoryEntry[]
  total: number
  omitted: number
}
