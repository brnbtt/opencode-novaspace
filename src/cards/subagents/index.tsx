/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import type { Session } from "../../types"
import { Card, CardTitle, cardHeader } from "../../ui"
import { defineCard, type CardProps } from "../../card"

const terminal = new Set(["succeeded", "completed", "failed", "error", "interrupted"])
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function isActive(status: string) {
  return status !== "idle" && !terminal.has(status)
}

function sessionStatus(props: CardProps, session: Session) {
  const status = props.ctx.data.session.status(session.id)?.type
  if (status && status !== "idle") return status
  if (session.outcome) return session.outcome
  return status ?? "idle"
}

function rank(status: string) {
  if (isActive(status)) return 0
  if (status === "failed" || status === "error") return 1
  if (status === "idle") return 2
  if (status === "interrupted") return 3
  return 4
}

function icon(status: string, tick: number) {
  if (isActive(status)) return spinner[tick % spinner.length]
  if (status === "failed" || status === "error") return "×"
  if (status === "interrupted") return "■"
  if (status === "succeeded" || status === "completed") return "✓"
  return "○"
}

function elapsed(session: Session, status: string) {
  if (!session.time?.created) return ""
  const ended = terminal.has(status) ? (session.time.idle ?? session.time.updated ?? Date.now()) : Date.now()
  const seconds = Math.max(0, Math.floor((ended - session.time.created) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function SubagentsCard(props: CardProps) {
  const [hovered, setHovered] = createSignal<string>()
  const [tick, setTick] = createSignal(0)
  const agents = createMemo(() => {
    const root = props.ctx.data.session.root(props.sessionID) ?? props.sessionID
    const ids = new Set(props.ctx.data.session.family(root) ?? [root])
    return props.ctx.data.session.list()
      .filter((session) => session.id !== root && ids.has(session.id))
      .toSorted((a, b) => rank(sessionStatus(props, a)) - rank(sessionStatus(props, b)) || (a.time?.created ?? 0) - (b.time?.created ?? 0))
  })
  const statuses = createMemo(() => agents().map((agent) => sessionStatus(props, agent)))
  const running = createMemo(() => statuses().filter(isActive).length)
  const idle = createMemo(() => statuses().filter((status) => status === "idle").length)
  const done = createMemo(() => statuses().filter((status) => status === "succeeded" || status === "completed").length)
  const failed = createMemo(() => statuses().filter((status) => status === "failed" || status === "error").length)
  createEffect(() => {
    if (!running()) return
    const timer = setInterval(() => setTick((value) => value + 1), 160)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Card drag={props.drag} theme={props.ctx.theme} strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength} hoverStrength={props.options.hoverStrength} hoverDuration={props.options.hoverDuration}>
      <box {...cardHeader}>
        <CardTitle theme={props.ctx.theme} title="Subagents" drag={props.drag} />
        {agents().length ? (
          <text fg={props.ctx.theme.text.muted}>{`● ${running()}  ○ ${idle()}  ✓ ${done()}  × ${failed()}`}</text>
        ) : null}
      </box>
      {agents().length === 0 ? <text fg={props.ctx.theme.text.muted}>No subagents yet.</text> : (
        <box flexDirection="column" gap={1}>
          <For each={agents().slice(0, 4)}>{(agent) => {
            const status = () => sessionStatus(props, agent)
            const active = () => hovered() === agent.id
            const color = () => isActive(status())
              ? props.ctx.theme.text.feedback.info.base
              : status() === "failed" || status() === "error"
                ? props.ctx.theme.text.feedback.error.base
                : status() === "succeeded" || status() === "completed"
                  ? props.ctx.theme.text.feedback.success.base
                  : props.ctx.theme.text.muted
            return (
              <box
                flexDirection="column"
                backgroundColor={active() ? props.ctx.theme.background.action.primary.hovered : undefined}
                onMouseOver={() => setHovered(agent.id)}
                onMouseOut={() => setHovered()}
                  onMouseUp={(event) => { if (!props.dragging && !event.isDragging && event.button === 0) props.ctx.ui.router.navigate({ type: "session", sessionID: agent.id }) }}
              >
                <text fg={color()} wrapMode="word"><b>{`${icon(status(), tick())} ${agent.title ?? agent.id}`}</b></text>
                <text fg={props.ctx.theme.text.muted}>{`${status()} · ${elapsed(agent, status())} · ${agent.agent ?? "general"}`}</text>
              </box>
            )
          }}</For>
          {agents().length > 4 ? <text fg={props.ctx.theme.text.muted}>{`+ ${agents().length - 4} more`}</text> : null}
        </box>
      )}
    </Card>
  )
}

export const subagents = defineCard({
  id: "subagents",
  title: "Subagents",
  render: (props) => <SubagentsCard {...props} />,
})
