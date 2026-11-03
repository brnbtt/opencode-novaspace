/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { SessionMessage, TuiContext } from "./types"
import { Meter, Pill, raised, scale, Tile, type Tone } from "./ui"

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

export function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, "")}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const working = new Set(["busy", "working", "running", "streaming", "retry", "pending"])

export type SessionActivity = { label: string; tone: Tone; busy: boolean }

export function sessionActivity(ctx: TuiContext, sessionID: string): SessionActivity {
  if ((ctx.data.session.permission?.list(sessionID)?.length ?? 0) > 0) return { label: "needs you", tone: "warning", busy: false }
  const raw = ctx.data.session.status(sessionID)
  const status = typeof raw === "string" ? raw : raw?.type
  if (status === "error") return { label: "error", tone: "error", busy: false }
  if (status && working.has(status)) return { label: "working", tone: "accent", busy: true }
  return { label: "idle", tone: "neutral", busy: false }
}

/**
 * The top of the sidebar: the session's title, what it's doing, the model,
 * how full its context is, what it has cost, and where it runs. It replaces
 * OpenCode's own title row (see host.ts).
 */
export function SessionHeader(props: { ctx: TuiContext; sessionID: string }) {
  const theme = () => props.ctx.theme
  const session = createMemo(() => props.ctx.data.session.get(props.sessionID))
  const location = () => session()?.location ?? props.ctx.data.location.default()
  const context = createMemo(() => latestContext(props.ctx.data.session.message?.list(props.sessionID) ?? [], session()?.revert?.messageID))
  const limit = createMemo(() => {
    const usage = context()
    const model = props.ctx.data.location.model?.list(location())?.find((model) => model.id === usage?.model?.id && model.providerID === usage?.model?.providerID)
    return model?.limit?.context
  })
  const usage = () => context() && limit() ? context()!.tokens / limit()! : undefined
  const cost = () => props.ctx.data.session.cost?.(props.sessionID) ?? session()?.cost ?? 0
  const path = () => props.ctx.ui.format?.path(location().directory) ?? location().directory
  const branch = () => props.ctx.data.location.vcs?.info(location())?.branch.current
  const model = () => {
    const value = session()?.model ?? context()?.model
    if (!value) return undefined
    return [value.id, value.variant].filter(Boolean).join(" · ")
  }
  const activity = createMemo(() => sessionActivity(props.ctx, props.sessionID))
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (!activity().busy) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % spinner.length), 80)
    onCleanup(() => clearInterval(timer))
  })
  // One step above the cards' surface, so the header leads in any theme; the
  // accent lives only on its edge.
  const fill = () => raised(theme(), "high")
  const money = () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cost())

  // The folder name is enough here; the full path belongs to a workspace card.
  const folder = () => path().replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path()

  return (
    <box id="session-header" flexShrink={0}>
      <Tile theme={theme()} fill={fill} edge={() => scale(theme(), "accent")["200"]}>
        <text id="session-title" fg={theme().text.base} wrapMode="word" maxHeight={2}><b>{session()?.title || "New session"}</b></text>
        <box flexDirection="row" justifyContent="space-between" gap={1} height={1} marginTop={1}>
          <Pill theme={theme()} tone={activity().tone}>{`${activity().busy ? spinner[frame()] : activity().tone === "warning" ? "▲" : "●"} ${activity().label}`}</Pill>
          <text flexShrink={0} fg={theme().text.base}>{money()}</text>
        </box>
        <Show when={model()}><text height={1} wrapMode="none" truncate fg={theme().text.muted}>{model()}</text></Show>
        <box flexDirection="column" marginTop={1}>
          <Show when={usage() !== undefined}>
            <box flexDirection="row" gap={1} height={1}>
              <box flexGrow={1} minWidth={0}><Meter theme={theme()} value={usage()!} /></box>
              <text flexShrink={0} fg={theme().text.base}>{`${Math.round(usage()! * 100)}%`}</text>
            </box>
          </Show>
          <text height={1} wrapMode="none" truncate fg={theme().text.muted}>{context()
            ? `${compact(context()!.tokens)}${limit() ? ` of ${compact(limit()!)}` : ""} tokens`
            : "No context yet"}</text>
          <box flexDirection="row" justifyContent="space-between" gap={1} height={1}>
            <text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme().text.muted}>{folder()}</text>
            <Show when={branch()}><Pill theme={theme()}>{branch()!}</Pill></Show>
          </box>
        </box>
      </Tile>
    </box>
  )
}
