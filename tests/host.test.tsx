import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { RGBA, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { Divider, nativeScrollbar } from "../src/ui"
import { fitSidebarHost } from "../src/host"
import { theme } from "./support"

test("bounds the native sidebar host, keeps pins fixed, and restores host spacing", async () => {
  let host: ScrollBoxRenderable | undefined
  let middle: ScrollBoxRenderable | undefined
  let root: BoxRenderable | undefined
  let restore: (() => void) | undefined
  function Content() {
    onMount(() => { restore = fitSidebarHost(root!, true) })
    onCleanup(() => restore?.())
    return (
      <box ref={(value) => { root = value }} height="100%" flexGrow={1}>
        <Divider theme={theme} />
        <box height={4} flexShrink={0}><text>PINNED PROFILE</text></box>
        <scrollbox
          ref={(value) => { middle = value }}
          flexGrow={1} flexBasis={0} minHeight={1}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ ...nativeScrollbar(theme), visible: true }}
        >
          {Array.from({ length: 60 }, (_, index) => <text flexShrink={0}>{`Row ${index}`}</text>)}
        </scrollbox>
      </box>
    )
  }
  // Host hierarchy and spacing observed in the installed OpenCode 2.0.7.
  const view = await testRender(() => (
    <box width={42} height="100%" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
      <box flexShrink={0} paddingRight={2} paddingBottom={1}><text>SESSION TITLE</text></box>
      <scrollbox ref={(value) => { host = value }} flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <box flexShrink={0} gap={1} paddingRight={1}><Content /></box>
      </scrollbox>
      <box flexShrink={0} gap={1} paddingTop={1}>
        <box>
          <Divider theme={theme} />
          <text>PINNED COPILOT</text>
        </box>
      </box>
    </box>
  ), { width: 42, height: 40 })
  try {
    await view.waitForFrame((frame) => frame.includes("PINNED PROFILE"))
    const line = (text: string) => view.captureCharFrame().split("\n").findIndex((value) => value.includes(text))
    expect(line("PINNED PROFILE")).toBe(line("SESSION TITLE") + 2)
    const top = line("PINNED PROFILE")
    const bottom = line("PINNED COPILOT")
    expect(host!.scrollHeight).toBe(host!.viewport.height)
    expect(middle!.verticalScrollBar.width).toBe(1)
    middle!.scrollTo(1000)
    await view.flush()
    expect(line("PINNED PROFILE")).toBe(top)
    expect(line("PINNED COPILOT")).toBe(bottom)
    expect(view.captureCharFrame()).toContain("Row 59")
    view.resize(42, 26)
    await view.flush()
    expect(host!.scrollHeight).toBe(host!.viewport.height)
    expect(line("PINNED PROFILE")).toBe(top)
    expect(line("PINNED COPILOT")).toBe(25)
    restore?.()
    await view.flush()
    expect(line("PINNED PROFILE")).toBe(top + 1)
    expect(line("PINNED COPILOT")).toBe(24)
  } finally {
    view.renderer.destroy()
  }
})

test("keeps the native sidebar transparent across theme repaints and restores it", async () => {
  let sidebar: BoxRenderable | undefined
  let root: BoxRenderable | undefined
  let restore: (() => void) | undefined
  const [raised, setRaised] = createSignal("#202030")
  function Content() {
    onMount(() => { restore = fitSidebarHost(root!, true) })
    onCleanup(() => restore?.())
    return <box ref={(value) => { root = value }} height="100%" flexGrow={1}><text>CARDS</text></box>
  }
  const view = await testRender(() => (
    <box ref={(value) => { sidebar = value }} width={42} height="100%" backgroundColor={raised()}>
      <box flexShrink={0}><text>SESSION TITLE</text></box>
      <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <box flexShrink={0}><Content /></box>
      </scrollbox>
      <box flexShrink={0}><text>FOOTER</text></box>
    </box>
  ), { width: 42, height: 20 })
  try {
    await view.waitForFrame((frame) => frame.includes("CARDS"))
    expect(sidebar!.backgroundColor.a).toBe(0)
    setRaised("#304050")
    await view.flush()
    expect(sidebar!.backgroundColor.a).toBe(0)
    restore?.()
    restore = undefined
    expect(sidebar!.backgroundColor.equals(RGBA.fromHex("#304050"))).toBe(true)
    setRaised("#405060")
    await view.flush()
    expect(sidebar!.backgroundColor.equals(RGBA.fromHex("#405060"))).toBe(true)
  } finally {
    view.renderer.destroy()
  }
})
