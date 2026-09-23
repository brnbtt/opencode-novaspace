// Built-in cards that ship with novaSpace. Anything else is a local custom card
// that the user declares in the customCards option (see README).
export const cardIDs = ["setup", "session-info"] as const

export type BuiltinCardID = typeof cardIDs[number]
export type CustomCardID = `custom:${string}`
export type CardID = BuiltinCardID | CustomCardID
export const defaultCardOrder: readonly CardID[] = ["setup", "session-info"]
export type CardPin = "top" | "bottom" | false

export const defaultPins: Record<BuiltinCardID, CardPin> = {
  setup: "top",
  "session-info": "bottom",
}

const customCardID = /^custom:[a-z0-9][a-z0-9-]*$/

export function isCustomCardID(value: unknown): value is CustomCardID {
  return typeof value === "string" && customCardID.test(value)
}

export type SidebarOptions = {
  customCards: Record<CustomCardID, string>
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
  return typeof value === "string" && (cardIDs.includes(value as BuiltinCardID) || isCustomCardID(value))
}

function isPin(value: unknown): value is CardPin {
  return value === false || value === "top" || value === "bottom"
}

export function resolveOptions(value: unknown): SidebarOptions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const customInput = input.customCards && typeof input.customCards === "object" ? input.customCards as Record<string, unknown> : {}
  const customCards = Object.fromEntries(Object.entries(customInput)
    .filter(([id, path]) => isCustomCardID(id) && typeof path === "string" && (path.startsWith("/") || path.startsWith("~/")))) as Record<CustomCardID, string>
  const requested = Array.isArray(input.cards) ? input.cards.filter(isCardID) : [...defaultCardOrder, ...Object.keys(customCards) as CustomCardID[]]
  const cards = [...new Set(requested)]
  const hidden = new Set(Array.isArray(input.hidden) ? input.hidden.filter(isCardID) : [])
  const pinInput = input.pins && typeof input.pins === "object" ? input.pins as Record<string, unknown> : {}
  const pins: Record<CardID, CardPin> = { ...defaultPins }
  for (const id of cardIDs) if (isPin(pinInput[id])) pins[id] = pinInput[id]
  for (const id of cards) if (isCustomCardID(id)) pins[id] = isPin(pinInput[id]) ? pinInput[id] : false

  return {
    customCards,
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
