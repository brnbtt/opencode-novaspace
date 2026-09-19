import { createMemo } from "solid-js"
import { Card, CardTitle, cardHeader, metricRow } from "../../ui"
import type { SessionMessage } from "../../types"
import { defineCard, type CardProps } from "../../card"

// Match the native sidebar: latest assistant usage after the last compaction,
// before any revert boundary. Session cumulative tokens are not context usage.
export function latestContext(messages: readonly SessionMessage[], revert?: string) {
  const end = revert ? messages.findIndex((message) => message.id === revert) : messages.length
  if (end < 0) return
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "compaction" && message.status === "completed") return
    if (message.type !== "assistant" || !message.tokens) continue
    const usage = message.tokens
    const tokens = (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
      + (usage.cache?.read ?? 0) + (usage.cache?.write ?? 0)
    return tokens > 0 ? { tokens, model: message.model } : undefined
  }
}

export function SessionInfoCard(props: CardProps) {
  const session = createMemo(() => props.ctx.data.session.get(props.sessionID))
  const location = () => session()?.location ?? props.ctx.data.location.default()
  const context = createMemo(() => latestContext(props.ctx.data.session.message?.list(props.sessionID) ?? [], session()?.revert?.messageID))
  const percent = createMemo(() => {
    const usage = context()
    const model = props.ctx.data.location.model?.list(location())?.find((model) => model.id === usage?.model?.id && model.providerID === usage?.model?.providerID)
    return usage && model?.limit?.context ? Math.round(usage.tokens / model.limit.context * 100) : undefined
  })
  const cost = () => props.ctx.data.session.cost?.(props.sessionID) ?? session()?.cost ?? 0
  const path = () => props.ctx.ui.format?.path(location().directory) ?? location().directory
  const branch = () => props.ctx.data.location.vcs?.info(location())?.branch.current
  return (
    <Card drag={props.drag} theme={props.ctx.theme} strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength} hoverStrength={props.options.hoverStrength} hoverDuration={props.options.hoverDuration}>
      <box {...cardHeader}><CardTitle theme={props.ctx.theme} title="Session info" drag={props.drag} /></box>
      <box {...metricRow}>
        <text fg={props.ctx.theme.text.subdued}>Context</text>
        <text fg={props.ctx.theme.text.default}>{context() ? `${context()!.tokens.toLocaleString()}${percent() === undefined ? " tokens" : ` · ${percent()}%`}` : "—"}</text>
      </box>
      <box {...metricRow}>
        <text fg={props.ctx.theme.text.subdued}>Spent</text>
        <text fg={props.ctx.theme.text.default}>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cost())}</text>
      </box>
      <text fg={props.ctx.theme.text.subdued} wrapMode="none" truncate>{`${path()}${branch() ? `:${branch()}` : ""}`}</text>
    </Card>
  )
}

export const sessionInfo = defineCard({
  id: "session-info",
  title: "Session info",
  render: (props) => <SessionInfoCard {...props} />,
})
