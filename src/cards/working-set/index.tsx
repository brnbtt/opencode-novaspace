/** @jsxImportSource @opentui/solid */
import { basename } from "node:path"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createRefreshQueue } from "../../services/refresh"
import type { Location } from "../../types"
import { Card, CardAction, CardTitle, cardHeader, metricRow } from "../../ui"
import { defineCard, type CardProps } from "../../card"

type GitState = { directory: string; branch?: string; changed: number }

function compact(value: string, width: number) {
  if (value.length <= width) return value
  const left = Math.ceil((width - 1) / 2)
  return `${value.slice(0, left)}…${value.slice(-(width - left - 1))}`
}

export function WorkingSetCard(props: CardProps) {
  const [hovered, setHovered] = createSignal(false)
  const [state, setState] = createSignal<GitState>()
  const [unavailable, setUnavailable] = createSignal(false)
  const session = createMemo(() => props.ctx.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location ?? props.ctx.data.location.default(), undefined, {
    equals: (a, b) => a.directory === b.directory && a.workspaceID === b.workspaceID,
  })
  const queue = createRefreshQueue(
    async (current: Location, signal) => {
      const [info, status] = await Promise.all([
        props.ctx.client.vcs.get({ location: current }, { signal }),
        props.ctx.client.vcs.status({ location: current }, { signal }),
      ])
      return {
        directory: info.location.project.directory,
        branch: info.data.branch.current,
        changed: status.data.length,
      }
    },
    (result) => { setState(result); setUnavailable(false) },
    () => { setState(); setUnavailable(true) },
  )
  const execution = createMemo(() => props.ctx.data.session.status(props.sessionID)?.type)
  let previousLocation: Location | undefined
  createEffect(() => {
    execution()
    const current = location()
    if (current !== previousLocation) {
      setState()
      setUnavailable(false)
      previousLocation = current
    }
    queue.request(current)
  })
  const timer = setInterval(() => queue.request(location()), 30_000)
  onCleanup(() => { clearInterval(timer); queue.dispose() })

  const open = async () => {
    const directory = state()?.directory ?? location().directory
    try {
      const child = Bun.spawn(["zed", "--existing", directory], { stdout: "ignore", stderr: "ignore" })
      const code = await child.exited
      if (code !== 0) throw new Error(`Zed exited with code ${code}`)
      props.ctx.ui.toast.show({ message: `Opened ${basename(directory)} in Zed`, variant: "success" })
    } catch (error) {
      props.ctx.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" })
    }
  }

  return (
    <Card drag={props.drag} theme={props.ctx.theme} strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength} hoverStrength={props.options.hoverStrength} hoverDuration={props.options.hoverDuration}>
      <box {...cardHeader}>
        <CardTitle theme={props.ctx.theme} title="Working Set" drag={props.drag} />
        <CardAction
          theme={props.ctx.theme}
          label="Open in Zed ↗"
          disabled={props.dragging}
          hovered={hovered()}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onPress={() => void open()}
        />
      </box>
      <text fg={props.ctx.theme.text.feedback.info.base} wrapMode="word">
        <b>{`◆ ${props.ctx.ui.format?.path(location().directory) ?? location().directory.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")}`}</b>
      </text>
      {state()?.branch || state()?.changed !== undefined ? (
        <box {...metricRow}>
          <text fg={props.ctx.theme.text.muted}>{compact(state()?.branch ?? "Working tree", 24)}</text>
          <text flexShrink={0} fg={(state()?.changed ?? 0) > 0 ? props.ctx.theme.text.feedback.warning.base : props.ctx.theme.text.feedback.success.base}>
            {(state()?.changed ?? 0) > 0 ? `${state()!.changed} changed` : "Clean"}
          </text>
        </box>
      ) : null}
      {unavailable() ? <text fg={props.ctx.theme.text.muted}>Git status unavailable</text> : null}
      <text fg={props.ctx.theme.text.muted} wrapMode="word">
        {session()?.model ? `${session()!.model!.id}${session()!.model!.variant ? ` · ${session()!.model!.variant}` : ""}` : "Model pending"}
      </text>
    </Card>
  )
}

export const workingSet = defineCard({
  id: "working-set",
  title: "Working Set",
  render: (props) => <WorkingSetCard {...props} />,
})
