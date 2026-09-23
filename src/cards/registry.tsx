/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { CardID, CustomCardID, SidebarOptions } from "../config"
import type { CardDefinition, PlacedCard } from "../card"
import { setup } from "./setup"
import { sessionInfo } from "./session-info"

// Built-in cards. Local custom cards are registered at runtime by
// ../custom-cards.ts from the customCards option.
const builtins = () => [setup, sessionInfo]
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

// Resolved lazily on each read. The setup card transitively imports this module
// through its settings modal, so reading a card export at module-eval time could
// hit a circular-import temporal dead zone depending on load order.
export function cards(): Partial<Record<CardID, CardDefinition>> {
  return Object.fromEntries([...builtins(), ...custom().values()].map((card) => [card.id, card]))
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
