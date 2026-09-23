/** @jsxImportSource @opentui/solid */
// Stand-in local custom cards for layout, drag and carousel tests. Built-in
// novaSpace only ships setup and session-info.
import { For } from "solid-js"
import type { CardProps } from "../src/card"
import type { CustomCardID } from "../src/config"
import { registerCustomCard } from "../src/cards/registry"
import { Card, CardTitle, cardHeader } from "../src/ui"

function stub(id: CustomCardID, title: string, lines: string[]) {
  return registerCustomCard({
    id,
    title,
    render: (props: CardProps) => (
      <Card drag={props.drag} theme={props.ctx.theme} strength={props.options.surfaceStrength}>
        <box {...cardHeader}><CardTitle theme={props.ctx.theme} title={title} drag={props.drag} /></box>
        <For each={lines}>{(line) => <text>{line}</text>}</For>
      </Card>
    ),
  })
}

stub("custom:working-set", "Working Set", ["~/DEV", "main · 0 changed", "Open in Zed"])
stub("custom:subagents", "Subagents", ["No subagents yet."])
stub("custom:memory", "Memory", ["42 memories"])
stub("custom:copilot", "Copilot", ["Usage 10%"])
