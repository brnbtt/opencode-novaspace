// Built-in cards that ship with novaSpace. Every other card is a custom card
// found in the novaSpace cards folder (see paths.ts and README).
export const cardIDs = ["account", "session-info"] as const

export type BuiltinCardID = typeof cardIDs[number]
export type CustomCardID = `custom:${string}`
export type CardID = BuiltinCardID | CustomCardID
export const defaultCardOrder: readonly CardID[] = ["account", "session-info"]
export type CardPin = "top" | "bottom" | false

export const defaultPins: Record<BuiltinCardID, CardPin> = {
  account: "top",
  "session-info": "bottom",
}

// Before 0.5.0 the account card was the "setup" card. Saved layouts and
// cli.json options can still name it.
const aliases: Record<string, CardID> = { setup: "account" }
const customCardName = /^[a-z0-9][a-z0-9-]*$/

export function isCustomCardName(value: string) {
  return customCardName.test(value)
}

export function isCustomCardID(value: unknown): value is CustomCardID {
  return typeof value === "string" && value.startsWith("custom:") && isCustomCardName(value.slice(7))
}

export function isCardID(value: unknown): value is CardID {
  return typeof value === "string" && (cardIDs.includes(value as BuiltinCardID) || isCustomCardID(value))
}

export function cardID(value: unknown): CardID | undefined {
  const id = typeof value === "string" ? aliases[value] ?? value : value
  return isCardID(id) ? id : undefined
}

export function cardIDList(value: unknown): CardID[] {
  return Array.isArray(value) ? [...new Set(value.map(cardID).filter((id): id is CardID => !!id))] : []
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

function isPin(value: unknown): value is CardPin {
  return value === false || value === "top" || value === "bottom"
}

export function pinMap(value: unknown): Partial<Record<CardID, CardPin>> {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const pins: Partial<Record<CardID, CardPin>> = {}
  for (const [key, pin] of Object.entries(input)) {
    const id = cardID(key)
    if (id && isPin(pin)) pins[id] = pin
  }
  return pins
}

export function resolveOptions(value: unknown): SidebarOptions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const cards = Array.isArray(input.cards) ? cardIDList(input.cards) : [...defaultCardOrder]
  const hidden = new Set(input.hidden instanceof Set ? [...input.hidden] : cardIDList(input.hidden))
  const requested = pinMap(input.pins)
  const pins: Record<CardID, CardPin> = { ...defaultPins }
  for (const id of cardIDs) if (requested[id] !== undefined) pins[id] = requested[id]
  for (const id of cards) if (isCustomCardID(id)) pins[id] = requested[id] ?? false

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
