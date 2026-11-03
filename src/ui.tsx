/** @jsxImportSource @opentui/solid */
import { MouseButton, parseColor, RGBA, type BoxRenderable, type MouseEvent, type ScrollBoxOptions } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createContext, createEffect, createSignal, For, onCleanup, onMount, untrack, useContext, Show, type JSX } from "solid-js"
import type { Color, HueScale, Theme, TuiContext } from "./types"
import type { CardDragBinding } from "./drag"

export const novaMark = "✧"

// ── Palette ──────────────────────────────────────────────────────────────
// Everything below derives from the host theme's semantic tokens and hue
// scales, so the sidebar follows light and dark themes. Hue steps follow the
// mode's contrast: 200 is a strong ink and 800 a soft tint in either mode.

export function mix(from: Color, to: Color, amount: number) {
  const [fr, fg, fb] = parseColor(from).toInts()
  const [tr, tg, tb] = parseColor(to).toInts()
  return RGBA.fromInts(
    Math.round(fr + (tr - fr) * amount),
    Math.round(fg + (tg - fg) * amount),
    Math.round(fb + (tb - fb) * amount),
  )
}

export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "error"

const toneHues: Record<Tone, string[]> = {
  neutral: ["neutral", "gray"],
  accent: ["accent", "interactive"],
  info: ["blue", "cyan", "interactive", "accent"],
  success: ["green"],
  warning: ["yellow", "orange"],
  error: ["red"],
}

function feedback(theme: Theme, tone: Tone): Color {
  if (tone === "neutral") return theme.text.muted
  if (tone === "accent") return theme.text.feedback.info.base
  return theme.text.feedback[tone].base
}

/** A full scale for a tone, synthesised from the feedback colour when the theme has no hues. */
export function scale(theme: Theme, tone: Tone): Required<HueScale> {
  for (const name of toneHues[tone]) {
    const hue = theme.hue?.[name]
    if (hue?.["200"] && hue["800"]) return { ...synthetic(theme, feedback(theme, tone)), ...hue } as Required<HueScale>
  }
  return synthetic(theme, feedback(theme, tone))
}

function synthetic(theme: Theme, ink: Color): Required<HueScale> {
  const bg = theme.background.base
  const steps = [0.95, 1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18, 0.08]
  return Object.fromEntries(steps.map((amount, index) => [String((index + 1) * 100), mix(bg, ink, amount)])) as Required<HueScale>
}

/** Ink for text and glyphs in a tone. */
export function ink(theme: Theme, tone: Tone): Color {
  return tone === "neutral" ? theme.text.muted : scale(theme, tone)["200"]
}

export function toneColor(theme: Theme, tone: Tone) {
  return ink(theme, tone)
}

export function accent(theme: Theme) {
  return ink(theme, "accent")
}

export function faint(theme: Theme) {
  return theme.text.faint && theme.text.faint !== theme.text.muted ? theme.text.faint : mix(theme.background.base, theme.text.muted, 0.6)
}

export function cardBorder(theme: Theme) {
  return theme.border?.base ?? mix(theme.background.base, theme.text.muted, 0.55)
}

/** Raised surfaces: the base tile, its hover, and the strongest lift. */
export function raised(theme: Theme, level: "base" | "high" | "max" = "base"): Color {
  const surface = theme.background.raised?.[level]
  if (surface) return surface
  return mix(theme.background.base, theme.background.action.primary.hovered, level === "base" ? 0.35 : level === "high" ? 0.6 : 1)
}

export function cardSurface(theme: Theme, strength: number) {
  return mix(theme.background.base, raised(theme), strength)
}

/**
 * A stable colour identity for a card, chosen from the theme's categorical
 * hues by the card's ID, so every custom card is told apart with no effort.
 */
export function identity(theme: Theme, key: string | undefined): Required<HueScale> {
  const palette = theme.categorical?.filter((hue) => hue["200"] && hue["800"]) ?? []
  if (!key || !palette.length) return scale(theme, "accent")
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { ...scale(theme, "accent"), ...palette[hash % palette.length] } as Required<HueScale>
}

/** `count` colours evenly spaced from `from` to `to`. */
export function gradient(from: Color, to: Color, count: number): RGBA[] {
  if (count <= 0) return []
  if (count === 1) return [parseColor(to)]
  return Array.from({ length: count }, (_, index) => mix(from, to, index / (count - 1)))
}

/**
 * A run of one repeated glyph coloured along a gradient. Neighbouring cells
 * with the same colour share a span, so long runs stay cheap to render.
 */
export function GradientRun(props: { glyph: string; colors: RGBA[] }) {
  const runs = () => {
    const result: { color: RGBA; length: number }[] = []
    for (const color of props.colors) {
      const last = result.at(-1)
      if (last && last.color.equals(color)) last.length++
      else result.push({ color, length: 1 })
    }
    return result
  }
  return (
    <text selectable={false} wrapMode="none">
      <For each={runs()}>{(run) => <span style={{ fg: run.color }}>{props.glyph.repeat(run.length)}</span>}</For>
    </text>
  )
}

/** Tracks a box's width so content can fill it cell by cell. */
export function useWidth() {
  let node: BoxRenderable | undefined
  const [width, setWidth] = createSignal(0)
  const measure = () => { if (node) setWidth(node.width) }
  onMount(measure)
  return { width, measure, ref: (value: BoxRenderable) => { node = value } }
}

export function nativeScrollbar(theme: Theme, visible = true): ScrollBoxOptions["verticalScrollbarOptions"] {
  return {
    width: 1,
    showArrows: false,
    visible,
    trackOptions: {
      backgroundColor: "transparent",
      foregroundColor: theme.scrollbar?.base ?? cardBorder(theme),
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

/** A full-width hairline that fades out at both ends. */
export function Divider(props: { theme: Theme; strong?: boolean }) {
  const size = useWidth()
  const colors = () => {
    const middle = props.strong ? cardBorder(props.theme) : faint(props.theme)
    const rise = gradient(props.theme.background.base, middle, Math.min(Math.ceil(size.width() / 2), 6))
    return [...rise, ...Array(Math.max(0, size.width() - rise.length * 2)).fill(parseColor(middle)), ...rise.toReversed()].slice(0, size.width())
  }
  return (
    <box ref={size.ref} onSizeChange={size.measure} height={1} flexShrink={0} width="100%">
      <GradientRun glyph="─" colors={colors()} />
    </box>
  )
}

// ── Tile ─────────────────────────────────────────────────────────────────

type TileState = { hovered(): boolean; hue(): Required<HueScale>; surface(): Color; drag?: CardDragBinding }
const TileContext = createContext<TileState>()
const SurfaceContext = createContext<() => Color>()

/** The surface the current component sits on, for half-block caps and pills. */
export function useSurface(theme: Theme) {
  const surface = useContext(SurfaceContext)
  return () => surface?.() ?? theme.background.base
}

/**
 * A tile, styled like OpenCode's own prompt box: a flat raised surface with a
 * row of padding above and below, and a thin coloured edge on the left. The
 * edge is a column of text cells because text respects scroll clipping in the
 * host, while native box borders do not.
 */
export function Tile(props: {
  id?: string
  theme: Theme
  fill: () => Color
  edge: () => Color
  ref?: (node: BoxRenderable) => void
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: (event: MouseEvent) => void
  onMouseDrag?: (event: MouseEvent) => void
  onMouseDragEnd?: (event: MouseEvent) => void
  opacity?: number
  marginBottom?: number
}) {
  let node: BoxRenderable | undefined
  const [height, setHeight] = createSignal(0)
  const measure = () => { if (node) setHeight(node.height) }
  onMount(measure)
  return (
    <box
      id={props.id}
      ref={(value) => { node = value; props.ref?.(value) }}
      onSizeChange={measure}
      flexDirection="row"
      flexShrink={0}
      opacity={props.opacity ?? 1}
      marginBottom={props.marginBottom ?? 0}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={props.onMouseUp}
      onMouseDrag={props.onMouseDrag}
      onMouseDragEnd={props.onMouseDragEnd}
    >
      <text width={1} flexShrink={0} height={Math.max(1, height())} selectable={false} fg={props.edge()} bg={props.fill()}>{Array(Math.max(1, height())).fill("┃").join("\n")}</text>
      <box flexDirection="column" flexGrow={1} minWidth={0} backgroundColor={props.fill()} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <SurfaceContext.Provider value={props.fill}>{props.children}</SurfaceContext.Provider>
      </box>
    </box>
  )
}

/**
 * A card. Give it a `title` (and optionally an `icon` and `meta`) and it draws
 * its own header; or compose `CardTitle` inside a `cardHeader` row yourself.
 * Each card gets a colour identity from its ID, used by its icon, meters and
 * the edge it lights on hover.
 */
export function Card(props: {
  theme: Theme
  /** How strongly the tile stands out, from 0 (flat) to 1 (the theme's raised surface). */
  strength?: number
  hoverStrength?: number
  hoverDuration?: number
  /** Overrides the card's colour identity. */
  accent?: Color
  title?: string
  icon?: string
  /** Shown at the right of the header; a string renders muted. */
  meta?: JSX.Element | string
  onPress?: () => void
  onHoverChange?: (hovered: boolean) => void
  children?: JSX.Element
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
  const hue = () => {
    const base = identity(props.theme, props.drag?.id)
    return props.accent ? { ...base, "200": props.accent } : base
  }
  const rest = () => mix(props.theme.background.base, raised(props.theme), props.strength ?? 1)
  const surface = () => mix(rest(), raised(props.theme, "high"), (props.hoverStrength ?? 1) * progress())
  const lifted = () => !!props.drag && props.drag.manager.gesture()?.id === props.drag.id
    && props.drag.manager.forSession(props.drag.sessionID) && props.drag.manager.gesture()?.moved
  const state: TileState = { hovered, hue, surface, drag: props.drag }
  return (
    <TileContext.Provider value={state}>
      <Tile
        id={props.drag ? `card-${props.drag.id}` : undefined}
        theme={props.theme}
        fill={surface}
        edge={() => hue()["200"]}
        ref={(value) => { root = value }}
        opacity={lifted() ? 0.35 : 1}
        marginBottom={props.marginBottom}
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
        <Show when={props.title}>{(title) => (
          <box {...cardHeader}>
            <CardTitle theme={props.theme} title={title()} icon={props.icon} drag={props.drag} />
            <Show when={props.meta}>{(meta) => typeof meta() === "string"
              ? <text flexShrink={0} fg={props.theme.text.muted}>{meta() as string}</text>
              : meta() as JSX.Element}</Show>
          </box>
        )}</Show>
        {props.children}
      </Tile>
    </TileContext.Provider>
  )
}

/**
 * The card's icon and bold title. When the card can move, the title is its
 * drag handle and the icon turns into a grip under the pointer.
 */
export function CardTitle(props: { theme: Theme; title: string; icon?: string; drag?: CardDragBinding }) {
  const tile = useContext(TileContext)
  const [grabbing, setGrabbing] = createSignal(false)
  const hue = () => tile?.hue() ?? scale(props.theme, "accent")
  return (
    <box
      id={props.drag ? `card-${props.drag.id}-handle` : undefined}
      flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} gap={1} height={1}
      onMouseOver={() => setGrabbing(!!props.drag)} onMouseOut={() => setGrabbing(false)}
      onMouseDown={(event) => { if (props.drag) props.drag.manager.start(props.drag.sessionID, props.drag.id, event) }}
    >
      <text selectable={false} flexShrink={0} fg={grabbing() ? props.theme.text.muted : hue()["200"]}>{grabbing() ? "⠿" : props.icon ?? "●"}</text>
      <text selectable={false} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={props.theme.text.base}><b>{props.title}</b></text>
    </box>
  )
}

// ── Baseline kit ─────────────────────────────────────────────────────────

/**
 * A small chip in a tone's soft tint and strong ink. A neutral chip is a shade
 * off the surface it sits on, so it stays visible on any tile in any theme.
 */
export function Pill(props: { theme: Theme; tone?: Tone; children: string }) {
  const surface = useSurface(props.theme)
  const hue = () => scale(props.theme, props.tone ?? "neutral")
  const toned = () => !!props.tone && props.tone !== "neutral"
  return (
    <text selectable={false} flexShrink={0} wrapMode="none"
      bg={toned() ? hue()["800"] : mix(surface(), props.theme.text.muted, 0.18)} fg={toned() ? hue()["200"] : props.theme.text.base}>{` ${props.children} `}</text>
  )
}

/** A list row: a toned glyph, the main text, and muted detail on the right. */
export function Item(props: { theme: Theme; icon?: string; tone?: Tone; title: string; detail?: string; muted?: boolean }) {
  return (
    <box flexDirection="row" gap={1} height={1} minWidth={0}>
      <Show when={props.icon}><text selectable={false} flexShrink={0} fg={ink(props.theme, props.tone ?? "neutral")}>{props.icon}</text></Show>
      <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={props.muted ? props.theme.text.muted : props.theme.text.base}>{props.title}</text>
      <Show when={props.detail}><text flexShrink={0} wrapMode="none" fg={props.theme.text.muted}>{props.detail}</text></Show>
    </box>
  )
}

/** A label and its value on one row. */
export function Stat(props: { theme: Theme; label: string; value: string; tone?: Tone }) {
  return (
    <box {...metricRow} height={1}>
      <text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={props.theme.text.muted}>{props.label}</text>
      <text flexShrink={0} fg={props.tone ? ink(props.theme, props.tone) : props.theme.text.base}>{props.value}</text>
    </box>
  )
}

/** The quiet line a card shows when it has nothing to say yet. */
export function Empty(props: { theme: Theme; children: string }) {
  return <text wrapMode="word" fg={faint(props.theme)}>{props.children}</text>
}

/**
 * A one-row meter that fills the available width, for usage, quota and
 * progress. `value` is a fraction from 0 to 1. Without a tone it uses the
 * card's colour, then turns warning at 80% and error at 90%.
 */
export function Meter(props: { theme: Theme; value: number; tone?: Tone }) {
  const tile = useContext(TileContext)
  const size = useWidth()
  const value = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0))
  const filled = () => value() > 0 ? Math.max(1, Math.round(size.width() * value())) : 0
  const hue = () => {
    const tone = props.tone ?? (value() >= 0.9 ? "error" : value() >= 0.8 ? "warning" : undefined)
    return tone ? scale(props.theme, tone) : tile?.hue() ?? scale(props.theme, "accent")
  }
  const surface = useSurface(props.theme)
  const track = () => mix(surface(), props.theme.text.muted, 0.18)
  return (
    <box ref={size.ref} onSizeChange={size.measure} flexDirection="row" height={1} flexShrink={0} width="100%">
      <Show when={filled() > 0}><GradientRun glyph="━" colors={gradient(hue()["500"], hue()["200"], filled())} /></Show>
      <Show when={size.width() - filled() > 0}><text selectable={false} wrapMode="none" fg={track()}>{"━".repeat(size.width() - filled())}</text></Show>
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
    backgroundColor: hovered ? raised(theme, "max") : undefined,
  }
}

export function actionText(theme: Theme, hovered: boolean, muted = false) {
  return hovered ? theme.text.base : muted ? theme.text.muted : accent(theme)
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
