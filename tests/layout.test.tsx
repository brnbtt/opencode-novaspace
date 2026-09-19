import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { defaultCardOrder, resolveOptions } from "../src/config"
import { partitionCards } from "../src/cards/registry"
import { createLayoutController, type LayoutPreferences } from "../src/layout"
import { context } from "./support"

test("ships a framework-only default layout and adds personal cards on request", () => {
  const options = resolveOptions({})
  const layout = partitionCards(options)
  expect(defaultCardOrder).toEqual(["setup", "session-info"])
  expect(layout.top.map((card) => card.id)).toEqual(["setup"])
  expect(layout.scroll.map((card) => card.id)).toEqual([])
  expect(layout.bottom.map((card) => card.id)).toEqual(["session-info"])

  // Personal cards appear only when the user's options opt into them.
  const personal = partitionCards(resolveOptions({
    cards: ["setup", "working-set", "subagents", "memory", "copilot"],
    pins: { setup: "top", copilot: "bottom" },
  }))
  expect(personal.scroll.map((card) => card.id)).toEqual(["working-set", "subagents", "memory"])
  expect(personal.bottom.map((card) => card.id)).toEqual(["copilot"])

  const duplicateBottom = resolveOptions({ pins: { setup: "bottom", copilot: "bottom" } })
  expect(duplicateBottom.pins.setup).toBe("bottom")
  expect(duplicateBottom.pins.copilot).toBe("bottom")
  const existing = partitionCards(resolveOptions({ cards: ["setup", "copilot"], pins: { copilot: "bottom" } }))
  expect(existing.bottom.map((card) => card.id)).toEqual(["copilot"])
})

test("reordering, pins, and selected pages persist across reloads", async () => {
  const ctx = context()
  ctx.options = { cards: ["setup", "working-set", "subagents", "copilot"] }
  let saved: LayoutPreferences = {}
  ctx.storage = {
    store<T extends object>(_key: string, options: { initial: T }) {
      const [state, setState] = createStore<T>({ ...options.initial, ...saved })
      return [state, async (update: (draft: T) => void) => {
        setState(produce(update))
        saved = JSON.parse(JSON.stringify(state))
      }]
    },
  }
  let dispose!: () => void
  const controller = createRoot((cleanup) => { dispose = cleanup; return createLayoutController(ctx) })
  try {
    await controller.move("subagents", -1)
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["subagents", "working-set"])
    await controller.pin("subagents", "bottom")
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["subagents", "copilot"])
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["working-set"])
    expect(controller.activeBottom()).toBe("subagents")
    await controller.move("subagents", 1)
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["copilot", "subagents"])
    await controller.select("copilot")
  } finally { dispose() }

  const restored = createRoot((cleanup) => { dispose = cleanup; return createLayoutController(ctx) })
  try {
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["copilot", "subagents"])
    expect(restored.activeBottom()).toBe("copilot")
    await restored.hide("copilot")
    expect(restored.activeBottom()).toBe("subagents")
    await restored.pin("subagents", false)
    expect(restored.layout().bottom).toHaveLength(0)
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["working-set", "subagents"])
    await restored.pin("session-info", "bottom")
    expect(restored.activeBottom()).toBe("session-info")
    await restored.reset()
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["copilot"])
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["working-set", "subagents"])
  } finally { dispose() }
})
