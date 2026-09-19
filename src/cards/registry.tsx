/** @jsxImportSource @opentui/solid */
import type { CardID, SidebarOptions } from "../config"
import type { CardDefinition, PlacedCard } from "../card"
// Generic cards that ship with the plugin framework.
import { setup } from "./setup"
import { sessionInfo } from "./session-info"
// Personal cards. Remove this block (and their folders) to publish a
// framework-only build; also trim the matching IDs in ../config.ts.
import { workingSet } from "./working-set"
import { subagents } from "./subagents"
import { memory } from "./memory"
import { copilot } from "./copilot"

// The active card set for this checkout. Add a card by dropping a subfolder in
// src/cards/ that default-exports defineCard(...) and adding it to this list.
const definitions = () => [setup, sessionInfo, workingSet, subagents, memory, copilot]

// Resolved lazily on first use. The setup card transitively imports this module
// through its settings modal, so reading a card export at module-eval time could
// hit a circular-import temporal dead zone depending on load order.
let byId: Record<CardID, CardDefinition> | undefined
export function cards(): Record<CardID, CardDefinition> {
  return byId ??= Object.fromEntries(definitions().map((card) => [card.id, card])) as Record<CardID, CardDefinition>
}

export function activeCards(options: SidebarOptions): PlacedCard[] {
  const all = cards()
  return options.cards.flatMap((id) => options.hidden.has(id) ? [] : [{ ...all[id], pin: options.pins[id] }])
}

export function partitionCards(options: SidebarOptions) {
  const active = activeCards(options)
  return {
    top: active.filter((card) => card.pin === "top"),
    scroll: active.filter((card) => card.pin === false),
    bottom: active.filter((card) => card.pin === "bottom"),
  }
}
