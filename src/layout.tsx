/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
// .tsx selects OpenCode 2.0.7's host-Solid import rewrite for this reactive helper.
import { createStore, produce } from "solid-js/store"
import { isCardID, isCustomCardID, resolveOptions, type CardID, type CardPin } from "./config"
import { partitionCards } from "./cards/registry"
import type { TuiContext } from "./types"

export type LayoutPreferences = {
  cards?: CardID[]
  pins?: Partial<Record<CardID, CardPin>>
  hidden?: CardID[]
  activeBottom?: CardID
}

function volatileStore(): [LayoutPreferences, (update: (draft: LayoutPreferences) => void) => Promise<void>] {
  const [state, setState] = createStore<LayoutPreferences>({})
  return [state, async (update) => { setState(produce(update)) }]
}

export function createLayoutController(ctx: TuiContext) {
  const [preferences, update] = ctx.storage?.store<LayoutPreferences>("sidebar-layout-v1", { initial: {} }) ?? volatileStore()
  const options = createMemo(() => {
    const base = resolveOptions(ctx.options)
    // Newly configured custom cards join an existing saved layout without resetting it.
    const saved = preferences.cards
    const cards = saved ? [...saved, ...base.cards.filter((id) => isCustomCardID(id) && !saved.includes(id))] : base.cards
    return resolveOptions({ ...base, cards, pins: { ...base.pins, ...preferences.pins }, hidden: preferences.hidden ?? [...base.hidden] })
  })
  const layout = createMemo(() => partitionCards(options()))
  const activeBottom = createMemo(() => layout().bottom.find((card) => card.id === preferences.activeBottom)?.id ?? layout().bottom[0]?.id)
  const save = (mutate: (draft: LayoutPreferences) => void) => update(mutate).catch((error) => {
    ctx.ui.toast.show({ title: "novaSpace", message: `Could not save layout: ${String(error)}`, variant: "error" })
  })
  const edit = (mutate: (draft: Required<Pick<LayoutPreferences, "cards" | "pins" | "hidden">> & LayoutPreferences) => void) => {
    const current = options()
    const draft = { cards: [...current.cards], pins: { ...current.pins }, hidden: [...current.hidden], activeBottom: activeBottom() }
    mutate(draft)
    return save((saved) => { Object.assign(saved, draft) })
  }
  return {
    options, layout, activeBottom,
    select(id: CardID) {
      if (!layout().bottom.some((card) => card.id === id)) return Promise.resolve()
      return save((draft) => { draft.activeBottom = id })
    },
    page(delta: number) {
      const pages = layout().bottom
      if (!pages.length) return Promise.resolve()
      const index = pages.findIndex((card) => card.id === activeBottom())
      return save((draft) => { draft.activeBottom = pages[(index + delta + pages.length) % pages.length]!.id })
    },
    move(id: CardID, delta: -1 | 1) {
      if (id === "setup") return Promise.resolve()
      return edit((draft) => {
        const group = draft.cards.filter((card) => !draft.hidden.includes(card) && draft.pins[card] === draft.pins[id])
        const other = group[group.indexOf(id) + delta]
        if (!other) return
        const from = draft.cards.indexOf(id)
        const to = draft.cards.indexOf(other)
        ;[draft.cards[from], draft.cards[to]] = [other, id]
      })
    },
    pin(id: CardID, pin: CardPin) {
      if (!isCardID(id) || id === "setup") return Promise.resolve()
      return edit((draft) => {
        if (!draft.cards.includes(id)) draft.cards.push(id)
        draft.hidden = draft.hidden.filter((card) => card !== id)
        draft.pins[id] = pin
        if (pin === "bottom") draft.activeBottom = id
      })
    },
    place(id: CardID, pin: false | "bottom", before?: CardID) {
      if (!isCardID(id) || id === "setup" || before === id) return Promise.resolve()
      if (before && (!options().cards.includes(before) || options().hidden.has(before) || options().pins[before] !== pin)) return Promise.resolve()
      return edit((draft) => {
        draft.cards = draft.cards.filter((card) => card !== id)
        const at = before ? draft.cards.indexOf(before) : draft.cards.findLastIndex((card) => draft.pins[card] === pin) + 1
        draft.cards.splice(at > 0 || before ? at : draft.cards.length, 0, id)
        draft.pins[id] = pin
        draft.hidden = draft.hidden.filter((card) => card !== id)
        if (pin === "bottom") draft.activeBottom = id
      })
    },
    hide(id: CardID) {
      if (id === "setup") return Promise.resolve()
      return edit((draft) => { if (!draft.hidden.includes(id)) draft.hidden.push(id) })
    },
    reset() { return save((draft) => { delete draft.cards; delete draft.pins; delete draft.hidden; delete draft.activeBottom }) },
  }
}

export type LayoutController = ReturnType<typeof createLayoutController>
