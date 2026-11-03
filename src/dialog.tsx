/** @jsxImportSource @opentui/solid */
import { MouseButton, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { createContext, createSignal, onCleanup, onMount, useContext, type JSX } from "solid-js"
import type { Theme, TuiContext } from "./types"
import { faint, mix } from "./ui"

export function displayPath(ctx: TuiContext, path: string) {
  return ctx.ui.format?.path(path) ?? path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
}

export function openCommand(path: string) {
  return process.platform === "darwin"
    ? ["/usr/bin/open", path]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", path]
      : ["xdg-open", path]
}

export async function openPath(path: string) {
  const child = Bun.spawn(openCommand(path), { stdin: "ignore", stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(stderr.trim() || `Could not open ${path}`)
}

type Action = { id: string; node: BoxRenderable; run(): void }
const Actions = createContext<{ active(): string | undefined; register(action: Action): void }>()

/** Tab / Shift+Tab move between the actions inside, Enter runs the focused one. */
export function DialogActions(props: { ctx: TuiContext; children: JSX.Element; typing?: boolean }) {
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

export type ActionVariant = "link" | "primary" | "quiet"

function actionColors(theme: Theme, variant: ActionVariant, highlighted: boolean, disabled: boolean) {
  if (disabled) return { fg: faint(theme), bg: undefined }
  if (highlighted) return { fg: theme.text.action.primary.hovered, bg: theme.background.action.primary.hovered }
  if (variant === "primary") return { fg: theme.text.base, bg: mix(theme.background.base, theme.text.feedback.info.base, 0.28) }
  return { fg: variant === "quiet" ? theme.text.muted : theme.text.feedback.info.base, bg: undefined }
}

export function ActionLink(props: {
  id: string
  ctx: TuiContext
  label: string
  variant?: ActionVariant
  disabled?: boolean
  selected?: boolean
  onPress(): void
}) {
  const [hovered, setHovered] = createSignal(false)
  const actions = useContext(Actions)
  let node: BoxRenderable | undefined
  const run = () => { if (!props.disabled) props.onPress() }
  const highlighted = () => !props.disabled && (props.selected || hovered() || actions?.active() === props.id)
  const colors = () => actionColors(props.ctx.theme, props.variant ?? "link", highlighted(), !!props.disabled)
  onMount(() => { if (node) actions?.register({ id: props.id, node, run }) })
  return (
    <box
      id={props.id}
      ref={(value) => { node = value }}
      flexShrink={0}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={colors().bg}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== MouseButton.LEFT || event.isDragging) return
        event.stopPropagation()
        run()
      }}
    >
      <text selectable={false} fg={colors().fg}>{props.label}</text>
    </box>
  )
}
