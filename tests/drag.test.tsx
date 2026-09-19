import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { Card, CardAction, CardTitle, cardHeader } from "../src/ui"
import { createLayoutController } from "../src/layout"
import { Sidebar, SidebarFooter } from "../src/tui"
import { createSidebarDrag, type SidebarDrag } from "../src/drag"
import { DragOverlay } from "../src/drag-overlay"
import { context, theme } from "./support"

async function dragFixture(bottom = true, height = 40) {
  const ctx = context()
  let escape: (() => void | false) | undefined
  let outsideClicks = 0
  ctx.keymap = { layer(input) {
    const binding = input().commands[0]!
    escape = () => binding.enabled?.() ? binding.run() : false
  } }
  ctx.options = { cards: ["working-set", "subagents", "session-info"], pins: { "session-info": bottom ? "bottom" : false } }
  let controller!: ReturnType<typeof createLayoutController>
  let drag!: SidebarDrag
  const view = await testRender(() => {
    controller = createLayoutController(ctx)
    drag = createSidebarDrag(controller, ctx)
    onCleanup(() => drag.dispose())
    return <>
      <box width={42} height="100%" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <box flexShrink={0} paddingBottom={1}><text>SESSION TITLE</text></box>
        <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
          <box flexShrink={0} gap={1} paddingRight={1}><Sidebar ctx={ctx} sessionID="session" controller={controller} drag={drag} /></box>
        </scrollbox>
        <box flexShrink={0} gap={1} paddingTop={1}><SidebarFooter ctx={ctx} sessionID="session" controller={controller} drag={drag} /></box>
      </box>
      <box position="absolute" left={45} top={0} width={15} height="100%" onMouseUp={() => { outsideClicks++ }} />
      <DragOverlay ctx={ctx} drag={drag} />
    </>
  }, { width: 60, height })
  ctx.renderer = view.renderer
  const node = (id: string) => view.renderer.root.findDescendantById(id)!
  const press = async (id: string) => {
    await view.waitForVisualIdle()
    const handle = node(`card-${id}-handle`)
    expect(handle).toBeDefined()
    await view.mockMouse.pressDown(handle.x, handle.y)
    await view.flush()
  }
  return { ctx, controller, drag, view, node, press, escape: () => escape!(), outsideClicks: () => outsideClicks }
}

test("dragging real card grips reorders, previews pinning, and unpins back into scrolling", async () => {
  const { controller, drag, view, node, press } = await dragFixture()
  try {
    const frame = await view.waitForFrame((value) => value.includes("Subagents"))
    expect(frame).not.toContain("⇩")
    expect(frame).not.toContain("↑")
    expect(frame).toContain("⠿ Subagents")
    await press("subagents")
    expect(drag.gesture()?.id).toBe("subagents")
    expect(view.renderer.hasSelection).toBe(false)
    const first = node("card-working-set")
    await view.mockMouse.emitMouseEvent("drag", first.x + 3, first.y)
    await view.flush()
    expect(node("sidebar-drop-line")).toBeDefined()
    const floating = node("sidebar-drag-preview")
    expect(floating.width).toBe(node("card-subagents").width)
    expect(floating.height).toBe(node("card-subagents").height)
    expect(node("card-subagents").opacity).toBe(0.35)
    const previewText = view.captureCharFrame().split("\n").slice(floating.y, floating.y + floating.height).map((line) => line.slice(floating.x, floating.x + floating.width)).join("\n")
    expect(previewText).toContain("⠿ Subagents")
    expect(previewText).toContain("No subagents yet.")
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["working-set", "subagents"])
    await view.mockMouse.release(first.x + 3, first.y)
    await view.flush()
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["subagents", "working-set"])
    expect(node("card-subagents").y).toBeLessThan(node("card-working-set").y)
    expect(drag.gesture()).toBeUndefined()
    expect(node("card-subagents").opacity).toBe(1)

    await press("subagents")
    const footer = node("sidebar-bottom")
    await view.mockMouse.emitMouseEvent("drag", footer.x + 5, footer.y + 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Add this card to the bottom")
    expect(node("sidebar-drag-preview").y + node("sidebar-drag-preview").height).toBeLessThan(footer.y)
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["session-info"])
    await view.mockMouse.release(footer.x + 5, footer.y + 2)
    await view.flush()
    expect(controller.activeBottom()).toBe("subagents")
    expect(controller.layout().scroll.some((card) => card.id === "subagents")).toBe(false)
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["session-info", "subagents"])

    await press("subagents")
    const dot = node("sidebar-page-session-info")
    await view.mockMouse.emitMouseEvent("drag", dot.x, dot.y)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Move before Session info")
    await view.mockMouse.release(dot.x, dot.y)
    await view.flush()
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["subagents", "session-info"])
    expect(controller.activeBottom()).toBe("subagents")

    await press("subagents")
    const middle = node("sidebar-middle")
    await view.mockMouse.emitMouseEvent("drag", middle.x + 4, middle.y)
    await view.flush()
    await view.mockMouse.release(middle.x + 4, middle.y)
    await view.flush()
    expect(controller.layout().bottom.map((card) => card.id)).toEqual(["session-info"])
    expect(controller.layout().scroll[0]?.id).toBe("subagents")
    expect(node("card-subagents").y).toBeLessThan(node("card-working-set").y)
  } finally { view.renderer.destroy() }
})

test("floating preview preserves the full expanded card, styles, and pickup state without remounting", async () => {
  const ctx = context()
  let drag!: SidebarDrag
  let mounts = 0
  let unmounts = 0
  let setValue!: (value: number) => void
  function ExpandedCard() {
    mounts++
    onCleanup(() => { unmounts++ })
    const [value, update] = createSignal(42)
    setValue = update
    const binding = { manager: drag, sessionID: "session", id: "memory" as const }
    return <Card theme={theme} strength={0.14} drag={binding}>
      <CardTitle theme={theme} title="Expanded card" drag={binding} />
      <text fg={theme.text.feedback.info.base}>Ready to drag</text>
      <text wrapMode="word">This wrapped description must keep the same line breaks.</text>
      <text><b>Quota</b>{` ${value()}`}</text>
      <text fg={theme.text.feedback.success.base}>Expanded Ω details</text>
    </Card>
  }
  const view = await testRender(() => {
    drag = createSidebarDrag(createLayoutController(ctx), ctx)
    onCleanup(() => drag.dispose())
    return <>
      <scrollbox width={32} height={4} horizontalScrollbarOptions={{ visible: false }} verticalScrollbarOptions={{ visible: false }}>
        <ExpandedCard />
      </scrollbox>
      <DragOverlay ctx={ctx} drag={drag} />
    </>
  }, { width: 80, height: 30 })
  ctx.renderer = view.renderer
  try {
    const original = await view.waitForFrame((frame) => frame.includes("Expanded card"))
    expect(original).not.toContain("Expanded Ω details")
    await view.waitForVisualIdle()
    const handle = view.renderer.root.findDescendantById("card-memory-handle")!
    await view.mockMouse.pressDown(handle.x, handle.y)
    await view.flush()
    await view.mockMouse.emitMouseEvent("drag", 45, 5)
    await view.flush()
    const preview = view.renderer.root.findDescendantById("sidebar-drag-preview")!
    const text = () => view.captureCharFrame().split("\n").slice(preview.y, preview.y + preview.height).map((line) => line.slice(preview.x, preview.x + preview.width)).join("\n")
    expect(text()).toContain("Expanded Ω details")
    expect(text()).toContain("Quota 42")
    expect(text()).toContain("This wrapped description")
    const span = view.captureSpans().lines.slice(preview.y, preview.y + preview.height).flatMap((line) => line.spans).find((part) => part.text.includes("Quota"))!
    expect(span.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    setValue(43)
    await view.flush()
    expect(text()).toContain("Quota 42")
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
    await view.mockMouse.release(45, 5)
    await view.flush()
    expect(view.renderer.root.findDescendantById("sidebar-drag-preview")).toBeUndefined()
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
  } finally { view.renderer.destroy() }
})

test("drag autoscroll reveals clipped cards and cancellation stops without moving them", async () => {
  const { controller, drag, view, node, press } = await dragFixture(true, 18)
  try {
    await view.waitForFrame((frame) => frame.includes("Working Set"))
    await press("working-set")
    const scroll = node("sidebar-middle") as ScrollBoxRenderable
    await view.mockMouse.emitMouseEvent("drag", scroll.viewport.x + 4, scroll.viewport.y + scroll.viewport.height - 1)
    await Bun.sleep(180)
    await view.flush()
    expect(scroll.scrollTop).toBeGreaterThan(0)
    drag.cancel()
    await view.mockMouse.release(55, 0)
    await view.flush()
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["working-set", "subagents"])
  } finally { view.renderer.destroy() }
})

test("card actions still click normally and body text selection does not start a drag", async () => {
  const ctx = context()
  let clicked = 0
  let drag!: SidebarDrag
  const view = await testRender(() => {
    drag = createSidebarDrag(createLayoutController(ctx), ctx)
    onCleanup(() => drag.dispose())
    return <>
      <Card theme={theme} strength={0.14} drag={{ manager: drag, sessionID: "session", id: "working-set" }}>
        <box {...cardHeader}>
          <CardTitle theme={theme} title="Title" drag={{ manager: drag, sessionID: "session", id: "working-set" }} />
          <CardAction theme={theme} label="Refresh" hovered={false} disabled={!!drag.gesture()} onMouseOver={() => {}} onMouseOut={() => {}} onPress={() => { clicked++ }} />
        </box>
        <text>Selectable body text</text>
      </Card>
      <DragOverlay ctx={ctx} drag={drag} />
    </>
  }, { width: 38, height: 8 })
  ctx.renderer = view.renderer
  try {
    await view.waitForFrame((frame) => frame.includes("Refresh"))
    await view.mockMouse.click(30, 1)
    expect(clicked).toBe(1)
    expect(drag.gesture()).toBeUndefined()
    await view.mockMouse.pressDown(4, 2)
    expect(drag.gesture()).toBeUndefined()
    expect(view.renderer.hasSelection).toBe(true)
    await view.mockMouse.release(8, 2)
    await view.mockMouse.pressDown(2, 1)
    await view.mockMouse.emitMouseEvent("drag", 30, 1)
    await view.mockMouse.release(30, 1)
    await view.flush()
    expect(clicked).toBe(1)
    expect(drag.gesture()).toBeUndefined()
  } finally { view.renderer.destroy() }
})

test("dragging supports an empty footer and cancels without changing the saved layout", async () => {
  const { controller, drag, view, node, press, escape, outsideClicks } = await dragFixture(false)
  try {
    await view.waitForFrame((frame) => frame.includes("Subagents"))
    expect(node("sidebar-bottom")).toBeUndefined()
    await press("subagents")
    expect(node("sidebar-bottom")).toBeDefined()
    const footer = node("sidebar-bottom")
    await view.mockMouse.emitMouseEvent("drag", footer.x + 4, footer.y + 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Add this card to the bottom")
    escape()
    await view.mockMouse.release(55, 0)
    await view.flush()
    expect(controller.layout().bottom).toHaveLength(0)
    expect(node("sidebar-bottom")).toBeUndefined()

    await press("subagents")
    await view.mockMouse.emitMouseEvent("drag", 55, 3)
    await view.mockMouse.release(55, 3)
    await view.flush()
    expect(outsideClicks()).toBe(0)
    expect(controller.layout().scroll.map((card) => card.id)).toEqual(["working-set", "subagents", "session-info"])
    expect(drag.gesture()).toBeUndefined()
    await press("subagents")
    const empty = node("sidebar-bottom")
    await view.mockMouse.emitMouseEvent("drag", empty.x + 4, empty.y + 2)
    await view.mockMouse.release(empty.x + 4, empty.y + 2)
    await view.flush()
    expect(controller.activeBottom()).toBe("subagents")
    await controller.place("setup", "bottom")
    expect(controller.options().pins.setup).toBe("top")
    await controller.pin("setup", false)
    expect(controller.options().pins.setup).toBe("top")
    await controller.place("subagents", false)
    expect(controller.layout().scroll.some((card) => card.id === "subagents")).toBe(true)
  } finally { view.renderer.destroy() }
})
