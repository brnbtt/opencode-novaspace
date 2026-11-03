/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { CardID } from "./config"
import { cards } from "./cards/registry"
import type { TuiContext } from "./types"
import { nativeScrollbar } from "./ui"
import { SessionHeader } from "./header"
import { fitSidebarHost } from "./host"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createLayoutController, type LayoutController } from "./layout"
import { createLayoutFile } from "./layout-file"
import { CardCarousel } from "./carousel"
import { createSidebarDrag, type SidebarDrag } from "./drag"
import { DragOverlay } from "./drag-overlay"
import { cardSync } from "./sync/engine"
import { createCardLibrary } from "./custom-cards"
import { novaPaths } from "./paths"
import { AccountLine } from "./account/line"

export function RenderCard(props: { id: CardID; ctx: TuiContext; sessionID: string; controller: LayoutController; drag?: SidebarDrag }) {
  // Keep this object stable when unrelated reactive props (e.g. dragging) change.
  // Replacing it re-registers the card and cancels the gesture during cleanup.
  const binding = props.drag ? {
    manager: props.drag,
    get sessionID() { return props.sessionID },
    id: props.id,
  } : undefined
  const card = cards()[props.id]
  if (!card) return null
  return card.render({
    ctx: props.ctx,
    drag: binding,
    get dragging() { return !!props.drag?.gesture() },
    layout: props.controller,
    get sessionID() { return props.sessionID },
    get options() { return props.controller.options() },
    get pin() { return props.controller.options().pins[props.id] },
  })
}

export function Sidebar(props: { ctx: TuiContext; sessionID: string; controller: LayoutController; drag: SidebarDrag }) {
  const options = props.controller.options
  const layout = props.controller.layout
  let root: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let restore: (() => void) | undefined
  // The scrollbar appears only when the cards actually overflow.
  const [overflow, setOverflow] = createSignal(false)
  const measure = () => { if (scroll && !scroll.isDestroyed) setOverflow(scroll.scrollHeight > scroll.viewport.height) }
  onMount(() => { if (root) restore = fitSidebarHost(root, true, true) })
  onCleanup(() => restore?.())
  createEffect(() => { if (scroll) onCleanup(props.drag.registerScroll(props.sessionID, scroll)) })
  return (
    <box ref={(value) => { root = value }} flexDirection="column" flexGrow={1} height="100%">
      <box flexShrink={0} paddingRight={2} marginBottom={options().gap}>
        <SessionHeader ctx={props.ctx} sessionID={props.sessionID} />
      </box>
      <box flexDirection="column" flexShrink={0} gap={options().gap} paddingRight={2}>
        <For each={layout().top.map((card) => card.id)}>{(id) => <RenderCard id={id} ctx={props.ctx} sessionID={props.sessionID} controller={props.controller} drag={props.drag} />}</For>
      </box>
      <scrollbox
        id="sidebar-middle"
        ref={(value) => { scroll = value }}
        onSizeChange={measure}
        flexGrow={1}
        flexBasis={0}
        minHeight={1}
        scrollY
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={nativeScrollbar(props.ctx.theme, overflow())}
        marginTop={layout().top.length && layout().scroll.length ? options().gap : 0}
      >
        <box flexDirection="column" gap={options().gap} paddingRight={overflow() ? 1 : 2} onSizeChange={measure}>
          <For each={layout().scroll.map((card) => card.id)}>{(id) => <RenderCard id={id} ctx={props.ctx} sessionID={props.sessionID} controller={props.controller} drag={props.drag} />}</For>
        </box>
      </scrollbox>
    </box>
  )
}

type FooterProps = { ctx: TuiContext; sessionID: string; controller: LayoutController; drag: SidebarDrag }

function BottomRegion(props: FooterProps) {
  let root: BoxRenderable | undefined
  createEffect(() => { if (root) onCleanup(props.drag.registerBottom(props.sessionID, root)) })
  return (
    <box id="sidebar-bottom" ref={(value) => { root = value }} flexDirection="column" flexShrink={0}>
      <Show when={props.controller.layout().bottom.length} fallback={<box height={4} />}>
        <CardCarousel ctx={props.ctx} controller={props.controller} drag={{ manager: props.drag, sessionID: props.sessionID }} render={(id) => <RenderCard id={id} ctx={props.ctx} sessionID={props.sessionID} controller={props.controller} drag={props.drag} />} />
      </Show>
    </box>
  )
}

export function SidebarFooter(props: FooterProps) {
  const pinned = () => !!props.controller.layout().bottom.length || !!props.drag.forSession(props.sessionID)
  return (
    <box flexDirection="column" flexShrink={0} paddingRight={2}>
      <Show when={pinned()}><BottomRegion {...props} /></Show>
      <box flexShrink={0} marginTop={pinned() ? 1 : 0}>
        <AccountLine ctx={props.ctx} dragging={!!props.drag.gesture()} />
      </box>
    </box>
  )
}

export default {
  id: "novaspace.tui",
  setup(ctx: TuiContext) {
    const paths = novaPaths()
    const library = createCardLibrary(ctx, paths.cards)
    let layoutFile: ReturnType<typeof createLayoutFile> | undefined
    const controller = createLayoutController(ctx, (seed) => (layoutFile = createLayoutFile(paths.layout, seed)).store)
    const engine = cardSync()
    const stopSync = engine.start()
    // A sync that changed local files may have added cards or a new layout.
    const unsubscribe = engine.subscribe((_, changed) => {
      if (!changed.length) return
      void library.refresh()
      layoutFile?.reload(true)
    })
    const drag = createSidebarDrag(controller, ctx)
    const unregisterOverlay = ctx.ui.slot({ append: "app", render: () => <DragOverlay ctx={ctx} drag={drag} /> })
    const unregisterContent = ctx.ui.slot({
      replace: "sidebar.content",
      render: ({ sessionID }) => <Sidebar ctx={ctx} sessionID={sessionID} controller={controller} drag={drag} />,
    })
    const unregisterFooter = ctx.ui.slot({
      replace: "sidebar.footer",
      render: ({ sessionID }) => <SidebarFooter ctx={ctx} sessionID={sessionID} controller={controller} drag={drag} />,
    })
    return () => {
      unsubscribe()
      void stopSync()
      drag.dispose()
      unregisterOverlay()
      unregisterContent()
      unregisterFooter()
      layoutFile?.dispose()
      library.dispose()
    }
  },
}
