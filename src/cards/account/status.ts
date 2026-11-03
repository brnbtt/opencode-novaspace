import type { SyncState } from "../../sync/engine"
import type { Tone } from "../../ui"

export type SyncBadge = { glyph: string; label: string; tone: Tone }

/** Status always shows a glyph and a word, never colour alone. */
export function syncBadge(login: string | undefined, state: SyncState | undefined): SyncBadge {
  if (!state?.repository) return { glyph: "○", label: login ? "Not synced" : "Local", tone: "neutral" }
  if (!login || state.status === "paused" || state.account !== login) return { glyph: "‖", label: "Paused", tone: "warning" }
  switch (state.status) {
    case "syncing": return { glyph: "◌", label: "Syncing", tone: "info" }
    case "pending": return { glyph: "◌", label: "Pending", tone: "info" }
    case "synced": return { glyph: "●", label: "Synced", tone: "success" }
    case "conflict": return { glyph: "▲", label: "Conflict", tone: "warning" }
    case "error": return { glyph: "✕", label: "Error", tone: "error" }
    default: return { glyph: "○", label: "Not synced", tone: "neutral" }
  }
}

export function relativeTime(timestamp: number | undefined, now = Date.now()) {
  if (!timestamp) return undefined
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function cardsLabel(count: number) {
  return count === 0 ? "No cards yet" : `${count} ${count === 1 ? "card" : "cards"}`
}

/** The account card's second line: what is true now, and the next step if any. */
export function summary(login: string | undefined, state: SyncState | undefined, count: number, now = Date.now()) {
  const cards = cardsLabel(count)
  if (!login) return `${cards} · sign in to sync`
  if (!state?.repository) return `${cards} · set up sync`
  if (state.account !== login) return `Switch gh to @${state.account}`
  if (state.status === "conflict") return "Choose which version to keep"
  if (state.status === "error") return state.message ?? "Sync failed"
  if (state.status === "syncing") return `${cards} · syncing…`
  const when = relativeTime(state.lastSyncedAt, now)
  return when ? `${cards} · synced ${when}` : cards
}
