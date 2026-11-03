import { afterAll, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveOptions } from "../src/config"
import { partitionCards } from "../src/cards/registry"
import { createLayoutController, type LayoutPreferences } from "../src/layout"
import { createLayoutFile } from "../src/layout-file"
import { stubCards } from "./custom-cards.fixture"
import { context } from "./support"

const temporary: string[] = []
afterAll(async () => { for (const path of temporary) await rm(path, { recursive: true, force: true }) })

function storage(saved: LayoutPreferences) {
  return {
    store<T extends object>(_key: string, options: { initial: T }) {
      const [state, setState] = createStore<T>({ ...options.initial, ...saved })
      return [state, async (update: (draft: T) => void) => {
        setState(produce(update))
        Object.assign(saved, JSON.parse(JSON.stringify(state)))
      }] as [T, (update: (draft: T) => void) => Promise<void>]
    },
  }
}

test("ships a framework-only default layout and arranges custom cards on request", () => {
  const unstub = stubCards("custom:working-set", "custom:subagents", "custom:memory", "custom:copilot")
  try {
  // The session header and account line are the frame; there are no built-in cards.
  const layout = partitionCards(resolveOptions({}))
  expect([...layout.top, ...layout.scroll, ...layout.bottom]).toHaveLength(0)

  // Custom cards appear only when the user's options opt into them.
  const personal = partitionCards(resolveOptions({
    cards: ["custom:working-set", "custom:subagents", "custom:memory", "custom:copilot"],
    pins: { "custom:working-set": "top", "custom:copilot": "bottom" },
  }))
  expect(personal.top.map((card) => card.id)).toEqual(["custom:working-set"])
  expect(personal.scroll.map((card) => card.id)).toEqual(["custom:subagents", "custom:memory"])
  expect(personal.bottom.map((card) => card.id)).toEqual(["custom:copilot"])

  const duplicateBottom = resolveOptions({ cards: ["custom:memory", "custom:copilot"], pins: { "custom:memory": "bottom", "custom:copilot": "bottom" } })
  expect(duplicateBottom.pins["custom:memory"]).toBe("bottom")
  expect(duplicateBottom.pins["custom:copilot"]).toBe("bottom")
  // Former built-in IDs are no longer recognised.
  expect(resolveOptions({ cards: ["account", "setup", "session-info", "subagents", "custom:subagents"] }).cards).toEqual(["custom:subagents"])
  const existing = partitionCards(resolveOptions({ cards: ["custom:copilot"], pins: { "custom:copilot": "bottom" } }))
  expect(existing.bottom.map((card) => card.id)).toEqual(["custom:copilot"])
  } finally { unstub() }
})

test("reordering, pins, and selected pages persist across reloads", async () => {
  const unstub = stubCards("custom:working-set", "custom:subagents", "custom:copilot", "custom:memory")
  const ctx = context()
  ctx.options = { cards: ["custom:working-set", "custom:subagents", "custom:copilot", "custom:memory"], pins: { "custom:copilot": "bottom" } }
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
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["custom:subagents", "custom:working-set", "custom:memory"])
    await controller.pin("custom:subagents", "bottom")
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["custom:subagents", "custom:copilot"])
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:memory"])
    expect(controller.activeBottom()).toBe("custom:subagents")
    await controller.move("custom:subagents", 1)
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot", "custom:subagents"])
    await controller.select("custom:copilot")
  } catch (error) { unstub(); throw error } finally { dispose() }

  const restored = createRoot((cleanup) => { dispose = cleanup; return createLayoutController(ctx) })
  try {
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot", "custom:subagents"])
    expect(restored.activeBottom()).toBe("custom:copilot")
    await restored.hide("custom:copilot")
    expect(restored.activeBottom()).toBe("custom:subagents")
    await restored.pin("custom:subagents", false)
    expect(restored.layout().bottom).toHaveLength(0)
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:subagents", "custom:memory"])
    await restored.pin("custom:memory", "bottom")
    expect(restored.activeBottom()).toBe("custom:memory")
    await restored.reset()
    expect(restored.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot"])
    expect(restored.layout().scroll.map((card) => card.id)).toEqual(["custom:working-set", "custom:subagents", "custom:memory"])
  } finally { dispose(); unstub() }
})

test("loaded custom cards join the default order and a saved layout, and legacy IDs still resolve", () => {
  const unstub = stubCards("custom:subagents", "custom:memory")
  const ctx = context()
  try {
    createRoot((dispose) => {
      expect(createLayoutController(ctx).options().cards).toEqual(["custom:subagents", "custom:memory"])
      dispose()
    })
    // "subagents", "setup" and "session-info" are stale former built-in IDs.
    ctx.storage = storage({ cards: ["session-info", "subagents", "custom:memory", "setup"] as never, pins: { setup: "top" } as never })
    createRoot((dispose) => {
      const controller = createLayoutController(ctx)
      expect(controller.options().cards).toEqual(["custom:memory", "custom:subagents"])
      expect(controller.layout().top).toHaveLength(0)
      dispose()
    })
  } finally { unstub() }
  expect(resolveOptions({ cards: ["setup", "session-info"], hidden: ["setup"] }).hidden.size).toBe(0)
})

test("the arrangement lives in the synced layout file while the selected page stays local", async () => {
  const unstub = stubCards("custom:subagents", "custom:copilot")
  const root = await mkdtemp(join(tmpdir(), "novaspace-layout-")); temporary.push(root)
  const path = join(root, "layout.json")
  const ctx = context()
  const local = { cards: ["setup", "custom:copilot", "custom:subagents", "session-info"], pins: { setup: "top", "custom:copilot": "bottom" } } as unknown as LayoutPreferences
  ctx.storage = storage(local)
  let file!: ReturnType<typeof createLayoutFile>
  let dispose!: () => void
  const controller = createRoot((cleanup) => { dispose = cleanup; return createLayoutController(ctx, (seed) => (file = createLayoutFile(path, seed, { poll: 60_000 })).store) })
  try {
    // An arrangement saved before 0.5.0 seeds the file once.
    // Legacy IDs are dropped on the way in.
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, cards: ["custom:copilot", "custom:subagents"], pins: { "custom:copilot": "bottom" } })
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["custom:copilot"])
    await controller.pin("custom:subagents", "bottom")
    const saved = JSON.parse(await readFile(path, "utf8"))
    expect(saved.pins["custom:subagents"]).toBe("bottom")
    expect(saved.activeBottom).toBeUndefined()
    expect(local.activeBottom).toBe("custom:subagents")

    // A sync (or another window) rewrites the file; the sidebar follows it.
    await writeFile(path, JSON.stringify({ version: 1, cards: ["custom:copilot", "custom:subagents"], pins: {}, hidden: ["custom:subagents"] }))
    file.reload(true)
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["custom:copilot"])
    expect(controller.layout().bottom).toHaveLength(0)
  } finally { dispose(); file.dispose(); unstub() }
})
