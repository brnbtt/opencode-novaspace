/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import { RGBA, StyledText, type BoxOptions, type BoxRenderable, type Renderable, type TextOptions, type TextRenderable } from "@opentui/core"
import type { Theme } from "./types"

type Geometry = { x: number; y: number; width: number; height: number; opacity: number }
type PaintLayer = Geometry & (
  | { kind: "box"; style: Pick<BoxOptions, "backgroundColor" | "border" | "borderStyle" | "borderColor" | "customBorderChars" | "shouldFill"> }
  | { kind: "text"; style: Pick<TextOptions, "content" | "fg" | "bg" | "attributes" | "wrapMode" | "truncate"> }
)
export type CardSnapshot = { width: number; height: number; grabX: number; grabY: number; layers: PaintLayer[] }

// Capture the already-mounted card's public paint properties. This preserves
// expanded content, wrapping, and styled spans without mounting another card
// (and starting its fetches/timers again) or moving the original out of its slot.
export function snapshotCard(root: BoxRenderable, x: number, y: number): CardSnapshot {
  const layers: PaintLayer[] = []
  function visit(node: Renderable, inheritedOpacity: number) {
    if (!node.visible || node.isDestroyed || node.width < 1 || node.height < 1) return
    const geometry = {
      x: node.x - root.x, y: node.y - root.y, width: node.width, height: node.height,
      opacity: inheritedOpacity * node.opacity,
    }
    // The live host can use a different OpenTUI module; avoid instanceof checks.
    const text = node as TextRenderable
    if (Array.isArray(text.chunks)) {
      // JSX children live in textNode; .chunks only reflects assigned content.
      const chunks = text.textNode.children.length
        ? text.textNode.gatherWithInheritedStyle({ fg: text.fg, bg: text.bg, attributes: text.attributes })
        : text.chunks
      layers.push({ ...geometry, kind: "text", style: {
        content: new StyledText(chunks.map(({ link: _link, ...chunk }) => ({ ...chunk }))),
        fg: text.fg, bg: text.bg, attributes: text.attributes, wrapMode: text.wrapMode, truncate: text.truncate,
      } })
      return
    }
    const box = node as BoxRenderable
    if (box.backgroundColor !== undefined) layers.push({ ...geometry, kind: "box", style: {
      backgroundColor: box.backgroundColor, shouldFill: box.shouldFill,
      // Setting borderStyle/borderColor enables borders even when border=false.
      ...(box.border ? { border: box.border, borderStyle: box.borderStyle, borderColor: box.borderColor, customBorderChars: box.customBorderChars } : {}),
    } })
    for (const child of node.getChildren().toSorted((a, b) => a.zIndex - b.zIndex)) visit(child, geometry.opacity)
  }
  visit(root, 1)
  return { width: root.width, height: root.height, grabX: x - root.x, grabY: y - root.y, layers }
}

export function FloatingCard(props: { snapshot: CardSnapshot; theme: Theme; left: number; top: number; width: number; height: number }) {
  return (
    <box id="sidebar-drag-preview" position="absolute" left={props.left} top={props.top} width={props.width} height={props.height} zIndex={2}>
      <box position="absolute" left={1} top={1} width="100%" height="100%" backgroundColor={RGBA.fromInts(0, 0, 0, 90)} />
      <box position="absolute" left={0} top={0} width="100%" height="100%" overflow="hidden">
        <For each={props.snapshot.layers}>{(layer) => (
          <Show when={layer.kind === "text"} fallback={
            <box
              position="absolute" left={layer.x} top={layer.y} width={layer.width} height={layer.height} opacity={layer.opacity}
              {...(layer.kind === "box" ? layer.style : {})}
            />
          }>
            <text
              position="absolute" left={layer.x} top={layer.y} width={layer.width} height={layer.height} opacity={layer.opacity}
              style={layer.kind === "text" ? layer.style : {}} selectable={false}
            />
          </Show>
        )}</For>
        <box position="absolute" zIndex={1} left={0} top={0} width="100%" height="100%" border borderStyle="rounded" borderColor={props.theme.text.feedback.info.default} shouldFill={false} />
      </box>
    </box>
  )
}
