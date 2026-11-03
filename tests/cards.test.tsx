import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JSX } from "solid-js"
import { resolveOptions } from "../src/config"
import { parseColor } from "@opentui/core"
import { Card, Empty, identity, Item, Meter, mix, Pill, Stat } from "../src/ui"
import { AccountLine } from "../src/account/line"
import { AccountDialog } from "../src/account/dialog"
import { relativeTime, syncBadge } from "../src/account/status"
import type { UpdateState } from "../src/update"
import { compact, latestContext, SessionHeader, sessionActivity } from "../src/header"
import { pathsIn } from "../src/paths"
import { CardSync } from "../src/sync/engine"
import type { Snapshot } from "../src/sync/files"
import type { SyncRemote } from "../src/sync/remote"
import { stubCards } from "./custom-cards.fixture"
import { context, theme } from "./support"

const temporary: string[] = []
afterAll(async () => { for (const path of temporary) await rm(path, { recursive: true, force: true }) })

async function engine(login = "example") {
  const root = await mkdtemp(join(tmpdir(), "novaspace-ui-")); temporary.push(root)
  const paths = pathsIn(join(root, "novaspace"), join(root, "state"))
  await mkdir(join(paths.cards, "hello"), { recursive: true })
  await writeFile(join(paths.cards, "hello", "index.js"), "export default {}\n")
  let files: Snapshot = {}, revision: string | undefined
  const created: string[] = []
  const remote: SyncRemote = {
    async account() { return login },
    async create(repository) { created.push(repository) },
    async verify() {},
    async read() { return { files: { ...files }, revision } },
    async write(_repository, next) { files = { ...next }; return revision = String(Number(revision ?? 0) + 1) },
  }
  return { sync: new CardSync(paths, remote), paths, created }
}

/** Waits on real time: sync work resolves on the file system, not on render passes. */
async function settle(view: Awaited<ReturnType<typeof testRender>>, predicate: (frame: string) => boolean) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    await view.renderOnce()
    const frame = view.captureCharFrame()
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }
  throw new Error(`Frame did not settle:\n${view.captureCharFrame()}`)
}

const noUpdate = { load: async (): Promise<UpdateState> => ({ status: "unknown" }), check: async (): Promise<UpdateState> => ({ status: "unknown" }) }

function bg(view: Awaited<ReturnType<typeof testRender>>, row: number, column: number) {
  let offset = 0
  for (const span of view.captureSpans().lines[row]!.spans) {
    if (column < offset + span.width) return { bg: span.bg.toInts().slice(0, 3), fg: span.fg.toInts().slice(0, 3), text: span.text }
    offset += span.width
  }
  throw new Error(`no cell at ${row},${column}`)
}

const light = {
  ...theme,
  background: { ...theme.background, raised: { base: "#203040", high: "#304050", max: "#405060" } },
  hue: { green: { "200": "#00aa55", "500": "#008844", "800": "#003322" }, red: { "200": "#ff4444", "500": "#aa3333", "800": "#330000" } },
  categorical: [{ "200": "#ff00ff", "800": "#220022" }, { "200": "#00ffff", "800": "#002222" }],
}
const ints = (color: Parameters<typeof parseColor>[0]) => parseColor(color).toInts().slice(0, 3)

test("cards are flat tiles like the prompt box: a coloured edge, padding rows, a header from props, and a hover lift", async () => {
  const options = resolveOptions({ hoverDuration: 40 })
  const view = await testRender(() => (
    <box width={24}>
      <Card theme={light} title="Hello" icon="◆" meta="3" hoverDuration={options.hoverDuration}>
        <text>Inside</text>
      </Card>
    </box>
  ), { width: 24, height: 5 })
  try {
    await view.renderOnce()
    await view.renderOnce()
    const lines = view.captureCharFrame().split("\n")
    expect(lines[0]).toBe("┃".padEnd(24))
    expect(lines[1]).toMatch(/^┃  ◆ Hello +3  $/)
    expect(lines[2]).toBe("┃  Inside".padEnd(24))
    expect(lines[3]).toBe("┃".padEnd(24))
    // A flat raised surface with square corners, and the edge in the card's own colour.
    for (const row of [0, 1, 3]) expect(bg(view, row, 12).bg).toEqual(ints("#203040"))
    expect(bg(view, 1, 0).fg).toEqual(ints(identity(light, undefined)["200"]))

    await view.mockMouse.moveTo(5, 2)
    await Bun.sleep(70)
    await view.renderOnce()
    expect(bg(view, 1, 12).bg).toEqual(ints("#304050"))
  } finally {
    view.renderer.destroy()
  }
})

test("each card gets a stable colour identity from the theme's categorical hues", () => {
  expect(identity(light, "custom:a")["200"]).toBe(identity(light, "custom:a")["200"])
  const colors = new Set(["custom:a", "custom:b", "custom:c", "custom:d"].map((id) => identity(light, id)["200"]))
  expect(colors.size).toBe(2)
  // Themes without hues fall back to the accent, synthesised from the feedback colour.
  expect(ints(identity(theme, "custom:a")["200"])).toEqual(ints(theme.text.feedback.info.base))
})

test("the kit: pills sit on their surface, items, stats and empty states line up", async () => {
  const view = await testRender(() => (
    <box width={30}>
      <Card theme={light} title="Kit">
        <box flexDirection="row" gap={1}><Pill theme={light} tone="success">ok</Pill><Pill theme={light}>main</Pill></box>
        <Item theme={light} icon="✓" tone="success" title="Review the change" detail="2m" />
        <Stat theme={light} label="Context" value="52k" />
        <Empty theme={light}>Nothing yet.</Empty>
      </Card>
    </box>
  ), { width: 30, height: 9 })
  try {
    await view.renderOnce()
    await view.renderOnce()
    const lines = view.captureCharFrame().split("\n")
    expect(lines[2]).toMatch(/^┃   ok   main  +$/)
    expect(lines[3]).toMatch(/^┃  ✓ Review the change +2m  $/)
    expect(lines[4]).toMatch(/^┃  Context +52k  $/)
    expect(lines[5]).toMatch(/^┃  Nothing yet\. +$/)
    // A toned pill is the hue's soft tint with its strong ink; a neutral one is a raised chip.
    expect(bg(view, 2, 4)).toMatchObject({ fg: ints("#00aa55"), bg: ints("#003322") })
    expect(bg(view, 2, 9).bg).toEqual(ints(mix("#203040", light.text.muted, 0.18)))
    expect(bg(view, 3, 3).fg).toEqual(ints("#00aa55"))
  } finally {
    view.renderer.destroy()
  }
})

test("the meter fills in the card's colour and warns near the limit", async () => {
  const view = await testRender(() => (
    <box flexDirection="column" width={20}>
      <text>Usage</text>
      <Meter theme={light} value={0.25} />
      <Meter theme={light} value={0.95} />
    </box>
  ), { width: 20, height: 3 })
  try {
    await view.renderOnce()
    await view.renderOnce()
    expect(view.captureCharFrame().split("\n")[1]).toBe("━".repeat(20))
    const head = (row: number) => view.captureSpans().lines[row]!.spans.filter((span) => span.text.includes("━"))
    expect(head(1)[0]!.fg.toInts().slice(0, 3)).not.toEqual(head(1).at(-1)!.fg.toInts().slice(0, 3))
    const filled = (row: number) => head(row).slice(0, -1).reduce((sum, span) => sum + span.width, 0)
    expect(filled(1)).toBe(5)
    expect(head(2).at(-2)!.fg.toInts().slice(0, 3)).toEqual(ints("#ff4444"))
  } finally {
    view.renderer.destroy()
  }
})

test("the sync status always pairs a word with its glyph", () => {
  const state = { version: 1 as const, repository: "me/cards", account: "me", automatic: true, base: {}, status: "synced" as const }
  expect(syncBadge(undefined, undefined)).toEqual({ glyph: "○", label: "local", tone: "neutral" })
  expect(syncBadge("me", undefined).label).toBe("set up sync")
  expect(syncBadge("me", state)).toEqual({ glyph: "●", label: "synced", tone: "success" })
  expect(syncBadge("other", state).label).toBe("paused")
  expect(syncBadge("me", { ...state, status: "conflict" }).glyph).toBe("▲")
  const now = Date.UTC(2026, 10, 3, 12)
  expect(relativeTime(now - 10_000, now)).toBe("just now")
  expect(relativeTime(now - 120_000, now)).toBe("2m ago")
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago")
})

test("the account line shows who is signed in and opens the novaSpace dialog", async () => {
  const { sync } = await engine()
  let modal: (() => JSX.Element) | undefined
  let dialog: { size?: string; centered?: boolean } = {}
  const ctx = context()
  ctx.ui.dialog.show = (render) => { dialog = {}; modal = render }
  ctx.ui.dialog.set = (settings) => { dialog = settings }
  const view = await testRender(() => (
    <AccountLine ctx={ctx} engine={sync} loadLogin={async () => "brnbtt"} accountStamp={async () => 1} update={noUpdate} />
  ), { width: 40, height: 1 })
  try {
    const frame = await settle(view, (value) => value.includes("@brnbtt"))
    expect(frame.split("\n")[0]).toMatch(/^ @brnbtt +○ set up sync $/)
    await view.mockMouse.click(6, 0)
    expect(modal).toBeDefined()
    expect(dialog).toEqual({ size: "medium", centered: true })
  } finally {
    view.renderer.destroy()
  }
})

test("the account line follows a GitHub account switch without reopening", async () => {
  const { sync } = await engine()
  const logins = ["before", "after"]
  let lookups = 0
  let stamp = 1
  const view = await testRender(() => (
    <AccountLine ctx={context()} engine={sync} accountPollMs={10}
      accountStamp={async () => stamp} loadLogin={async () => logins[Math.min(lookups++, logins.length - 1)]} />
  ), { width: 40, height: 1 })
  try {
    await settle(view, (value) => value.includes("@before"))
    // Polling a change stamp must not run the account lookup every tick.
    await Bun.sleep(50)
    expect(lookups).toBe(1)
    stamp = 2
    await settle(view, (value) => value.includes("@after"))
    expect(lookups).toBe(2)
  } finally {
    view.renderer.destroy()
  }
})

async function dialogView(props: Partial<Parameters<typeof AccountDialog>[0]> & { sync: CardSync; cardsDirectory: string }) {
  const ctx = context()
  const login = "login" in props ? props.login : "example"
  const view = await testRender(() => <AccountDialog ctx={ctx} update={noUpdate} {...props} login={login} engine={props.sync} />, { width: 64, height: 30 })
  const click = async (id: string) => {
    await settle(view, (value) => !value.includes("Working…"))
    const node = view.renderer.root.findDescendantById(id)
    expect(node).toBeDefined()
    await view.mockMouse.click(node!.x + 1, node!.y)
    await view.flush()
  }
  return { ctx, view, click }
}

test("the dialog lists cards, opens their folder and connects sync in one step", async () => {
  const unstub = stubCards("custom:subagents", "custom:copilot")
  const { sync, paths, created } = await engine()
  const opened: string[] = []
  const { view, click } = await dialogView({ sync, cardsDirectory: paths.cards, open: async (path) => { opened.push(path) } })
  try {
    const frame = await view.waitForFrame((value) => value.includes("Cards") && value.includes("○ set up sync"))
    expect(frame).toContain("Your sidebar cards, on every machine.")
    expect(frame).toContain("Subagents · Copilot")
    expect(frame).toContain("example/novaspace-cards")
    expect(frame).not.toContain("Skills")
    await click("cards-open")
    expect(opened).toEqual([paths.cards])

    await click("sync-create")
    const synced = await settle(view, (value) => value.includes("● synced"))
    expect(created).toEqual(["example/novaspace-cards"])
    expect(synced).toContain("Synced just now · automatic")
    expect(synced).toContain("Sync now")
    expect(synced).toContain("Auto: on")

    await click("sync-automatic")
    await settle(view, (value) => value.includes("Auto: off") && !value.includes("Working"))
    await click("sync-disconnect")
    await settle(view, (value) => value.includes("Create & sync"))
  } finally {
    view.renderer.destroy()
    unstub()
  }
})

test("the dialog explains how to sign in when gh is signed out", async () => {
  const { sync, paths } = await engine()
  const { view } = await dialogView({ sync, cardsDirectory: paths.cards, login: undefined })
  try {
    const frame = await view.waitForFrame((value) => value.includes("gh auth login"))
    expect(frame).toContain("○ local")
    expect(frame).not.toContain("Create & sync")
  } finally {
    view.renderer.destroy()
  }
})

test("offers an update only for a managed package install and settles after applying it", async () => {
  const { sync, paths } = await engine()
  const local = await dialogView({ sync, cardsDirectory: paths.cards, update: {
    load: async () => ({ status: "local", path: "/plugins/novaspace" }),
    check: async () => ({ status: "local", path: "/plugins/novaspace" }),
  } })
  try {
    const frame = await local.view.waitForFrame((value) => value.includes("Local checkout"))
    // A checkout has no version to compare, so offering an update would lie.
    expect(frame).not.toContain("Update →")
  } finally {
    local.view.renderer.destroy()
  }

  const applied: string[] = []
  let resolveApply!: (value: UpdateState) => void
  const managed = await dialogView({ sync, cardsDirectory: paths.cards, update: {
    load: async () => ({ status: "current", target: "opencode-novaspace", version: "0.5.0" }),
    check: async () => ({ status: "outdated", target: "opencode-novaspace", version: "0.5.0" }),
    apply: async (_ctx, target) => { applied.push(target); return new Promise<UpdateState>((resolve) => { resolveApply = resolve }) },
  } })
  const toasts: string[] = []
  managed.ctx.ui.toast.show = (toast) => { toasts.push(toast.message) }
  try {
    await managed.view.waitForFrame((value) => value.includes("v0.5.0"))
    await managed.view.waitForFrame((value) => value.includes("Update →"))
    await managed.click("update-apply")
    await managed.view.waitForFrame((value) => value.includes("Updating…"))
    expect(applied).toEqual(["opencode-novaspace"])
    // The host can still report `updating` right after a successful update,
    // so the row settles on the result instead of reading that back.
    resolveApply({ status: "updated", target: "opencode-novaspace", version: "0.5.0" })
    const done = await managed.view.waitForFrame((value) => value.includes("restart to load"))
    expect(done).not.toContain("Update →")
    expect(done).not.toContain("Updating…")
    expect(toasts.some((message) => message.includes("Restart OpenCode"))).toBe(true)
  } finally {
    managed.view.renderer.destroy()
  }
})

test("the session header shows the title, what the session is doing, its context, cost and branch", async () => {
  const messages = [
    { id: "before", type: "assistant", tokens: { input: 800_000 } },
    { id: "compact", type: "compaction", status: "completed" },
    { id: "after", type: "assistant", model: { id: "gpt-5.6-sol", providerID: "github-copilot" }, tokens: { input: 1_000, output: 1_000, cache: { read: 50_000, write: 500 } } },
  ]
  expect(latestContext(messages)?.tokens).toBe(52_500)
  expect(latestContext(messages.slice(0, 2))).toBeUndefined()
  expect(latestContext(messages, "after")).toBeUndefined()
  expect(latestContext(messages, "missing")).toBeUndefined()
  expect(latestContext(messages, "compact")?.tokens).toBe(800_000)
  expect([compact(950), compact(52_500), compact(1_050_000), compact(12_000_000)]).toEqual(["950", "53k", "1.05M", "12M"])

  const ctx = context()
  const session = ctx.data.session.get("session")! as { title?: string }
  session.title = "Add --days flag"
  ctx.data.session.message = { list: () => messages }
  ctx.data.session.cost = () => 3.42
  ctx.data.location.vcs = { info: () => ({ branch: { current: "main" } }) }
  let status = "busy"
  let pending: unknown[] = []
  ctx.data.session.status = () => status
  ctx.data.session.permission = { list: () => pending }
  expect(sessionActivity(ctx, "session")).toEqual({ label: "working", tone: "accent", busy: true })
  pending = [{}]
  expect(sessionActivity(ctx, "session").label).toBe("needs you")
  pending = []
  status = "idle"
  expect(sessionActivity(ctx, "session")).toEqual({ label: "idle", tone: "neutral", busy: false })

  const view = await testRender(() => <SessionHeader ctx={ctx} sessionID="session" />, { width: 40, height: 12 })
  try {
    // The meter and tile caps measure their width after the first layout.
    const frame = await settle(view, (value) => /━{28}/.test(value) && value.includes("┃"))
    const lines = frame.split("\n")
    // One fact per row, so nothing that matters shares a row with a chip.
    expect(lines[1]).toMatch(/^┃  Add --days flag +$/)
    expect(lines[3]).toMatch(/^┃   ● idle  +\$3\.42  $/)
    expect(lines[4]).toMatch(/^┃  gpt-5\.6-sol · high +$/)
    expect(lines[6]).toMatch(/^┃  ━+ 5%  $/)
    expect(lines[7]).toMatch(/^┃  53k of 1\.05M tokens +$/)
    expect(lines[8]).toMatch(/^┃  DEV +main   $/)
  } finally { view.renderer.destroy() }
})
