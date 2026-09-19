/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { Gesture, SidebarDrag } from "./drag"
import type { TuiContext } from "./types"
import { cards } from "./cards/registry"
import { cardSurface, useHostDimensions } from "./ui"
import { FloatingCard } from "./card-preview"

export function DragOverlay(props: { drag: SidebarDrag; ctx: TuiContext }) {
  // Keymaps need the rendered app's provider, which is absent during setup().
  props.ctx.keymap?.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [{ bind: "escape", enabled: () => !!props.drag.gesture(), run: () => { if (!props.drag.gesture()) return false; props.drag.cancel() } }],
  }))
  const dimensions = useHostDimensions(props.ctx)
  const state = props.drag.gesture
  const previewSize = (gesture: Gesture) => ({
    width: Math.min(gesture.preview.width, dimensions().width),
    height: Math.min(gesture.preview.height, Math.max(1, dimensions().height - 1)),
  })
  const previewTop = (gesture: Gesture) => {
    const desired = gesture.y - gesture.preview.grabY
    const destination = gesture.target
    const size = previewSize(gesture)
    // Leave the footer prompt visible while the carried card floats above it.
    const limit = destination?.pin === "bottom" ? destination.rect.y - size.height - 1 : dimensions().height - size.height - 1
    return Math.max(0, Math.min(desired, limit))
  }
  return (
    <Show when={state()}>{(gesture) => {
      const target = () => gesture().target
      return (
        <box
          id="sidebar-drag-overlay" position="absolute" left={0} top={0} zIndex={2500}
          width={dimensions().width} height={dimensions().height}
          onMouseDrag={props.drag.update} onMouseMove={props.drag.update}
          onMouseUp={props.drag.finish} onMouseDragEnd={props.drag.finish}
          onMouseDown={(event) => { event.stopPropagation(); event.preventDefault() }}
        >
          {/* OpenTUI omits the captured node from hit-testing to find drop targets.
              Two stable full-screen nodes keep mouseup from reaching app actions. */}
          <box id="sidebar-drag-capture" position="absolute" left={0} top={0} width="100%" height="100%" />
          <Show when={gesture().moved}>
            <Show when={target()?.pin === "bottom" ? target() : undefined}>{(destination) => (
              <box
                id="sidebar-bottom-drop-hint" position="absolute" zIndex={3}
                left={destination().rect.x} top={destination().rect.y} width={destination().rect.width} height={Math.max(4, destination().rect.height - 1)}
                border borderColor={props.ctx.theme.text.feedback.info.base}
                backgroundColor={cardSurface(props.ctx.theme, 0.25)} justifyContent="center" alignItems="center" paddingLeft={1} paddingRight={1}
              >
                <text selectable={false} fg={props.ctx.theme.text.feedback.info.base}>{gesture().fromBottom
                  ? destination().before ? `Move before ${cards()[destination().before!].title}` : "Move to the last bottom page"
                  : "Add this card to the bottom"}</text>
                <text selectable={false} fg={props.ctx.theme.text.muted}>{gesture().fromBottom ? "Release to reorder" : "Release to pin"}</text>
              </box>
            )}</Show>
            <Show when={target()?.pin === false ? target() : undefined}>{(destination) => (
              <box id="sidebar-drop-line" position="absolute" zIndex={1} left={destination().rect.x} top={destination().line} width={destination().rect.width} height={1} border={["top"]} borderColor={props.ctx.theme.text.feedback.info.base} />
            )}</Show>
            <FloatingCard
              snapshot={gesture().preview} theme={props.ctx.theme}
              left={Math.max(0, Math.min(gesture().x - gesture().preview.grabX, dimensions().width - previewSize(gesture()).width - 1))}
              top={previewTop(gesture())} width={previewSize(gesture()).width} height={previewSize(gesture()).height}
            />
          </Show>
        </box>
      )
    }}</Show>
  )
}
