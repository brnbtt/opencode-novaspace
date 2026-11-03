/** @jsxImportSource @opentui/solid */
// Stand-in custom cards for layout, drag and carousel tests. Loaded custom
// cards join the sidebar automatically, so each test registers only the ones
// it uses and removes them afterwards.
import { For } from "solid-js"
import type { CardProps } from "../src/card"
import type { CustomCardID } from "../src/config"
import { registerCustomCard } from "../src/cards/registry"
import { Card, CardTitle, cardHeader } from "../src/ui"

const stubs: Record<string, { title: string; lines: string[] }> = {
  "custom:working-set": { title: "Working Set", lines: ["~/DEV", "main · 0 changed", "Open in Zed"] },
  "custom:subagents": { title: "Subagents", lines: ["No subagents yet."] },
  "custom:memory": { title: "Memory", lines: ["42 memories"] },
  "custom:copilot": { title: "Copilot", lines: ["Usage 10%"] },
}

export function stubCards(...ids: CustomCardID[]) {
  const stops = ids.map((id) => {
    const { title, lines } = stubs[id]!
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
  })
  return () => { for (const stop of stops) stop() }
}
