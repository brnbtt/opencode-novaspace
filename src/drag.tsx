/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
// Keep reactive helpers in .tsx: OpenCode 2.0.7 rewrites their Solid imports to
// the host runtime only through its JSX loader. Plain .ts loads a second runtime.
import { MouseButton, type BoxRenderable, type MouseEvent, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { CardID } from "./config"
import type { LayoutController } from "./layout"
import type { TuiContext } from "./types"
import { snapshotCard, type CardSnapshot } from "./card-preview"

type Rect = { x: number; y: number; width: number; height: number }
export type DropTarget = { pin: false | "bottom"; before?: CardID; rect: Rect; line?: number }
export type Gesture = { sessionID: string; id: CardID; fromBottom: boolean; startX: number; startY: number; x: number; y: number; moved: boolean; cancelled?: boolean; target?: DropTarget; preview: CardSnapshot }
export type CardDragBinding = { sessionID: string; id: CardID; manager: SidebarDrag }

function rect(node: Renderable): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}
function contains(box: Rect, x: number, y: number) {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
}

export function createSidebarDrag(layout: LayoutController, ctx: TuiContext) {
  const [gesture, setGesture] = createSignal<Gesture>()
  const cards = new Map<string, BoxRenderable>()
  const pages = new Map<string, BoxRenderable>()
  const scrolls = new Map<string, ScrollBoxRenderable>()
  const bottoms = new Map<string, BoxRenderable>()
  const key = (session: string, id: CardID) => `${session}/${id}`
  let timer: ReturnType<typeof setInterval> | undefined
  let finishing = false
  let disposed = false

  function targetFor(state: Gesture): DropTarget | undefined {
    const bottom = bottoms.get(state.sessionID)
    if (bottom && !bottom.isDestroyed && contains(rect(bottom), state.x, state.y)) {
      const group = layout.layout().bottom
      const hovered = group.find((card) => {
        const node = pages.get(key(state.sessionID, card.id))
        return node && !node.isDestroyed && contains(rect(node), state.x, state.y)
      })
      let before: CardID | undefined
      if (hovered) {
        const node = pages.get(key(state.sessionID, hovered.id))!
        const remaining = group.filter((card) => card.id !== state.id)
        const index = remaining.findIndex((card) => card.id === hovered.id)
        before = state.x < node.x + node.width / 2 ? hovered.id : remaining[index + 1]?.id
        if (hovered.id === state.id) before = group[group.findIndex((card) => card.id === state.id) + 1]?.id
      } else if (layout.options().pins[state.id] === "bottom") {
        before = group[group.findIndex((card) => card.id === state.id) + 1]?.id
      }
      return { pin: "bottom", before, rect: rect(bottom) }
    }
    const scroll = scrolls.get(state.sessionID)
    if (!scroll || scroll.isDestroyed || !contains(rect(scroll.viewport), state.x, state.y)) return
    const viewport = rect(scroll.viewport)
    const group = layout.layout().scroll.filter((card) => card.id !== state.id)
    let line = viewport.y
    for (const card of group) {
      const node = cards.get(key(state.sessionID, card.id))
      if (!node || node.isDestroyed) continue
      if (state.y < node.y + node.height / 2) return { pin: false, before: card.id, rect: viewport, line: Math.max(viewport.y, Math.min(viewport.y + viewport.height - 1, node.y)) }
      line = node.y + node.height
    }
    return { pin: false, rect: viewport, line: Math.max(viewport.y, Math.min(viewport.y + viewport.height - 1, line)) }
  }

  function clear() {
    clearInterval(timer)
    timer = undefined
    finishing = false
    setGesture()
  }
  function refresh(x: number, y: number) {
    const current = gesture()
    if (!current || current.cancelled || finishing) return
    const state = { ...current, x, y, moved: current.moved || Math.abs(x - current.startX) >= 2 || Math.abs(y - current.startY) >= 1 }
    state.target = state.moved ? targetFor(state) : undefined
    setGesture(state)
  }
  function register<T extends Renderable>(map: Map<string, T>, id: string, node: T) {
    map.set(id, node)
    return () => { if (map.get(id) === node) map.delete(id) }
  }

  return {
    gesture,
    forSession: (sessionID: string) => gesture()?.sessionID === sessionID && !gesture()?.cancelled,
    registerCard(sessionID: string, id: CardID, node: BoxRenderable) {
      const unregister = register(cards, key(sessionID, id), node)
      return () => {
        unregister()
        if (gesture()?.sessionID === sessionID && gesture()?.id === id) clear()
      }
    },
    registerScroll: (sessionID: string, node: ScrollBoxRenderable) => register(scrolls, sessionID, node),
    registerBottom: (sessionID: string, node: BoxRenderable) => register(bottoms, sessionID, node),
    registerPage: (sessionID: string, id: CardID, node: BoxRenderable) => register(pages, key(sessionID, id), node),
    start(sessionID: string, id: CardID, event: MouseEvent) {
      const node = cards.get(key(sessionID, id))
      // Only the non-selectable grip calls start; card titles and body text keep
      // their normal terminal selection behavior.
      if (disposed || id === "setup" || !node || event.button !== MouseButton.LEFT || event.modifiers.ctrl || event.modifiers.shift || event.modifiers.alt) return
      clear()
      ctx.renderer?.clearSelection()
      event.preventDefault()
      event.stopPropagation()
      const preview = snapshotCard(node, event.x, event.y)
      setGesture({ sessionID, id, fromBottom: layout.options().pins[id] === "bottom", startX: event.x, startY: event.y, x: event.x, y: event.y, moved: false, preview })
      timer = setInterval(() => {
        const state = gesture()
        const scroll = state && scrolls.get(state.sessionID)
        if (!state?.moved || !scroll || scroll.isDestroyed || !contains(rect(scroll.viewport), state.x, state.y)) return
        const box = rect(scroll.viewport)
        const delta = state.y <= box.y + 1 ? -1 : state.y >= box.y + box.height - 2 ? 1 : 0
        if (delta) scroll.scrollBy(delta)
        refresh(state.x, state.y)
      }, 80)
    },
    update(event: MouseEvent) { event.stopPropagation(); refresh(event.x, event.y) },
    finish(event: MouseEvent) {
      event.stopPropagation()
      if (finishing || !gesture()) return
      refresh(event.x, event.y)
      const state = gesture()!
      finishing = true
      // OpenTUI still touches the captured node after drag-end/up/drop. Keep the
      // overlay alive until dispatch completes, then change the saved layout.
      queueMicrotask(() => {
        if (disposed || gesture() !== state) return
        clear()
        if (state.moved && state.target) void layout.place(state.id, state.target.pin, state.target.before)
      })
    },
    cancel() {
      clearInterval(timer)
      timer = undefined
      if (finishing) { clear(); return }
      // Keep the transparent input shield until mouseup so cancelling with Esc
      // cannot turn that release into a click on the content underneath.
      setGesture((state) => state ? { ...state, cancelled: true, moved: false, target: undefined } : undefined)
    },
    dispose() { disposed = true; clear(); cards.clear(); pages.clear(); scrolls.clear(); bottoms.clear() },
  }
}

export type SidebarDrag = ReturnType<typeof createSidebarDrag>
