import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JSX } from "solid-js"
import { parseColor } from "@opentui/core"
import { resolveOptions } from "../src/config"
import { Card, cardBorder, cardSurface, Meter } from "../src/ui"
import { AccountCard } from "../src/cards/account/index"
import { AccountDialog } from "../src/cards/account/dialog"
import { relativeTime, summary, syncBadge } from "../src/cards/account/status"
import type { UpdateState } from "../src/update"
import { latestContext, SessionInfoCard } from "../src/cards/session-info/index"
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

test("cards are an elevated surface with a single left edge that lights up on hover", async () => {
  const options = resolveOptions({ hoverDuration: 40, hoverStrength: 0.1 })
  const view = await testRender(() => (
    <Card theme={theme} strength={options.surfaceStrength} hoverStrength={options.hoverStrength} hoverDuration={options.hoverDuration} onPress={() => {}}>
      <text>Inside</text>
    </Card>
  ), { width: 20, height: 5 })
  try {
    await view.waitForFrame((frame) => frame.includes("Inside") && frame.includes("▎"))
    const surface = cardSurface(theme, options.surfaceStrength).toInts().slice(0, 3)
    const lines = view.captureCharFrame().split("\n")
    expect(lines.slice(0, 3)).toEqual(["▎".padEnd(20), "▎ Inside".padEnd(20), "▎".padEnd(20)])
    // The fill reaches every edge: no box border, no gap around the content.
    for (const [row, column] of [[0, 0], [0, 19], [1, 2], [2, 10], [2, 19]] as const) expect(bg(view, row, column).bg).toEqual(surface)
    expect(bg(view, 1, 0).fg).toEqual(parseColor(cardBorder(theme)).toInts().slice(0, 3))

    await view.mockMouse.moveTo(4, 1)
    await Bun.sleep(70)
    await view.flush()
    expect(bg(view, 1, 4).bg).toEqual(cardSurface(theme, options.surfaceStrength + options.hoverStrength).toInts().slice(0, 3))
    expect(bg(view, 1, 0).fg).toEqual([0, 170, 255])
  } finally {
    view.renderer.destroy()
  }
})

test("the meter fills in proportion and warns near the limit", async () => {
  const view = await testRender(() => (
    <box flexDirection="column" width={20}>
      <text>Usage</text>
      <Meter theme={theme} value={0.25} />
      <Meter theme={theme} value={0.95} />
    </box>
  ), { width: 20, height: 3 })
  try {
    // The meter measures itself after the first layout.
    await view.renderOnce()
    await view.renderOnce()
    expect(view.captureCharFrame().split("\n")[1]).toBe("━".repeat(20))
    const runs = view.captureSpans().lines.slice(1).map((line) => line.spans.map((span) => ({ width: span.width, fg: span.fg.toInts().slice(0, 3) })))
    expect(runs[0]![0]).toEqual({ width: 5, fg: [0, 170, 255] })
    expect(runs[1]![0]).toEqual({ width: 19, fg: [255, 68, 68] })
  } finally {
    view.renderer.destroy()
  }
})

test("the account summary always pairs a status word with its glyph", () => {
  const now = Date.UTC(2026, 10, 3, 12)
  const state = { version: 1 as const, repository: "me/cards", account: "me", automatic: true, base: {}, status: "synced" as const, lastSyncedAt: now - 120_000 }
  expect(syncBadge(undefined, undefined)).toEqual({ glyph: "○", label: "Local", tone: "neutral" })
  expect(syncBadge("me", undefined).label).toBe("Not synced")
  expect(syncBadge("me", state)).toEqual({ glyph: "●", label: "Synced", tone: "success" })
  expect(syncBadge("other", state).label).toBe("Paused")
  expect(syncBadge("me", { ...state, status: "conflict" }).glyph).toBe("▲")
  expect(summary(undefined, undefined, 0)).toBe("No cards yet · sign in to sync")
  expect(summary("me", undefined, 1)).toBe("1 card · set up sync")
  expect(summary("me", state, 3, now)).toBe("3 cards · synced 2m ago")
  expect(summary("other", state, 3, now)).toBe("Switch gh to @me")
  expect(relativeTime(now - 10_000, now)).toBe("just now")
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago")
})

test("the account card shows who is signed in and opens the novaSpace dialog", async () => {
  const unstub = stubCards("custom:subagents", "custom:copilot")
  const { sync } = await engine()
  let modal: (() => JSX.Element) | undefined
  let dialog: { size?: string; centered?: boolean } = {}
  const ctx = context()
  ctx.ui.dialog.show = (render) => { dialog = {}; modal = render }
  ctx.ui.dialog.set = (settings) => { dialog = settings }
  const view = await testRender(() => (
    <AccountCard ctx={ctx} sessionID="session" options={resolveOptions({})} pin="top" engine={sync} loadLogin={async () => "brnbtt"} accountStamp={async () => 1} update={noUpdate} />
  ), { width: 40, height: 4 })
  try {
    const frame = await view.waitForFrame((value) => value.includes("@brnbtt"))
    expect(frame).toContain("✧ @brnbtt")
    expect(frame).toContain("○ Not synced")
    expect(frame).toContain("2 cards · set up sync")
    expect(frame).not.toContain("⠿")
    await view.mockMouse.click(6, 1)
    expect(modal).toBeDefined()
    expect(dialog).toEqual({ size: "medium", centered: true })
  } finally {
    view.renderer.destroy()
    unstub()
  }
})

test("the account card follows a GitHub account switch without reopening", async () => {
  const { sync } = await engine()
  const logins = ["before", "after"]
  let lookups = 0
  let stamp = 1
  const view = await testRender(() => (
    <AccountCard ctx={context()} sessionID="session" options={resolveOptions({})} pin="top" engine={sync} accountPollMs={10}
      accountStamp={async () => stamp} loadLogin={async () => logins[Math.min(lookups++, logins.length - 1)]} />
  ), { width: 40, height: 4 })
  try {
    await Bun.sleep(60)
    await view.flush()
    expect(view.captureCharFrame()).toContain("@before")
    // Polling a change stamp must not run the account lookup every tick.
    expect(lookups).toBe(1)
    stamp = 2
    await Bun.sleep(80)
    await view.flush()
    expect(view.captureCharFrame()).toContain("@after")
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
    const frame = await view.waitForFrame((value) => value.includes("CARDS") && value.includes("○ Not synced"))
    expect(frame).toContain("Your sidebar cards, on every machine.")
    expect(frame).toContain("Subagents · Copilot")
    expect(frame).toContain("example/novaspace-cards")
    expect(frame).not.toContain("Skills")
    await click("cards-open")
    expect(opened).toEqual([paths.cards])

    await click("sync-create")
    const synced = await settle(view, (value) => value.includes("● Synced"))
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
    expect(frame).toContain("○ Local")
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

test("session card uses current context, honours compaction and revert, and shows usage", async () => {
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
  const ctx = context()
  ctx.data.session.message = { list: () => messages }
  ctx.data.session.cost = () => 3.42
  ctx.data.location.vcs = { info: () => ({ branch: { current: "main" } }) }
  const view = await testRender(() => <SessionInfoCard ctx={ctx} sessionID="session" options={resolveOptions({})} pin="bottom" />, { width: 38, height: 9 })
  try {
    const frame = await view.waitForFrame((value) => value.includes("Session") && value.includes("━"))
    expect(frame).toContain("52,500 · 5%")
    expect(frame).toContain("$3.42")
    expect(frame).toMatch(/~\/DEV +main/)
  } finally { view.renderer.destroy() }
})
