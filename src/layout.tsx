/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
// .tsx selects OpenCode 2.0.7's host-Solid import rewrite for this reactive helper.
import { createStore, produce, unwrap } from "solid-js/store"
import { cardID, cardIDList, isCardID, pinMap, resolveOptions, type CardID, type CardPin } from "./config"
import { customCards, partitionCards } from "./cards/registry"
import type { TuiContext } from "./types"

/** The arrangement that follows the user between machines. */
export type SharedLayout = {
  cards?: CardID[]
  pins?: Partial<Record<CardID, CardPin>>
  hidden?: CardID[]
}
/** Everything saved locally; activeBottom never leaves this machine. */
export type LayoutPreferences = SharedLayout & { activeBottom?: CardID }
export type LayoutStore<T> = [T, (update: (draft: T) => void) => Promise<void>]

function volatileStore(): LayoutStore<LayoutPreferences> {
  const [state, setState] = createStore<LayoutPreferences>({})
  return [state, async (update) => { setState(produce(update)) }]
}

/**
 * `shared` receives the locally saved arrangement as a seed, so a layout made
 * before it moved into the synced layout file carries over.
 */
export function createLayoutController(ctx: TuiContext, shared?: (seed: SharedLayout) => LayoutStore<SharedLayout>) {
  const [local, updateLocal] = ctx.storage?.store<LayoutPreferences>("sidebar-layout-v1", { initial: {} }) ?? volatileStore()
  const [arrangement, updateArrangement] = shared
    ? shared(structuredClone({ cards: unwrap(local).cards, pins: unwrap(local).pins, hidden: unwrap(local).hidden }))
    : [local, updateLocal] as LayoutStore<SharedLayout>
  const options = createMemo(() => {
    const base = resolveOptions(ctx.options)
    const known = arrangement.cards ? cardIDList(arrangement.cards) : base.cards
    // Custom cards join the end of the sidebar once they load, whether or not
    // a layout was saved before they existed.
    const cards = [...known, ...customCards().map((card) => card.id).filter((id) => !known.includes(id))]
    return resolveOptions({ ...base, cards, pins: { ...base.pins, ...pinMap(arrangement.pins) }, hidden: arrangement.hidden ?? [...base.hidden] })
  })
  const layout = createMemo(() => partitionCards(options()))
  const activeBottom = createMemo(() => {
    const selected = cardID(local.activeBottom)
    return layout().bottom.find((card) => card.id === selected)?.id ?? layout().bottom[0]?.id
  })
  const report = (error: unknown) => {
    ctx.ui.toast.show({ title: "novaSpace", message: `Could not save layout: ${String(error)}`, variant: "error" })
  }
  const selectPage = (id: CardID) => updateLocal((draft) => { draft.activeBottom = id }).catch(report)
  const edit = (mutate: (draft: Required<SharedLayout> & { activeBottom?: CardID }) => void) => {
    const current = options()
    const draft = { cards: [...current.cards], pins: { ...current.pins }, hidden: [...current.hidden], activeBottom: activeBottom() }
    mutate(draft)
    const saves = [updateArrangement((saved) => {
      saved.cards = draft.cards
      saved.pins = draft.pins
      saved.hidden = draft.hidden
    }).catch(report)]
    if (draft.activeBottom !== activeBottom()) saves.push(selectPage(draft.activeBottom!))
    return Promise.all(saves).then(() => {})
  }
  return {
    options, layout, activeBottom,
    select(id: CardID) {
      if (!layout().bottom.some((card) => card.id === id)) return Promise.resolve()
      return selectPage(id)
    },
    page(delta: number) {
      const pages = layout().bottom
      if (!pages.length) return Promise.resolve()
      const index = pages.findIndex((card) => card.id === activeBottom())
      return selectPage(pages[(index + delta + pages.length) % pages.length]!.id)
    },
    move(id: CardID, delta: -1 | 1) {
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
      if (!isCardID(id)) return Promise.resolve()
      return edit((draft) => {
        if (!draft.cards.includes(id)) draft.cards.push(id)
        draft.hidden = draft.hidden.filter((card) => card !== id)
        draft.pins[id] = pin
        if (pin === "bottom") draft.activeBottom = id
      })
    },
    place(id: CardID, pin: false | "bottom", before?: CardID) {
      if (!isCardID(id) || before === id) return Promise.resolve()
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
      return edit((draft) => { if (!draft.hidden.includes(id)) draft.hidden.push(id) })
    },
    reset() {
      return Promise.all([
        updateArrangement((draft) => { delete draft.cards; delete draft.pins; delete draft.hidden }).catch(report),
        updateLocal((draft) => { delete draft.activeBottom }).catch(report),
      ]).then(() => {})
    },
  }
}

export type LayoutController = ReturnType<typeof createLayoutController>
