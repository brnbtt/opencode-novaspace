/** @jsxImportSource @opentui/solid */
import { MouseButton, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { createContext, createSignal, onCleanup, onMount, useContext, type JSX } from "solid-js"
import type { TuiContext } from "../../types"

export function displaySetupPath(ctx: TuiContext, path: string) {
  return ctx.ui.format?.path(path) ?? path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
}

type Action = { id: string; node: BoxRenderable; run(): void }
const Actions = createContext<{ active(): string | undefined; register(action: Action): void }>()
export function SetupActions(props: { ctx: TuiContext; children: JSX.Element; typing?: boolean }) {
  const actions: Action[] = []
  const [active, setActive] = createSignal<string>()
  const move = (direction: number) => {
    if (!actions.length) return
    const index = actions.findIndex((item) => item.id === active())
    const next = actions[(index + direction + actions.length) % actions.length]!
    setActive(next.id)
    let ancestor = next.node.parent
    while (ancestor) {
      const scroll = ancestor as ScrollBoxRenderable
      if (scroll.viewport && typeof scroll.scrollBy === "function") {
        if (next.node.y < scroll.viewport.y) scroll.scrollBy(next.node.y - scroll.viewport.y)
        else if (next.node.y + next.node.height > scroll.viewport.y + scroll.viewport.height) scroll.scrollBy(next.node.y + next.node.height - scroll.viewport.y - scroll.viewport.height)
      }
      ancestor = ancestor.parent
    }
  }
  props.ctx.keymap?.layer(() => ({ mode: "global", priority: 100, commands: [
    { bind: "tab", enabled: () => !props.typing, run: () => move(1) },
    { bind: "shift+tab", enabled: () => !props.typing, run: () => move(-1) },
    { bind: "return", enabled: () => !props.typing && !!active(), run: () => actions.find((item) => item.id === active())?.run() },
  ] }))
  return <Actions.Provider value={{ active, register(action) {
    actions.push(action)
    onCleanup(() => {
      const index = actions.indexOf(action)
      if (index >= 0) actions.splice(index, 1)
      if (active() === action.id) setActive(undefined)
    })
  } }}>{props.children}</Actions.Provider>
}

export function SetupActionLink(props: {
  id: string
  ctx: TuiContext
  label: string
  disabled?: boolean
  onPress(): void
}) {
  const [hovered, setHovered] = createSignal(false)
  const actions = useContext(Actions)
  let node: BoxRenderable | undefined
  const run = () => { if (!props.disabled) props.onPress() }
  const highlighted = () => !props.disabled && (hovered() || actions?.active() === props.id)
  onMount(() => { if (node) actions?.register({ id: props.id, node, run }) })
  return (
    <box
      id={props.id}
      ref={(value) => { node = value }}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={highlighted() ? props.ctx.theme.background.action.primary.hovered : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== MouseButton.LEFT || event.isDragging) return
        event.stopPropagation()
        run()
      }}
    >
      <text selectable={false} fg={props.disabled ? props.ctx.theme.text.muted : highlighted() ? props.ctx.theme.text.action.primary.hovered : props.ctx.theme.text.feedback.info.base}>{props.label}</text>
    </box>
  )
}
