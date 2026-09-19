/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { SidebarDrag } from "./drag"
import type { TuiContext } from "./types"
import { cards } from "./cards/registry"
import { cardSurface } from "./ui"
import { FloatingCard } from "./card-preview"

export function DragOverlay(props: { drag: SidebarDrag; ctx: TuiContext }) {
  // Keymaps need the rendered app's provider, which is absent during setup().
  props.ctx.keymap?.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [{ bind: "escape", enabled: () => !!props.drag.gesture(), run: () => { if (!props.drag.gesture()) return false; props.drag.cancel() } }],
  }))
  const dimensions = useTerminalDimensions()
  const state = props.drag.gesture
  const target = () => state()?.target
  const previewSize = () => ({
    width: Math.min(state()?.preview.width ?? 1, dimensions().width),
    height: Math.min(state()?.preview.height ?? 1, Math.max(1, dimensions().height - 1)),
  })
  const previewTop = () => {
    const desired = state()!.y - state()!.preview.grabY
    // Leave the footer prompt visible while the carried card floats above it.
    const limit = target()?.pin === "bottom" ? target()!.rect.y - previewSize().height - 1 : dimensions().height - previewSize().height - 1
    return Math.max(0, Math.min(desired, limit))
  }
  return (
    <Show when={state()}>
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
        <Show when={state()?.moved}>
          <Show when={target()?.pin === "bottom"}>
            <box
              id="sidebar-bottom-drop-hint" position="absolute" zIndex={3}
              left={target()!.rect.x} top={target()!.rect.y} width={target()!.rect.width} height={Math.max(4, target()!.rect.height - 1)}
              border borderColor={props.ctx.theme.text.feedback.info.base}
              backgroundColor={cardSurface(props.ctx.theme, 0.25)} justifyContent="center" alignItems="center" paddingLeft={1} paddingRight={1}
            >
              <text selectable={false} fg={props.ctx.theme.text.feedback.info.base}>{state()!.fromBottom
                ? target()!.before ? `Move before ${cards()[target()!.before!].title}` : "Move to the last bottom page"
                : "Add this card to the bottom"}</text>
              <text selectable={false} fg={props.ctx.theme.text.muted}>{state()!.fromBottom ? "Release to reorder" : "Release to pin"}</text>
            </box>
          </Show>
          <Show when={target()?.pin === false}>
            <box id="sidebar-drop-line" position="absolute" zIndex={1} left={target()!.rect.x} top={target()!.line} width={target()!.rect.width} height={1} border={["top"]} borderColor={props.ctx.theme.text.feedback.info.base} />
          </Show>
          <FloatingCard
            snapshot={state()!.preview} theme={props.ctx.theme}
            left={Math.max(0, Math.min(state()!.x - state()!.preview.grabX, dimensions().width - previewSize().width - 1))}
            top={previewTop()} width={previewSize().width} height={previewSize().height}
          />
        </Show>
      </box>
    </Show>
  )
}
