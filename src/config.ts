// Every sidebar card is a custom card found in the novaSpace cards folder (see
// paths.ts and README). The session header at the top and the account line at
// the bottom are part of the sidebar frame, not cards.
export type CustomCardID = `custom:${string}`
export type CardID = CustomCardID
export type CardPin = "top" | "bottom" | false

const customCardName = /^[a-z0-9][a-z0-9-]*$/

export function isCustomCardName(value: string) {
  return customCardName.test(value)
}

export function isCustomCardID(value: unknown): value is CustomCardID {
  return typeof value === "string" && value.startsWith("custom:") && isCustomCardName(value.slice(7))
}

export const isCardID = isCustomCardID

// Unknown IDs, including the former built-in "setup", "account" and
// "session-info" cards, are dropped.
export function cardID(value: unknown): CardID | undefined {
  return isCardID(value) ? value : undefined
}

export function cardIDList(value: unknown): CardID[] {
  return Array.isArray(value) ? [...new Set(value.map(cardID).filter((id): id is CardID => !!id))] : []
}

export type SidebarOptions = {
  cards: CardID[]
  hidden: Set<CardID>
  pins: Record<CardID, CardPin>
  surfaceStrength: number
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
  const cards = cardIDList(input.cards)
  const hidden = new Set(input.hidden instanceof Set ? [...input.hidden] : cardIDList(input.hidden))
  const requested = pinMap(input.pins)
  const pins: Record<CardID, CardPin> = {}
  for (const id of cards) pins[id] = requested[id] ?? false

  return {
    cards,
    hidden,
    pins,
    surfaceStrength: typeof input.surfaceStrength === "number"
      ? Math.max(0, Math.min(1, input.surfaceStrength))
      : 1,
    hoverStrength: typeof input.hoverStrength === "number"
      ? Math.max(0, Math.min(1, input.hoverStrength))
      : 1,
    hoverDuration: typeof input.hoverDuration === "number"
      ? Math.max(40, Math.min(400, Math.round(input.hoverDuration)))
      : 120,
    gap: typeof input.gap === "number" ? Math.max(0, Math.min(3, Math.round(input.gap))) : 1,
  }
}
