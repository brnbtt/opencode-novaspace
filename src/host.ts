import { Yoga, type BoxRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"

function isScrollBox(value: Renderable): value is ScrollBoxRenderable {
  // Host renderables come from a separate OpenTUI module: instanceof fails.
  const candidate = value as ScrollBoxRenderable
  return !!candidate.content && !!candidate.viewport && !!candidate.wrapper && !!candidate.verticalScrollBar
    && candidate.content.parent === candidate.viewport
    && candidate.viewport.parent === candidate.wrapper
    && candidate.wrapper.parent === candidate
}

type Length = { unit: number; value: number }
function length(value: Length): number | "auto" | `${number}%` {
  if (value.unit === Yoga.UNIT_PERCENT) return `${value.value}%`
  if (value.unit === Yoga.UNIT_POINT) return value.value
  return "auto"
}

// OpenCode 2.0.7 mounts sidebar.content inside an unbounded native scrollbox.
// Bound that wrapper so only our middle scrollbox scrolls. Slot APIs currently
// expose no host layout options; keep this compatibility adjustment isolated,
// check the observed host structure, and restore it on plugin disposal.
export function fitSidebarHost(root: BoxRenderable, compactFooter: boolean): () => void {
  const slot = root.parent
  let ancestor = slot?.parent
  while (ancestor && !isScrollBox(ancestor)) ancestor = ancestor.parent
  if (!slot || !ancestor || !isScrollBox(ancestor)) return () => {}
  const host = ancestor
  const sidebar = host.parent
  if (!sidebar || slot.parent !== host.content) return () => {}
  const [title, body, footer] = sidebar.getChildren()
  if (body !== host || !title || !footer || sidebar.getChildren().length !== 3) return () => {}

  const previous = {
    contentHeight: length(host.content.getLayoutNode().getHeight()),
    slotHeight: length(slot.getLayoutNode().getHeight()),
    slotPadding: slot.getLayoutNode().getPadding(Yoga.EDGE_RIGHT).value,
    titlePadding: title.getLayoutNode().getPadding(Yoga.EDGE_BOTTOM).value,
    footerPadding: footer.getLayoutNode().getPadding(Yoga.EDGE_TOP).value,
    bottomPadding: sidebar.getLayoutNode().getPadding(Yoga.EDGE_BOTTOM).value,
  }
  host.content.height = "100%"
  slot.height = "100%"
  slot.paddingRight = 0
  title.paddingBottom = 0
  if (compactFooter) {
    footer.paddingTop = 0
    sidebar.paddingBottom = 0
  }
  host.verticalScrollBar.visible = false
  host.scrollTo(0)

  return () => {
    if (!host.isDestroyed) {
      host.content.height = previous.contentHeight
      host.verticalScrollBar.resetVisibilityControl()
    }
    if (!slot.isDestroyed) {
      slot.height = previous.slotHeight
      slot.paddingRight = previous.slotPadding
    }
    if (!title.isDestroyed) title.paddingBottom = previous.titlePadding
    if (compactFooter && !footer.isDestroyed) footer.paddingTop = previous.footerPadding
    if (compactFooter && !sidebar.isDestroyed) sidebar.paddingBottom = previous.bottomPadding
  }
}
