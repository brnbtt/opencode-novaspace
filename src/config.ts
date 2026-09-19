// Card IDs known to this checkout. The first group ships with the plugin
// framework; the personal group can be removed to publish a framework-only
// build (also remove them from cards/registry.tsx and delete their folders).
export const cardIDs = [
  "setup",
  "session-info",
  "working-set",
  "subagents",
  "memory",
  "copilot",
] as const

export type CardID = typeof cardIDs[number]
// A fresh install shows only the generic cards. Personal cards are added
// through the user's opencode.json(c) plugin options (see README).
export const defaultCardOrder: readonly CardID[] = ["setup", "session-info"]
export type CardPin = "top" | "bottom" | false

export const defaultPins: Record<CardID, CardPin> = {
  setup: "top",
  "session-info": "bottom",
  "working-set": false,
  subagents: false,
  memory: false,
  copilot: "bottom",
}

export type SidebarOptions = {
  cards: CardID[]
  hidden: Set<CardID>
  pins: Record<CardID, CardPin>
  surfaceStrength: number
  pinnedSurfaceStrength: number
  hoverStrength: number
  hoverDuration: number
  gap: number
}

export function isCardID(value: unknown): value is CardID {
  return typeof value === "string" && cardIDs.includes(value as CardID)
}

function isPin(value: unknown): value is CardPin {
  return value === false || value === "top" || value === "bottom"
}

export function resolveOptions(value: unknown): SidebarOptions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const requested = Array.isArray(input.cards) ? input.cards.filter(isCardID) : [...defaultCardOrder]
  const cards = [...new Set(requested)]
  const hidden = new Set(Array.isArray(input.hidden) ? input.hidden.filter(isCardID) : [])
  const pinInput = input.pins && typeof input.pins === "object" ? input.pins as Record<string, unknown> : {}
  const pins = { ...defaultPins }
  for (const id of cardIDs) if (isPin(pinInput[id])) pins[id] = pinInput[id]

  return {
    cards,
    hidden,
    pins,
    surfaceStrength: typeof input.surfaceStrength === "number"
      ? Math.max(0, Math.min(1, input.surfaceStrength))
      : 0.14,
    pinnedSurfaceStrength: typeof input.pinnedSurfaceStrength === "number"
      ? Math.max(0, Math.min(1, input.pinnedSurfaceStrength))
      : 0.08,
    hoverStrength: typeof input.hoverStrength === "number"
      ? Math.max(0, Math.min(0.4, input.hoverStrength))
      : 0.08,
    hoverDuration: typeof input.hoverDuration === "number"
      ? Math.max(40, Math.min(400, Math.round(input.hoverDuration)))
      : 120,
    gap: typeof input.gap === "number" ? Math.max(0, Math.min(3, Math.round(input.gap))) : 1,
  }
}
