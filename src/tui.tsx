/** @jsxImportSource @opentui/solid */
import { createEffect, For, onCleanup, onMount, Show } from "solid-js"
import type { CardID } from "./config"
import { cards } from "./cards/registry"
import type { TuiContext } from "./types"
import { Divider, nativeScrollbar } from "./ui"
import { fitSidebarHost } from "./host"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createLayoutController, type LayoutController } from "./layout"
import { CardCarousel } from "./carousel"
import { createSidebarDrag, type SidebarDrag } from "./drag"
import { DragOverlay } from "./drag-overlay"
import { profileSync } from "./cards/setup/sync"
import { loadCustomCards } from "./custom-cards"

export function RenderCard(props: { id: CardID; ctx: TuiContext; sessionID: string; controller: LayoutController; drag?: SidebarDrag }) {
  // Keep this object stable when unrelated reactive props (e.g. dragging) change.
  // Replacing it re-registers the card and cancels the gesture during cleanup.
  const binding = props.drag && props.id !== "setup" ? {
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
  onMount(() => { if (root) restore = fitSidebarHost(root, true) })
  onCleanup(() => restore?.())
  createEffect(() => { if (scroll) onCleanup(props.drag.registerScroll(props.sessionID, scroll)) })
  return (
    <box ref={(value) => { root = value }} flexDirection="column" flexGrow={1} height="100%">
      <Divider theme={props.ctx.theme} />
      <box flexDirection="column" flexShrink={0} gap={options().gap} paddingRight={2}>
        <For each={layout().top.map((card) => card.id)}>{(id) => <RenderCard id={id} ctx={props.ctx} sessionID={props.sessionID} controller={props.controller} drag={props.drag} />}</For>
      </box>
      <scrollbox
        id="sidebar-middle"
        ref={(value) => { scroll = value }}
        flexGrow={1}
        flexBasis={0}
        minHeight={1}
        scrollY
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), visible: layout().scroll.length > 0 }}
        marginTop={layout().top.length && layout().scroll.length ? options().gap : 0}
      >
        <box flexDirection="column" gap={options().gap} paddingRight={1}>
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
    <box id="sidebar-bottom" ref={(value) => { root = value }} flexDirection="column" flexShrink={0} paddingRight={2}>
      <Divider theme={props.ctx.theme} />
      <Show when={props.controller.layout().bottom.length} fallback={<box height={4} />}>
        <CardCarousel ctx={props.ctx} controller={props.controller} drag={{ manager: props.drag, sessionID: props.sessionID }} render={(id) => <RenderCard id={id} ctx={props.ctx} sessionID={props.sessionID} controller={props.controller} drag={props.drag} />} />
      </Show>
    </box>
  )
}

export function SidebarFooter(props: FooterProps) {
  return <Show when={props.controller.layout().bottom.length || props.drag.forSession(props.sessionID)}><BottomRegion {...props} /></Show>
}

export default {
  id: "novaspace.tui",
  setup(ctx: TuiContext) {
    const stopCustomCards = loadCustomCards(ctx)
    const stopSync = profileSync.start()
    const controller = createLayoutController(ctx)
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
      stopSync()
      drag.dispose()
      unregisterOverlay()
      unregisterContent()
      unregisterFooter()
      stopCustomCards()
    }
  },
}
