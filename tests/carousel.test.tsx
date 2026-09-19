import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createLayoutController } from "../src/layout"
import { CardCarousel } from "../src/carousel"
import { context } from "./support"

test("carousel pills and dots switch bounded pages and disappear for a single page", async () => {
  const ctx = context()
  ctx.options = { cards: ["session-info", "subagents"], pins: { "session-info": "bottom", subagents: "bottom" } }
  let controller!: ReturnType<typeof createLayoutController>
  const view = await testRender(() => {
    controller = createLayoutController(ctx)
    return <CardCarousel ctx={ctx} controller={controller} render={(id) => (
      <box>
        <text>{`Page: ${id}`}</text>
        {id === "subagents" ? Array.from({ length: 50 }, (_, index) => <text>{`Agent ${index}`}</text>) : null}
      </box>
    )} />
  }, { width: 38, height: 40 })
  const click = async (id: string) => {
    await view.waitForVisualIdle()
    const node = view.renderer.root.findDescendantById(id)!
    expect(node).toBeDefined()
    await view.mockMouse.click(node.x, node.y)
    await view.flush()
  }
  const navigation = () => view.captureCharFrame().split("\n")[view.renderer.root.findDescendantById("sidebar-pages")!.y]!.trim().replace(/\s+/g, " ")
  try {
    await view.waitForFrame((frame) => frame.includes("Page: session-info"))
    expect(navigation()).toBe("━━ •")
    expect(view.captureCharFrame()).not.toContain("Cards")
    expect(view.captureCharFrame()).not.toContain("+")
    expect(view.renderer.root.findDescendantById("sidebar-page-prev")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("sidebar-page-next")).toBeUndefined()
    await click("sidebar-page-subagents")
    expect(view.captureCharFrame()).toContain("Page: subagents")
    expect(navigation()).toBe("• ━━")
    expect(view.renderer.root.findDescendantById("sidebar-pages")!.y).toBeLessThanOrEqual(14)
    await click("sidebar-page-session-info")
    expect(view.captureCharFrame()).toContain("Page: session-info")
    await view.waitForVisualIdle()
    await view.mockMouse.scroll(4, 0, "left")
    await view.flush()
    expect(controller.activeBottom()).toBe("subagents")
    await view.waitForVisualIdle()
    await view.mockMouse.scroll(4, 1, "right")
    await view.flush()
    expect(controller.activeBottom()).toBe("session-info")
    await view.waitForVisualIdle()
    const navigationRow = view.renderer.root.findDescendantById("sidebar-pages")!
    await view.mockMouse.drag(28, navigationRow.y, 23, navigationRow.y)
    await view.flush()
    expect(controller.activeBottom()).toBe("subagents")
    await controller.pin("working-set", "bottom")
    await view.flush()
    expect(controller.activeBottom()).toBe("working-set")
    expect(navigation()).toBe("• • ━━")
    await controller.hide("working-set")
    await controller.hide("session-info")
    await view.flush()
    expect(view.renderer.root.findDescendantById("sidebar-pages")).toBeUndefined()
    expect(view.captureCharFrame()).toContain("Page: subagents")
    await controller.hide("subagents")
    await view.flush()
    expect(view.captureCharFrame().trim()).toBe("")
  } finally { view.renderer.destroy() }
})
