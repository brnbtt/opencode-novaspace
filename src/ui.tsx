/** @jsxImportSource @opentui/solid */
import { MouseButton, parseColor, RGBA, type BoxRenderable, type ScrollBoxOptions } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, untrack, Show, type JSX } from "solid-js"
import type { Color, Theme, TuiContext } from "./types"
import type { CardDragBinding } from "./drag"

export const novaMark = "✧"

export function mix(from: Color, to: Color, amount: number) {
  const [fr, fg, fb] = parseColor(from).toInts()
  const [tr, tg, tb] = parseColor(to).toInts()
  return RGBA.fromInts(
    Math.round(fr + (tr - fr) * amount),
    Math.round(fg + (tg - fg) * amount),
    Math.round(fb + (tb - fb) * amount),
  )
}

export function cardSurface(theme: Theme, strength: number) {
  return mix(theme.background.base, theme.background.action.primary.hovered, strength)
}

export function cardBorder(theme: Theme) {
  return theme.border?.base ?? mix(theme.background.base, theme.text.muted, 0.55)
}

/** Text that recedes further than `muted`: hints, separators, idle grips. */
export function faint(theme: Theme) {
  return mix(theme.background.base, theme.text.muted, 0.6)
}

export type Tone = "neutral" | "info" | "success" | "warning" | "error"
export function toneColor(theme: Theme, tone: Tone) {
  return tone === "neutral" ? theme.text.muted : theme.text.feedback[tone].base
}

/**
 * Cards follow OpenCode's own surface language: an elevated fill with a single
 * left accent edge instead of a full box. The edge is a column of text cells,
 * which respect scroll clipping in the host; native box borders do not.
 */
function cardEdge(color: () => Color, surface: () => RGBA) {
  let root: BoxRenderable | undefined
  const [height, setHeight] = createSignal(0)
  const measure = () => { if (root) setHeight(root.height) }
  onMount(measure)
  return {
    ref(value: BoxRenderable) { root = value }, measure,
    edge: () => <Show when={height() > 0}>
      <text position="absolute" left={0} top={0} width={1} height={height()} zIndex={1} selectable={false} fg={color()} bg={surface()}>{Array(height()).fill("▎").join("\n")}</text>
    </Show>,
  }
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
      borderColor={props.strong ? cardBorder(props.theme) : cardSurface(props.theme, 0.18)}
    />
  )
}

export function Card(props: {
  theme: Theme
  strength: number
  hoverStrength?: number
  hoverDuration?: number
  /** Colour of the left edge while the card is idle; it lights up on hover. */
  accent?: Color
  onPress?: () => void
  onHoverChange?: (hovered: boolean) => void
  children: JSX.Element
  marginBottom?: number
  drag?: CardDragBinding
}) {
  let root: BoxRenderable | undefined
  createEffect(() => {
    const drag = props.drag
    if (root && drag) onCleanup(drag.manager.registerCard(drag.sessionID, drag.id, root))
  })
  const [hovered, setHovered] = createSignal(false)
  const [progress, setProgress] = createSignal(0)
  createEffect(() => {
    if (props.hoverStrength === 0) { setProgress(0); return }
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
  const surface = () => cardSurface(props.theme, strength())
  const edgeColor = () => hovered() && (props.onPress || props.hoverStrength !== 0)
    ? props.theme.text.feedback.info.base
    : props.accent ?? cardBorder(props.theme)
  const frame = cardEdge(edgeColor, surface)
  const lifted = () => !!props.drag && props.drag.manager.gesture()?.id === props.drag.id
    && props.drag.manager.forSession(props.drag.sessionID) && props.drag.manager.gesture()?.moved
  return (
    <box
      ref={(value) => { root = value; frame.ref(value) }}
      onSizeChange={frame.measure}
      id={props.drag ? `card-${props.drag.id}` : undefined}
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={surface()}
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
      {props.children}
      {frame.edge()}
    </box>
  )
}

export function CardTitle(props: { theme: Theme; title: string; drag?: CardDragBinding }) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box flexDirection="row" minWidth={0}>
      <text minWidth={0} flexShrink={1} wrapMode="none" truncate fg={props.theme.text.base}><b>{props.title}</b></text>
      <Show when={props.drag}>{(drag) => (
        <box
          id={`card-${drag().id}-handle`} width={2} height={1} flexShrink={0} paddingLeft={1}
          onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
          onMouseDown={(event) => drag().manager.start(drag().sessionID, drag().id, event)}
        >
          <text selectable={false} fg={hovered() ? props.theme.text.feedback.info.base : faint(props.theme)}>⠿</text>
        </box>
      )}</Show>
    </box>
  )
}

/**
 * A one-row horizontal meter that fills the available width, for usage,
 * quota and progress. `value` is a fraction from 0 to 1. The default tone
 * turns warning at 80% and error at 90%.
 */
export function Meter(props: { theme: Theme; value: number; tone?: Tone }) {
  let root: BoxRenderable | undefined
  const [width, setWidth] = createSignal(0)
  const measure = () => { if (root) setWidth(root.width) }
  onMount(measure)
  const value = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0))
  const filled = () => Math.round(width() * value())
  const tone = (): Tone => props.tone ?? (value() >= 0.9 ? "error" : value() >= 0.8 ? "warning" : "info")
  return (
    <box ref={(node) => { root = node }} onSizeChange={measure} flexDirection="row" height={1} flexShrink={0} width="100%">
      <Show when={filled() > 0}><text selectable={false} wrapMode="none" fg={toneColor(props.theme, tone())}>{"━".repeat(filled())}</text></Show>
      <Show when={width() - filled() > 0}><text selectable={false} wrapMode="none" fg={cardBorder(props.theme)}>{"━".repeat(width() - filled())}</text></Show>
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
