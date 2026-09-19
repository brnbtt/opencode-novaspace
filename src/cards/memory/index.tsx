import { basename } from "node:path"
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import { compactBytes } from "./format"
import { createMemoBackend } from "./backend"
import { createMemoryStore, REFRESH_MS, type MemoryStore } from "./store"
import type { MemoryContext, MemoryEntry } from "./types"
import { Card, CardAction, CardTitle, cardHeader, metricRow } from "../../ui"
import { defineCard, type CardProps } from "../../card"

function entryText(entry: MemoryEntry) {
  const prefix = entry.scope ? `[${entry.scope}] ` : ""
  return prefix && entry.text.startsWith(prefix) ? entry.text.slice(prefix.length) : entry.text
}

function shortDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return year && month && day
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day))
    : date
}

export function MemoryCard(props: CardProps & { store?: MemoryStore; loadContext?: (scope: string) => Promise<MemoryContext> }) {
  const store = props.store ?? createMemoryStore()
  const backend = createMemoBackend()
  const [state, setState] = createSignal<{ loading: boolean; status?: Awaited<ReturnType<typeof backend.status>>; error?: string }>({ loading: false })
  const [expanded, setExpanded] = createSignal(false)
  const [hoverRefresh, setHoverRefresh] = createSignal(false)
  const [hoverToggle, setHoverToggle] = createSignal(false)
  const [context, setContext] = createSignal<MemoryContext>()
  const [contextLoading, setContextLoading] = createSignal(false)
  const session = createMemo(() => props.ctx.data.session.get(props.sessionID))
  const scope = createMemo(() => basename(session()?.location.directory ?? "global"))
  const status = createMemo(() => state().status)
  const active = createMemo(() => status() ? status()!.memories - status()!.superseded - status()!.redacted : 0)
  const ready = createMemo(() => !state().error && (status()?.pending ?? 0) === 0)
  const visible = createMemo(() => context()?.entries.slice(-4) ?? [])
  const unsubscribe = store.subscribe(setState)

  let request = 0
  const refreshContext = async () => {
    const current = ++request
    setContextLoading(true)
    try {
      const value = await (props.loadContext ?? ((name: string) => backend.context(name)))(scope())
      if (current === request) setContext(value)
    } finally {
      if (current === request) setContextLoading(false)
    }
  }
  createEffect(() => { if (expanded()) { scope(); void refreshContext() } })
  void store.refresh()
  const timer = setInterval(() => void store.refresh(), REFRESH_MS)
  onCleanup(() => {
    unsubscribe()
    clearInterval(timer)
    if (!props.store) store.dispose()
  })

  return (
    <Card drag={props.drag} theme={props.ctx.theme} strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength} hoverStrength={props.options.hoverStrength} hoverDuration={props.options.hoverDuration}>
      <box {...cardHeader}>
        <CardTitle theme={props.ctx.theme} title="Memory" drag={props.drag} />
        <CardAction
          theme={props.ctx.theme}
          label={state().loading ? "Syncing…" : "Refresh ↻"}
          hovered={hoverRefresh()}
          disabled={state().loading || props.dragging}
          onMouseOver={() => setHoverRefresh(true)}
          onMouseOut={() => setHoverRefresh(false)}
          onPress={() => { void store.refresh(true); if (expanded()) void refreshContext() }}
        />
      </box>
      {status() ? (
        <box flexDirection="column">
          <box {...metricRow}>
            <text fg={props.ctx.theme.text.subdued}>{`${active()} memories`}</text>
            <box flexDirection="row" gap={1}>
              <text fg={ready() ? props.ctx.theme.text.feedback.success.default : props.ctx.theme.text.feedback.warning.default}>•</text>
              <text fg={props.ctx.theme.text.default}>{ready() ? "Ready" : "Maintenance needed"}</text>
            </box>
          </box>
          <box {...metricRow}>
            <text fg={props.ctx.theme.text.subdued}>Startup view</text>
            <text fg={props.ctx.theme.text.default}>{compactBytes(status()!.wake.bytes)}</text>
          </box>
          {expanded() ? (
            <box flexDirection="column" gap={1} marginTop={1}>
              <box {...cardHeader}>
                <text fg={props.ctx.theme.text.default}><b>Remembered here</b></text>
                <text fg={props.ctx.theme.text.subdued}>{scope()}</text>
              </box>
              {contextLoading() && !context() ? <text fg={props.ctx.theme.text.subdued}>Loading context…</text> : (
                <For each={visible()}>{(entry) => (
                  <box flexDirection="column">
                    <text fg={props.ctx.theme.text.feedback.info.default}><b>{`${entry.scope?.toLowerCase() === "global" ? "GLOBAL" : "THIS PROJECT"} · ${shortDate(entry.date)} · #${entry.id}`}</b></text>
                    <text fg={props.ctx.theme.text.default} wrapMode="word">{entryText(entry)}</text>
                  </box>
                )}</For>
              )}
              <text fg={props.ctx.theme.text.subdued}>{status()!.legacyUnscoped ? `${status()!.legacyUnscoped} older unscoped entries` : "All memories are scoped"}</text>
            </box>
          ) : null}
        </box>
      ) : <text fg={props.ctx.theme.text.subdued}>{state().loading ? "Loading memory…" : "Memory unavailable"}</text>}
      <CardAction
        theme={props.ctx.theme}
        label={expanded() ? "▴ Hide memories" : "▸ View memories"}
        disabled={props.dragging}
        hovered={hoverToggle()}
        subtle
        onMouseOver={() => setHoverToggle(true)}
        onMouseOut={() => setHoverToggle(false)}
        onPress={() => setExpanded((value) => !value)}
      />
    </Card>
  )
}

export const memory = defineCard({
  id: "memory",
  title: "Memory",
  render: (props) => <MemoryCard {...props} />,
})
