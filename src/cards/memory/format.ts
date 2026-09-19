import type { MemoryContext, MemoryEntry, MemorySearch, MemoryStatus } from "./types"

export function compactBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
}

export function scopeCount(status: MemoryStatus) {
  return Object.keys(status.scopes).length
}

export function statusSummary(status: MemoryStatus) {
  const health = status.pending ? `${status.pending} pending` : "settled"
  return `${status.memories} memories · ${health} · ${compactBytes(status.wake.bytes)} context`
}

function entryLine(entry: MemoryEntry) {
  const state = entry.active ? "" : ` · inactive→#${entry.supersededBy}`
  const prefix = entry.scope ? `[${entry.scope}] ` : ""
  const text = prefix && entry.text.startsWith(prefix) ? entry.text.slice(prefix.length) : entry.text
  return `#${entry.id} · ${entry.date}${entry.scope ? ` · ${entry.scope}` : ""}${state}\n${text}`
}

export function formatContext(context: MemoryContext) {
  if (!context.entries.length) return `Memory context · ${context.scope}\nNo active scoped memories.`
  const omitted = context.omitted ? ` · ${context.omitted} older omitted` : ""
  return [
    `Memory context · ${context.scope}`,
    `${context.entries.length} active${omitted}`,
    "",
    ...context.entries.flatMap((entry, index) => [entryLine(entry), ...(index < context.entries.length - 1 ? [""] : [])]),
  ].join("\n")
}

export function formatSearch(result: MemorySearch) {
  if (!result.matches.length) return `Memory search · ${result.query}\nNo matches.`
  const omitted = result.omitted ? ` · ${result.omitted} older omitted` : ""
  return [
    `Memory search · ${result.query}`,
    `${result.total} match${result.total === 1 ? "" : "es"}${omitted}`,
    "",
    ...result.matches.flatMap((entry, index) => [entryLine(entry), ...(index < result.matches.length - 1 ? [""] : [])]),
  ].join("\n")
}
