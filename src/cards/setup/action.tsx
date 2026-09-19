/** @jsxImportSource @opentui/solid */
import { MouseButton } from "@opentui/core"
import { createSignal } from "solid-js"
import type { TuiContext } from "../../types"

export function displaySetupPath(ctx: TuiContext, path: string) {
  return ctx.ui.format?.path(path) ?? path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
}

export function SetupActionLink(props: {
  id: string
  ctx: TuiContext
  label: string
  onPress(): void
}) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      id={props.id}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hovered() ? props.ctx.theme.background.action.primary.hovered : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== MouseButton.LEFT || event.isDragging) return
        event.stopPropagation()
        props.onPress()
      }}
    >
      <text selectable={false} fg={hovered() ? props.ctx.theme.text.action.primary.hovered : props.ctx.theme.text.feedback.info.base}>{props.label}</text>
    </box>
  )
}
