import { Yoga, type BoxRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"

function isScrollBox(value: Renderable): value is ScrollBoxRenderable {
  // Host renderables come from a separate OpenTUI module: instanceof fails.
  const candidate = value as ScrollBoxRenderable
  if (!candidate.content || !candidate.viewport || !candidate.wrapper || !candidate.verticalScrollBar) return false
  // OpenTUI 0.6 keeps a scrollbox's inner boxes in the native scene, so they
  // no longer expose a parent chain; earlier releases do, and must match.
  if (!candidate.content.parent) return true
  return candidate.content.parent === candidate.viewport
    && candidate.viewport.parent === candidate.wrapper
    && candidate.wrapper.parent === candidate
}

type Length = { unit: number; value: number }
type LayoutReader = { getHeight(): Length; getPadding(edge: number): Length }

// OpenTUI 0.6 (OpenCode 2.1.2) moved layout into the native scene and removed
// getLayoutNode(); the Yoga style getters now live on the renderable itself.
function layout(node: Renderable): LayoutReader {
  const legacy = node as unknown as { getLayoutNode?: () => LayoutReader }
  return typeof legacy.getLayoutNode === "function" ? legacy.getLayoutNode() : node as unknown as LayoutReader
}
function length(value: Length): number | "auto" | `${number}%` {
  if (value.unit === Yoga.UNIT_PERCENT) return `${value.value}%`
  if (value.unit === Yoga.UNIT_POINT) return value.value
  return "auto"
}

function accessor(target: object, key: string): PropertyDescriptor | undefined {
  for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (descriptor) return descriptor
  }
  return undefined
}

// OpenCode paints the sidebar with background.raised.base and repaints it on
// every theme change. Keep the sidebar transparent so the terminal background
// shows between cards, which draw their own surfaces. The host assigns
// backgroundColor as a plain property, so an instance accessor absorbs its
// repaints and remembers the last one for disposal.
function clearSidebarBackground(sidebar: Renderable): () => void {
  const native = accessor(sidebar, "backgroundColor")
  if (!native?.get || !native.set) return () => {}
  let requested: unknown = native.get.call(sidebar)
  Object.defineProperty(sidebar, "backgroundColor", {
    configurable: true,
    get: () => native.get!.call(sidebar),
    set: (value: unknown) => { requested = value },
  })
  native.set.call(sidebar, "transparent")
  return () => {
    delete (sidebar as { backgroundColor?: unknown }).backgroundColor
    if (!sidebar.isDestroyed) native.set!.call(sidebar, requested)
  }
}

// OpenCode 2.0.7 mounts sidebar.content inside an unbounded native scrollbox.
// Bound that wrapper so only our middle scrollbox scrolls. Slot APIs currently
// expose no host layout options; keep this compatibility adjustment isolated,
// check the observed host structure, and restore it on plugin disposal.
export function fitSidebarHost(root: BoxRenderable, compactFooter: boolean, hideTitle = false): () => void {
  // Host renderables are not part of the plugin API. If their shape changes,
  // leave the host alone rather than take the sidebar down.
  try {
    return adaptSidebarHost(root, compactFooter, hideTitle)
  } catch {
    return () => {}
  }
}

function adaptSidebarHost(root: BoxRenderable, compactFooter: boolean, hideTitle: boolean): () => void {
  const slot = root.parent
  let ancestor = slot?.parent
  while (ancestor && !isScrollBox(ancestor)) ancestor = ancestor.parent
  if (!slot || !ancestor || !isScrollBox(ancestor)) return () => {}
  const host = ancestor
  const sidebar = host.parent
  // OpenTUI 0.6 (OpenCode 2.2) reports the scrollbox itself as the parent of
  // its content's children; earlier releases report the content box.
  if (!sidebar || (slot.parent !== host.content && slot.parent !== host)) return () => {}
  const [title, body, footer] = sidebar.getChildren()
  if (body !== host || !title || !footer || sidebar.getChildren().length !== 3) return () => {}

  // Each adjustment applies and restores on its own, so one host change that
  // breaks a single adjustment cannot block the others.
  const restores: (() => void)[] = []
  const adjust = (apply: () => (() => void) | undefined) => {
    try {
      const restore = apply()
      if (restore) restores.push(restore)
    } catch { /* Leave this part of the host as it is. */ }
  }
  // novaSpace draws its own session header, so the host's title row steps aside.
  if (hideTitle) adjust(() => {
    const visible = title.visible
    title.visible = false
    return () => { if (!title.isDestroyed) title.visible = visible }
  })
  adjust(() => {
    const padding = layout(title).getPadding(Yoga.EDGE_BOTTOM).value
    title.paddingBottom = 0
    return () => { if (!title.isDestroyed) title.paddingBottom = padding }
  })
  adjust(() => {
    const height = length(layout(slot).getHeight())
    const padding = layout(slot).getPadding(Yoga.EDGE_RIGHT).value
    slot.height = "100%"
    slot.paddingRight = 0
    return () => {
      if (slot.isDestroyed) return
      slot.height = height
      slot.paddingRight = padding
    }
  })
  adjust(() => {
    const height = length(layout(host.content).getHeight())
    host.content.height = "100%"
    return () => { if (!host.isDestroyed) host.content.height = height }
  })
  adjust(() => {
    host.verticalScrollBar.visible = false
    host.scrollTo(0)
    return () => { if (!host.isDestroyed) host.verticalScrollBar.resetVisibilityControl() }
  })
  if (compactFooter) adjust(() => {
    const footerPadding = layout(footer).getPadding(Yoga.EDGE_TOP).value
    const bottomPadding = layout(sidebar).getPadding(Yoga.EDGE_BOTTOM).value
    footer.paddingTop = 0
    sidebar.paddingBottom = 0
    return () => {
      if (!footer.isDestroyed) footer.paddingTop = footerPadding
      if (!sidebar.isDestroyed) sidebar.paddingBottom = bottomPadding
    }
  })
  adjust(() => clearSidebarBackground(sidebar))

  return () => {
    for (const restore of restores.reverse()) {
      try { restore() } catch { /* The host may already be gone. */ }
    }
  }
}
