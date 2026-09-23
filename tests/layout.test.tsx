import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { defaultCardOrder, resolveOptions } from "../src/config"
import { partitionCards } from "../src/cards/registry"
import { createLayoutController, type LayoutPreferences } from "../src/layout"
import "./custom-cards.fixture"
import { context } from "./support"

test("ships a framework-only default layout and adds custom cards on request", () => {
  const options = resolveOptions({})
  const layout = partitionCards(options)
  expect(defaultCardOrder).toEqual(["setup", "session-info"])
  expect(layout.top.map((card) => card.id)).toEqual(["setup"])
  expect(layout.scroll.map((card) => card.id)).toEqual([])
  expect(layout.bottom.map((card) => card.id)).toEqual(["session-info"])

  // Custom cards appear only when the user's options opt into them.
  const personal = partitionCards(resolveOptions({
    cards: ["setup", "custom:working-set", "custom:subagents", "custom:memory", "custom:copilot"],
    pins: { setup: "top", "custom:copilot": "bottom" },
  }))
  expect(personal.scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:subagents", "custom:memory"])
  expect(personal.bottom.map((card) => card.id)).toEqual(["custom:copilot"])

  const duplicateBottom = resolveOptions({ cards: ["setup", "custom:copilot"], pins: { setup: "bottom", "custom:copilot": "bottom" } })
  expect(duplicateBottom.pins.setup).toBe("bottom")
  expect(duplicateBottom.pins["custom:copilot"]).toBe("bottom")
  // Former built-in IDs are no longer recognised.
  expect(resolveOptions({ cards: ["setup", "subagents", "custom:subagents"] }).cards).toEqual(["setup", "custom:subagents"])
  const existing = partitionCards(resolveOptions({ cards: ["setup", "custom:copilot"], pins: { "custom:copilot": "bottom" } }))
  expect(existing.bottom.map((card) => card.id)).toEqual(["custom:copilot"])
})

test("reordering, pins, and selected pages persist across reloads", async () => {
  const ctx = context()
  ctx.options = { cards: ["setup", "custom:working-set", "custom:subagents", "custom:copilot"], pins: { "custom:copilot": "bottom" } }
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
    await controller.move("custom:subagents", -1)
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["custom:subagents", "custom:working-set"])
    await controller.pin("custom:subagents", "bottom")
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["custom:subagents", "custom:copilot"])
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set"])
    expect(controller.activeBottom()).toBe("custom:subagents")
    await controller.move("custom:subagents", 1)
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot", "custom:subagents"])
    await controller.select("custom:copilot")
  } finally { dispose() }

  const restored = createRoot((cleanup) => { dispose = cleanup; return createLayoutController(ctx) })
  try {
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot", "custom:subagents"])
    expect(restored.activeBottom()).toBe("custom:copilot")
    await restored.hide("custom:copilot")
    expect(restored.activeBottom()).toBe("custom:subagents")
    await restored.pin("custom:subagents", false)
    expect(restored.layout().bottom).toHaveLength(0)
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:subagents"])
    await restored.pin("session-info", "bottom")
    expect(restored.activeBottom()).toBe("session-info")
    await restored.reset()
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot"])
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:subagents"])
  } finally { dispose() }
})

test("declared custom cards join the default order and an existing saved layout", () => {
  const options = resolveOptions({
    customCards: { "custom:subagents": "~/cards/subagents.js", "custom:Bad": "/x.js", "custom:relative": "cards/x.js", other: "/y.js" },
  })
  expect(options.customCards).toEqual({ "custom:subagents": "~/cards/subagents.js" })
  expect(options.cards).toEqual(["setup", "session-info", "custom:subagents"])
  expect(options.pins["custom:subagents"]).toBe(false)

  const ctx = context()
  ctx.options = { customCards: { "custom:subagents": "/cards/subagents.js", "custom:memory": "/cards/memory.js" } }
  // "subagents" is a stale former built-in ID left in a saved layout.
  const saved = { cards: ["session-info", "subagents", "custom:memory", "setup"] } as LayoutPreferences
  ctx.storage = {
    store<T extends object>(_key: string, options: { initial: T }) {
      const [state, setState] = createStore<T>({ ...options.initial, ...saved })
      return [state, async (update: (draft: T) => void) => { setState(produce(update)) }]
    },
  }
  createRoot((dispose) => {
    const controller = createLayoutController(ctx)
    expect(controller.options().cards).toEqual(["session-info", "custom:memory", "setup", "custom:subagents"])
    dispose()
  })
})
