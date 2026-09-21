/** @jsxImportSource @opentui/solid */
import { MouseButton, parseColor, RGBA, type BoxRenderable, type ScrollBoxOptions } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, untrack, Show, type JSX } from "solid-js"
import type { Theme, TuiContext } from "./types"
import type { CardDragBinding } from "./drag"

function mix(from: RGBA, to: RGBA, amount: number) {
  const [fr, fg, fb] = from.toInts()
  const [tr, tg, tb] = to.toInts()
  return RGBA.fromInts(
    Math.round(fr + (tr - fr) * amount),
    Math.round(fg + (tg - fg) * amount),
    Math.round(fb + (tb - fb) * amount),
  )
}

export function cardSurface(theme: Theme, strength: number) {
  return mix(parseColor(theme.background.base), parseColor(theme.background.action.primary.hovered), strength)
}

export function cardBorder(theme: Theme) {
  return theme.border?.base ?? mix(parseColor(theme.background.base), parseColor(theme.text.muted), 0.55)
}

/** Text edges respect scroll clipping in both the host and test renderer. Native
 * drawBox borders bypass scissor clipping; buffered borders disappear in the host. */
export function roundedFrame(theme: () => Theme) {
  let root: BoxRenderable | undefined
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  const measure = () => { if (root) setSize({ width: root.width, height: root.height }) }
  onMount(measure)
  return {
    ref(value: BoxRenderable) { root = value }, measure,
    edges: () => <Show when={size().width >= 2 && size().height >= 2}>
      <text position="absolute" left={0} top={0} height={1} width={size().width} zIndex={1} selectable={false} fg={cardBorder(theme())}>{`╭${"─".repeat(Math.max(0, size().width - 2))}╮`}</text>
      <text position="absolute" left={0} bottom={0} height={1} width={size().width} zIndex={1} selectable={false} fg={cardBorder(theme())}>{`╰${"─".repeat(Math.max(0, size().width - 2))}╯`}</text>
      <text position="absolute" left={0} top={1} width={1} height={Math.max(0, size().height - 2)} zIndex={1} selectable={false} fg={cardBorder(theme())}>{Array(Math.max(0, size().height - 2)).fill("│").join("\n")}</text>
      <text position="absolute" right={0} top={1} width={1} height={Math.max(0, size().height - 2)} zIndex={1} selectable={false} fg={cardBorder(theme())}>{Array(Math.max(0, size().height - 2)).fill("│").join("\n")}</text>
    </Show>,
  }
}

export function Panel(props: { id?: string; theme: Theme; strength: number; marginBottom?: number; children: JSX.Element }) {
  const frame = roundedFrame(() => props.theme)
  return <box id={props.id} ref={frame.ref} onSizeChange={frame.measure} flexDirection="column" padding={1} marginBottom={props.marginBottom} backgroundColor={cardSurface(props.theme, props.strength)}>
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>{props.children}</box>
    {frame.edges()}
  </box>
}

export function nativeScrollbar(theme: Theme): ScrollBoxOptions["verticalScrollbarOptions"] {
  return {
    width: 1,
    showArrows: false,
    trackOptions: {
      backgroundColor: theme.background.base,
      foregroundColor: theme.border?.base ?? theme.scrollbar?.base ?? theme.text.muted,
    },
  }
}

/** Use the host renderer directly so installed packages do not depend on a second OpenTUI context. */
export function useHostDimensions(ctx: TuiContext) {
  if (!ctx.renderer) return useTerminalDimensions()
  const renderer = ctx.renderer
  const [dimensions, setDimensions] = createSignal({ width: renderer.width, height: renderer.height })
  const resize = (width: number, height: number) => setDimensions({ width, height })
  onMount(() => renderer.on("resize", resize))
  onCleanup(() => renderer.off("resize", resize))
  return dimensions
}

export function Divider(props: { theme: Theme; strong?: boolean }) {
  return (
    <box
      height={1}
      flexShrink={0}
      border={["top"]}
      borderStyle="single"
      borderColor={props.strong ? mix(parseColor(props.theme.background.base), parseColor(props.theme.text.muted), 0.55) : cardSurface(props.theme, 0.18)}
    />
  )
}

export function Card(props: {
  theme: Theme
  strength: number
  hoverStrength?: number
  hoverDuration?: number
  onPress?: () => void
  onHoverChange?: (hovered: boolean) => void
  children: JSX.Element
  marginBottom?: number
  drag?: CardDragBinding
}) {
  let root: BoxRenderable | undefined
  const frame = roundedFrame(() => props.theme)
  createEffect(() => {
    const drag = props.drag
    if (root && drag) onCleanup(drag.manager.registerCard(drag.sessionID, drag.id, root))
  })
  const [hovered, setHovered] = createSignal(false)
  const [progress, setProgress] = createSignal(0)
  createEffect(() => {
    const target = hovered() ? 1 : 0
    const initial = untrack(progress)
    if (initial === target) return
    const started = Date.now()
    const duration = props.hoverDuration ?? 120
    const timer = setInterval(() => {
      const elapsed = Math.min(1, (Date.now() - started) / duration)
      const eased = 1 - Math.pow(1 - elapsed, 3)
      setProgress(initial + (target - initial) * eased)
      if (elapsed === 1) clearInterval(timer)
    }, 16)
    onCleanup(() => clearInterval(timer))
  })
  const strength = () => Math.min(1, props.strength + (props.hoverStrength ?? 0.08) * progress())
  const lifted = () => !!props.drag && props.drag.manager.gesture()?.id === props.drag.id
    && props.drag.manager.forSession(props.drag.sessionID) && props.drag.manager.gesture()?.moved
  return (
    <box
      ref={(value) => { root = value; frame.ref(value) }}
      onSizeChange={frame.measure}
      id={props.drag ? `card-${props.drag.id}` : undefined}
      flexDirection="column"
      backgroundColor={cardSurface(props.theme, strength())}
      padding={1}
      opacity={lifted() ? 0.35 : 1}
      marginBottom={props.marginBottom ?? 0}
      onMouseOver={() => {
        if (hovered()) return
        setHovered(true)
        props.onHoverChange?.(true)
      }}
      onMouseOut={() => {
        if (!hovered()) return
        setHovered(false)
        props.onHoverChange?.(false)
      }}
      onMouseDrag={(event) => { if (props.drag?.manager.gesture()) props.drag.manager.update(event) }}
      onMouseDragEnd={(event) => { if (props.drag?.manager.gesture()) props.drag.manager.finish(event) }}
      onMouseUp={(event) => {
        if (props.drag?.manager.gesture()) { props.drag.manager.finish(event); return }
        if (event.button === MouseButton.LEFT && !event.isDragging) props.onPress?.()
      }}
    >
      <box flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={cardSurface(props.theme, strength())}>{props.children}</box>
      {frame.edges()}
    </box>
  )
}

export function CardTitle(props: { theme: Theme; title: string; drag?: CardDragBinding }) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box flexDirection="row" minWidth={0}>
      <Show when={props.drag}>{(drag) => (
        <box
          id={`card-${drag().id}-handle`} width={2} height={1} flexShrink={0}
          onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
          onMouseDown={(event) => drag().manager.start(drag().sessionID, drag().id, event)}
        >
          <text selectable={false} fg={hovered() ? props.theme.text.feedback.info.base : props.theme.text.muted}>⠿</text>
        </box>
      )}</Show>
      <text minWidth={0} wrapMode="none" truncate fg={props.theme.text.base}><b>{props.title}</b></text>
    </box>
  )
}

export const cardHeader = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 1,
} as const

export const metricRow = {
  flexDirection: "row",
  justifyContent: "space-between",
  gap: 1,
} as const

export function actionBox(theme: Theme, hovered: boolean, subtle = false) {
  return {
    alignSelf: "flex-start" as const,
    flexShrink: 0,
    paddingLeft: subtle ? 0 : 1,
    paddingRight: subtle ? 0 : 1,
    backgroundColor: hovered ? theme.background.action.primary.hovered : undefined,
  }
}

export function actionText(theme: Theme, hovered: boolean, muted = false) {
  return hovered ? theme.text.action.primary.hovered : muted ? theme.text.muted : theme.text.feedback.info.base
}

export function CardAction(props: {
  theme: Theme
  label: string
  hovered: boolean
  disabled?: boolean
  subtle?: boolean
  onMouseOver(): void
  onMouseOut(): void
  onPress(): void
}) {
  const active = () => props.hovered && !props.disabled
  return (
    <box
      {...actionBox(props.theme, active(), props.subtle)}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={(event) => {
        if (event.button !== MouseButton.LEFT || event.isDragging) return
        event.stopPropagation()
        if (!props.disabled) props.onPress()
      }}
    >
      <text selectable={false} fg={actionText(props.theme, active(), props.subtle || props.disabled)}>{props.label}</text>
    </box>
  )
}
