/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { CardID, CustomCardID, SidebarOptions } from "../config"
import type { CardDefinition, PlacedCard } from "../card"

// Every card is a custom card, registered at runtime by ../custom-cards.tsx
// from the novaSpace cards folder.
const [custom, setCustom] = createSignal<ReadonlyMap<CustomCardID, CardDefinition>>(new Map())

export function registerCustomCard(definition: CardDefinition & { id: CustomCardID }) {
  setCustom((current) => new Map(current).set(definition.id, definition))
  return () => setCustom((current) => {
    if (current.get(definition.id) !== definition) return current
    const next = new Map(current)
    next.delete(definition.id)
    return next
  })
}

/** Loaded custom cards, in load order. */
export function customCards(): CardDefinition[] {
  return [...custom().values()]
}

// Resolved lazily on each read, so a card module that imports this registry
// cannot hit a circular-import temporal dead zone depending on load order.
export function cards(): Partial<Record<CardID, CardDefinition>> {
  return Object.fromEntries([...custom().values()].map((card) => [card.id, card]))
}

export function activeCards(options: SidebarOptions): PlacedCard[] {
  const all = cards()
  return options.cards.flatMap((id) => {
    const card = all[id]
    return options.hidden.has(id) || !card ? [] : [{ ...card, pin: options.pins[id] ?? false }]
  })
}

export function partitionCards(options: SidebarOptions) {
  const active = activeCards(options)
  return {
    top: active.filter((card) => card.pin === "top"),
    scroll: active.filter((card) => card.pin === false),
    bottom: active.filter((card) => card.pin === "bottom"),
  }
}
