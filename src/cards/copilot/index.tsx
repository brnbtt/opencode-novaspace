import { createMemo, createSignal, onCleanup } from "solid-js"
import { createUsageStore, REFRESH_MS } from "./store"
import { fetchQuota, progress, resetLabel, sessionCredits } from "./usage"
import { Card, CardAction, CardTitle, cardHeader, metricRow } from "../../ui"
import { defineCard, type CardProps } from "../../card"

const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 })
const short = (value: number) => value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })

export function CopilotCard(props: CardProps) {
  const store = createUsageStore(fetchQuota)
  const [state, setState] = createSignal<{ loading: boolean; quota?: Awaited<ReturnType<typeof fetchQuota>>; error?: string }>({ loading: false })
  const [expanded, setExpanded] = createSignal(false)
  const [hoverRefresh, setHoverRefresh] = createSignal(false)
  const [hoverToggle, setHoverToggle] = createSignal(false)
  const unsubscribe = store.subscribe(setState)
  const session = createMemo(() => sessionCredits(props.sessionID, props.ctx.data.session.list()))
  const quota = createMemo(() => state().quota)
  const meter = createMemo(() => progress(quota()?.used ?? 0, quota()?.limit ?? null))
  const color = () => meter().percent >= 90
    ? props.ctx.theme.text.feedback.error.default
    : meter().percent >= 75 ? props.ctx.theme.text.feedback.warning.default : props.ctx.theme.text.feedback.info.default
  void store.refresh()
  const timer = setInterval(() => void store.refresh(), REFRESH_MS)
  onCleanup(() => { unsubscribe(); clearInterval(timer); store.dispose() })

  return (
    <Card drag={props.drag} theme={props.ctx.theme} strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength} hoverStrength={props.options.hoverStrength} hoverDuration={props.options.hoverDuration}>
      <box {...cardHeader}>
        <CardTitle theme={props.ctx.theme} title="GitHub Copilot" drag={props.drag} />
        <CardAction
          theme={props.ctx.theme}
          label={state().loading ? "Syncing…" : "Refresh ↻"}
          hovered={hoverRefresh()}
          disabled={state().loading || props.dragging}
          onMouseOver={() => setHoverRefresh(true)}
          onMouseOut={() => setHoverRefresh(false)}
          onPress={() => void store.refresh(true)}
        />
      </box>
      <box {...metricRow}>
        <text fg={props.ctx.theme.text.subdued}>Session (est.)</text>
        <text fg={props.ctx.theme.text.default}>{session().available ? `≈ ${format(session().credits)} credits` : "—"}</text>
      </box>
      <box {...metricRow}>
        <text fg={props.ctx.theme.text.subdued}>Period</text>
        <text fg={color()}>{quota()
          ? `${format(quota()!.used)} / ${quota()!.limit === null ? "∞" : short(quota()!.limit!)} · ${meter().percent.toFixed(1)}%`
          : state().loading ? "Loading…" : "Unavailable"}</text>
      </box>
      {expanded() && quota() ? (
        <box flexDirection="column">
          <text fg={props.ctx.theme.text.subdued}>Estimated from OpenCode cost; includes descendant workers.</text>
          <text fg={props.ctx.theme.text.subdued}>{resetLabel(quota()!.resetAt)}</text>
          <text fg={props.ctx.theme.text.subdued}>{quota()!.login}</text>
        </box>
      ) : null}
      {state().error ? <text fg={props.ctx.theme.text.feedback.warning.default}>{state().error}</text> : null}
      <CardAction
        theme={props.ctx.theme}
        label={expanded() ? "▴ Fewer details" : "▸ More details"}
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

export const copilot = defineCard({
  id: "copilot",
  title: "GitHub Copilot",
  render: (props) => <CopilotCard {...props} />,
})
