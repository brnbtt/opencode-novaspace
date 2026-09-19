/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { MouseButton, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import type { CardID } from "./config"
import type { LayoutController } from "./layout"
import type { TuiContext } from "./types"
import { nativeScrollbar, useHostDimensions } from "./ui"
import type { SidebarDrag } from "./drag"

type DragRegion = { manager: SidebarDrag; sessionID: string }

function PageDot(props: { id: CardID; active: boolean; ctx: TuiContext; drag?: DragRegion; onPress(): void }) {
  let root: BoxRenderable | undefined
  const [hovered, setHovered] = createSignal(false)
  onMount(() => { if (root && props.drag) onCleanup(props.drag.manager.registerPage(props.drag.sessionID, props.id, root)) })
  return (
    <box
      ref={(value) => { root = value }} id={`sidebar-page-${props.id}`}
      width={4} height={1} flexShrink={0} alignItems="center"
      onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (event.button === MouseButton.LEFT && !event.isDragging && !props.drag?.manager.gesture()) props.onPress()
      }}
    >
      <text
        selectable={false} fg={props.active || hovered() ? props.ctx.theme.text.base : props.ctx.theme.text.muted}
        opacity={props.active || hovered() ? 1 : 0.55}
      >{props.active ? "━━" : "•"}</text>
    </box>
  )
}

export function CardCarousel(props: { ctx: TuiContext; controller: LayoutController; drag?: DragRegion; render(id: CardID): JSX.Element }) {
  const dimensions = useHostDimensions(props.ctx)
  const [height, setHeight] = createSignal(7)
  let content: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let disposed = false
  let dragStart: number | undefined
  const measure = () => queueMicrotask(() => { if (!disposed && content && !content.isDestroyed) setHeight(content.height) })
  const pages = () => props.controller.layout().bottom
  const active = () => props.controller.activeBottom()
  createEffect(() => { active(); scroll?.scrollTo(0) })
  onCleanup(() => { disposed = true })
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={active()} keyed>{(id) => (
        <scrollbox
          ref={(value) => { scroll = value }}
          height={Math.min(Math.max(1, height()), Math.max(3, Math.floor(dimensions().height * 0.35)))}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}
          onMouseScroll={(event) => {
            if (props.drag?.manager.gesture()) return
            if (event.scroll?.direction !== "left" && event.scroll?.direction !== "right") return
            event.stopPropagation()
            void props.controller.page(event.scroll.direction === "left" ? -1 : 1)
          }}
        >
          <box ref={(value) => { content = value }} flexShrink={0} onSizeChange={measure}>
            {props.render(id)}
          </box>
        </scrollbox>
      )}</Show>
      <Show when={pages().length > 1}>
        <box
          id="sidebar-pages" height={1} flexShrink={0} flexDirection="row" alignItems="center" paddingLeft={2} paddingRight={2}
          onMouseDown={(event) => { if (event.button === MouseButton.LEFT) dragStart = event.x }}
          onMouseDragEnd={(event) => {
            if (props.drag?.manager.gesture()) return
            if (dragStart === undefined) return
            const delta = event.x - dragStart
            dragStart = undefined
            if (Math.abs(delta) < 4) return
            event.stopPropagation()
            void props.controller.page(delta < 0 ? 1 : -1)
          }}
          onMouseScroll={(event) => {
            if (props.drag?.manager.gesture()) return
            if (event.scroll?.direction !== "left" && event.scroll?.direction !== "right") return
            event.stopPropagation()
            void props.controller.page(event.scroll.direction === "left" ? -1 : 1)
          }}
        >
          <box flexGrow={1} flexDirection="row" justifyContent="center">
            <For each={pages()}>{(card) => <PageDot ctx={props.ctx} id={card.id} active={active() === card.id} drag={props.drag} onPress={() => void props.controller.select(card.id)} />}</For>
          </box>
        </box>
      </Show>
    </box>
  )
}
