import type { JSX } from "solid-js"
import type { CardID, CardPin, SidebarOptions } from "./config"
import type { TuiContext } from "./types"
import type { CardDragBinding } from "./drag"
import type { LayoutController } from "./layout"

export type CardProps = {
  ctx: TuiContext
  sessionID: string
  options: SidebarOptions
  pin: CardPin
  drag?: CardDragBinding
  dragging?: boolean
  layout?: LayoutController
}

// A card owns its identity and how it renders. Default placement (top / scroll /
// bottom) is layout policy in config.defaultPins and user options, not the card.
export type CardDefinition = {
  id: CardID
  title: string
  render(props: CardProps): JSX.Element
}

export type PlacedCard = CardDefinition & { pin: CardPin }

// Each card subfolder default-exports one of these. Register it in
// cards/registry.tsx. See README "Add a card".
export function defineCard(card: CardDefinition): CardDefinition {
  return card
}
