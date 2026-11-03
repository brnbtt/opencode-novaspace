import type { SyncState } from "../sync/engine"
import type { Tone } from "../ui"

export type SyncBadge = { glyph: string; label: string; tone: Tone }

/** Status always shows a glyph and a word, never colour alone. */
export function syncBadge(login: string | undefined, state: SyncState | undefined): SyncBadge {
  if (!state?.repository) return login ? { glyph: "○", label: "set up sync", tone: "neutral" } : { glyph: "○", label: "local", tone: "neutral" }
  if (!login || state.status === "paused" || state.account !== login) return { glyph: "‖", label: "paused", tone: "warning" }
  switch (state.status) {
    case "syncing": return { glyph: "◌", label: "syncing", tone: "info" }
    case "pending": return { glyph: "◌", label: "pending", tone: "info" }
    case "synced": return { glyph: "●", label: "synced", tone: "success" }
    case "conflict": return { glyph: "▲", label: "conflict", tone: "warning" }
    case "error": return { glyph: "✕", label: "error", tone: "error" }
    default: return { glyph: "○", label: "set up sync", tone: "neutral" }
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
