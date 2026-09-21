import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JSX } from "solid-js"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { resolveOptions } from "../src/config"
import { Card, cardSurface } from "../src/ui"
import { SetupCard } from "../src/cards/setup/index"
import { setupOpenCommand, SetupModal } from "../src/cards/setup/modal"
import { cachedSetupInventory, emptyInventory, loadSetupInventory, type SetupInventory } from "../src/cards/setup/inventory"
import type { ProfileState } from "../src/cards/setup/profile"
import type { StandardizationPreflight } from "../src/cards/setup/preflight"
import type { UpdateState } from "../src/cards/setup/update"
import { latestContext, SessionInfoCard } from "../src/cards/session-info/index"
import { context, theme } from "./support"

test("animates the card surface slightly on hover", async () => {
  const options = resolveOptions({ hoverDuration: 40, hoverStrength: 0.1 })
  const view = await testRender(() => (
    <Card theme={theme} strength={options.surfaceStrength} hoverStrength={options.hoverStrength} hoverDuration={options.hoverDuration}>
      <text>Hover me</text>
    </Card>
  ), { width: 30, height: 6 })
  try {
    await view.waitForFrame((frame) => frame.includes("Hover me"))
    const span = () => view.captureSpans().lines.flatMap((line) => line.spans).find((item) => item.text.includes("Hover me"))!
    expect(span().bg.toInts().slice(0, 3)).toEqual(cardSurface(theme, options.surfaceStrength).toInts().slice(0, 3))
    await view.mockMouse.moveTo(3, 1)
    await Bun.sleep(70)
    await view.flush()
    expect(span().bg.toInts().slice(0, 3)).toEqual(cardSurface(theme, options.surfaceStrength + options.hoverStrength).toInts().slice(0, 3))
  } finally {
    view.renderer.destroy()
  }
})

test("opens the compact setup hub from the main card", async () => {
  let modal: (() => JSX.Element) | undefined
  const opened: string[] = []
  const ctx = context((render) => { modal = render })
  let dialogSettings: { size?: string; centered?: boolean } = {}
  ctx.ui.dialog.show = (render) => { dialogSettings = {}; modal = render }
  ctx.ui.dialog.set = (settings) => { dialogSettings = settings }
  const options = resolveOptions(ctx.options)
  const inventory = emptyInventory()
  inventory.skills = Array.from({ length: 10 }, (_, index) => ({ name: `skill-${index}`, target: { path: `/Users/example/.agents/skills/skill-${index}/SKILL.md`, kind: "file" } }))
  inventory.instructions = [{ name: "AGENTS.md", target: { path: "/Users/example/.config/opencode/AGENTS.md", kind: "file" } }]
  inventory.plugins = [{ name: "novaspace", state: "success", target: { path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" } }]
  inventory.mcp = ["gateway", "playwright"].map((name) => ({ name, state: "success" as const, target: { path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" as const } }))
  inventory.agents = Array.from({ length: 4 }, (_, index) => ({ name: `agent-${index}`, target: { path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" as const } }))
  inventory.targets = {
    skills: { path: "/Users/example/.agents/skills", kind: "folder" },
    instructions: { path: "/Users/example/.config/opencode", kind: "folder" },
    plugins: { path: "/Users/example/.config/opencode/plugins", kind: "folder" },
    mcp: { path: "/Users/example/.config/opencode", kind: "folder" },
    agents: { path: "/Users/example/.config/opencode", kind: "folder" },
  }
  inventory.files = {
    skills: Array.from({ length: 7 }, (_, index) => ({ path: `/Users/example/.agents/skills/skill-${index}/SKILL.md`, kind: "file" as const })),
    instructions: [{ path: "/Users/example/.config/opencode/AGENTS.md", kind: "file" }],
    plugins: [{ path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" }],
    mcp: [{ path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" }],
    agents: [{ path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" }],
  }
  inventory.settings = { path: "/Users/example/.config/opencode/opencode.jsonc", kind: "file" }
  const preflight: StandardizationPreflight = {
    root: "/Users/example/.config/opencode",
    moves: [{
      from: "/Users/example/.agents/skills",
      to: "/Users/example/.config/opencode/skills",
      files: 7,
      detail: "Move into OpenCode's canonical global skills folder",
    }],
    ready: [{ name: "Instructions", path: "/Users/example/.config/opencode/AGENTS.md" }],
    warnings: [{ name: "Machine-specific path", path: "/Users/example/.config/opencode/opencode.jsonc", detail: "/Users/example/DEV/worktrees" }],
    blockers: [],
    excluded: [{ name: "Shared service configuration", path: "/Users/example/.config/opencode/service.json", detail: "Machine-local" }],
    project: [{ name: "Instructions", path: "/Users/example/DEV/project/AGENTS.md", detail: "Project-owned · not synced with profile" }],
  }
  const card = await testRender(() => (
    <SetupCard
      ctx={ctx}
      sessionID="session"
      options={options}
      pin="top"
      loadProfile={async () => ({ login: "example", connection: "connected", sync: "unconfigured" })}
      loadInventory={async () => inventory}
      loadPreflight={async () => preflight}
      openTarget={async (target) => { opened.push(target.path) }}
    />
  ), { width: 38, height: 15 })
  try {
    const frame = await card.waitForFrame((value) => value.includes("Skills"))
    expect(frame).toContain("@example")
    expect(frame).not.toContain("⠿")
    expect(frame).toContain("● Set up sync")
    expect(frame.split("\n")[2]).toContain("─")
    expect(frame).toContain("Skills")
    expect(frame).toContain("10 ready")
    expect(frame).toContain("Instructions")
    expect(frame).toContain("1 active")
    expect(frame).toContain("Plugins")
    expect(frame).toContain("MCP")
    expect(frame).toContain("2 connected")
    expect(frame).toContain("Subagents")
    expect(frame).toContain("4 available")
    expect(frame).toContain("Manage settings")
    const rows = frame.split("\n")
    const manageRow = rows.findIndex((line) => line.includes("Manage settings"))
    expect(rows[manageRow - 1]).toContain("─")
    // Clicking the "Manage settings" text (not just the divider) must open it.
    await card.mockMouse.click(6, manageRow)
    expect(modal).toBeDefined()
    expect(dialogSettings).toEqual({ size: "medium", centered: true })
  } finally {
    card.renderer.destroy()
  }
  const setupModal = modal!

  let dialogBox: BoxRenderable | undefined
  const detail = await testRender(() => (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <box ref={(value) => { dialogBox = value }} width={76} paddingTop={1}>
        {setupModal()}
      </box>
    </box>
  ), { width: 90, height: 40 })
  try {
    const frame = await detail.waitForFrame((value) => value.includes("novaSpace"))
    expect(frame).toContain("Profile sync")
    expect(frame).toContain("Set up sync →")
    expect(frame).not.toContain("Standardize this setup before")
    expect(frame).toContain("Skills")
    expect(frame).toContain("10 ready")
    expect(frame).toContain("Available skills")
    expect(frame).toContain("skill-0")
    expect(frame).not.toContain("SKILL.md")
    expect(frame).toContain("Open folder ↗")
    expect(frame).not.toContain("Sidebar cards")
    expect(frame).not.toContain("Runtime settings")
    expect(frame).toContain("Esc to close")
    const sync = detail.renderer.root.findDescendantById("setup-sync-open")!
    await detail.mockMouse.click(sync.x + 1, sync.y)
    expect(modal).not.toBe(setupModal)
    expect(dialogSettings).toEqual({ size: "medium", centered: true })
    const skillsItems = detail.renderer.root.findDescendantById("setup-skills-items-scroll") as ScrollBoxRenderable
    const modalScroll = detail.renderer.root.findDescendantById("setup-modal-scroll") as ScrollBoxRenderable
    const syncPanel = detail.renderer.root.findDescendantById("setup-sync-panel") as BoxRenderable
    const skillsSection = detail.renderer.root.findDescendantById("setup-skills-section") as BoxRenderable
    const itemsPanel = detail.renderer.root.findDescendantById("setup-skills-items-panel") as BoxRenderable
    const captured = detail.captureSpans()
    const backgroundAt = (node: BoxRenderable) => {
      let x = 0
      for (const span of captured.lines[node.y]!.spans) {
        x += span.width
        if (x > node.x) return span.bg.toInts().slice(0, 3).join(",")
      }
      return ""
    }
    expect(new Set([backgroundAt(syncPanel), backgroundAt(skillsSection), backgroundAt(itemsPanel)]).size).toBe(3)
    expect(skillsItems.height).toBe(5)
    expect(skillsItems.scrollHeight).toBe(10)
    expect(skillsItems.scrollTop).toBe(0)
    expect(modalScroll.scrollTop).toBe(0)
    await detail.mockMouse.scroll(skillsItems.x + 2, skillsItems.y + 1, "down")
    await detail.flush()
    expect(skillsItems.scrollTop).toBeGreaterThan(0)
    expect(modalScroll.scrollTop).toBe(0)
    const innerScrollTop = skillsItems.scrollTop
    await detail.mockMouse.scroll(syncPanel.x + 2, syncPanel.y + 1, "down")
    await detail.flush()
    expect(modalScroll.scrollTop).toBeGreaterThan(0)
    expect(skillsItems.scrollTop).toBe(innerScrollTop)
    modalScroll.scrollTo(0)
    skillsItems.scrollTo(0)
    await detail.flush()
    const firstSkill = detail.renderer.root.findDescendantById("setup-skills-item-0")!
    await detail.mockMouse.click(firstSkill.x + 1, firstSkill.y)
    await Bun.sleep(0)
    expect(opened[0]).toEndWith("skill-0/SKILL.md")
    skillsItems.scrollTo(10_000)
    await detail.flush()
    expect(detail.captureCharFrame()).toContain("skill-9")
    const skillsLink = detail.renderer.root.findDescendantById("setup-skills-open")!
    await detail.mockMouse.click(skillsLink.x + 1, skillsLink.y)
    await Bun.sleep(0)
    expect(opened).toHaveLength(2)
    modalScroll.scrollTo(10_000)
    await detail.flush()
    const bottom = detail.captureCharFrame()
    expect(bottom).toContain("Subagents")
    expect(bottom).toContain("OpenCode settings")
    expect(bottom).toContain("Configured items")
    expect(bottom).toContain("Plugin · novaspace")
    expect(bottom).toContain("MCP · gateway")
    expect(bottom).not.toContain("opencode.jsonc")
    expect(detail.renderer.root.findDescendantById("setup-plugins-mcp-agents-section")).toBeDefined()
    expect(detail.renderer.root.findDescendantById("setup-settings-open")).toBeUndefined()
    expect(Math.abs(dialogBox!.y - (40 - dialogBox!.y - dialogBox!.height))).toBeLessThanOrEqual(1)
    detail.resize(90, 28)
    await detail.flush()
    expect(Math.abs(dialogBox!.y - (28 - dialogBox!.y - dialogBox!.height))).toBeLessThanOrEqual(1)
    expect(detail.captureCharFrame()).toContain("Esc to close")
  } finally {
    detail.renderer.destroy()
  }

  const syncModal = modal!
  const onboarding = await testRender(() => (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <box width={76} paddingTop={1}>{syncModal()}</box>
    </box>
  ), { width: 90, height: 40 })
  try {
    const steps = await onboarding.waitForFrame((value) => value.includes("Set up sync") && value.includes("Automatic sync"))
    expect(steps).toContain("Standardize setup")
    expect(steps).toContain("Connect GitHub")
    expect(steps).toContain("Private repository")
    expect(steps).toContain("Automatic sync")
    const review = onboarding.renderer.root.findDescendantById("setup-sync-review")!
    await onboarding.mockMouse.click(review.x + 1, review.y)
    const plan = await onboarding.waitForFrame((value) => value.includes("Standardization preflight") && value.includes("Proposed moves · 1"))
    expect(plan).toContain("Needs review")
    expect(plan).toContain("Read-only preview")
    const preflightScroll = onboarding.renderer.root.findDescendantById("setup-sync-onboarding-scroll") as ScrollBoxRenderable
    preflightScroll.scrollTo(10_000)
    await onboarding.flush()
    expect(onboarding.captureCharFrame()).toContain("Project-specific · not synced · 1")
    const setupBack = onboarding.renderer.root.findDescendantById("setup-sync-setup-back")!
    await onboarding.mockMouse.click(setupBack.x + 1, setupBack.y)
    expect(modal).not.toBe(syncModal)
    expect(dialogSettings).toEqual({ size: "medium", centered: true })
  } finally {
    onboarding.renderer.destroy()
  }

  const home = await mkdtemp(join(tmpdir(), "novaspace-inventory-"))
  try {
    await mkdir(join(home, ".config/opencode"), { recursive: true })
    await mkdir(join(home, ".agents/skills"), { recursive: true })
    await writeFile(join(home, ".config/opencode/opencode.jsonc"), "{}\n")
    await writeFile(join(home, ".config/opencode/AGENTS.md"), "# Global instructions\n")
    for (let index = 0; index < 6; index++) {
      const folder = join(home, `.agents/skills/skill-${index}`)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, "SKILL.md"), `# Skill ${index}\n`)
    }
    const discovered = await loadSetupInventory(ctx, { home })
    expect(discovered.agents).toHaveLength(4)
    expect(discovered.skills).toHaveLength(10)
    expect(discovered.mcp).toHaveLength(2)
    expect(discovered.settings?.kind).toBe("file")
    expect(discovered.targets.skills?.kind).toBe("folder")
    expect(discovered.files.skills!.length).toBeGreaterThan(5)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
  if (process.platform === "darwin") {
    expect(setupOpenCommand({ path: "/tmp/example.md", kind: "file" })).toEqual(["/usr/bin/open", "/tmp/example.md"])
  }
})

test("renders a usable local setup before optional GitHub sync is configured", async () => {
  const ctx = context()
  const options = resolveOptions(ctx.options)
  let profileLoads = 0
  let inventoryLoads = 0
  let resolveProfile!: (value: ProfileState) => void
  let resolveInventory!: (value: SetupInventory) => void
  const profile = new Promise<ProfileState>((resolve) => { resolveProfile = resolve })
  const inventory = new Promise<SetupInventory>((resolve) => { resolveInventory = resolve })
  const view = await testRender(() => (
    <SetupCard
      ctx={ctx}
      sessionID="session"
      options={options}
      pin="top"
      loadProfile={() => { profileLoads++; return profile }}
      loadInventory={() => { inventoryLoads++; return inventory }}
    />
  ), { width: 38, height: 15 })
  try {
    const local = await view.waitForFrame((frame) => frame.includes("Local profile") && frame.includes("Set up sync"))
    expect(local).toContain("Skills")
    expect(local).toContain("10 ready")
    expect(local).toContain("MCP")
    expect(local).not.toContain("Checking GitHub")
    expect(local).not.toContain("Inspecting customization layers")
    expect(profileLoads).toBe(1)
    expect(inventoryLoads).toBe(1)

    resolveProfile({ login: "example", connection: "connected", sync: "unconfigured" })
    resolveInventory(cachedSetupInventory(ctx))
    const enriched = await view.waitForFrame((frame) => frame.includes("@example"))
    expect(enriched).toContain("Set up sync")
    expect(profileLoads).toBe(1)
    expect(inventoryLoads).toBe(1)
  } finally {
    view.renderer.destroy()
  }
})

test("reports a failed inventory lookup instead of an empty machine", async () => {
  const ctx = context()
  const options = resolveOptions(ctx.options)
  const view = await testRender(() => (
    <SetupCard
      ctx={ctx}
      sessionID="session"
      options={options}
      pin="top"
      loadProfile={() => Promise.resolve({ connection: "signed-out", sync: "unconfigured" } as ProfileState)}
      loadInventory={() => Promise.reject(new Error("Plugin inventory timed out"))}
    />
  ), { width: 56, height: 16 })
  try {
    const failed = await view.waitForFrame((frame) => frame.includes("Stale counts"))
    expect(failed).toContain("Plugin inventory timed out")
    // The cached first frame stays visible so the card remains usable.
    expect(failed).toContain("Skills")
  } finally {
    view.renderer.destroy()
  }
})

test("reloads the GitHub account when the setup hub is opened", async () => {
  const ctx = context()
  ctx.ui.dialog.show = () => {}
  ctx.ui.dialog.set = () => {}
  const options = resolveOptions(ctx.options)
  const logins = ["before", "after"]
  let profileLoads = 0
  const view = await testRender(() => (
    <SetupCard
      ctx={ctx}
      sessionID="session"
      options={options}
      pin="top"
      loadProfile={async () => ({ login: logins[Math.min(profileLoads++, logins.length - 1)], connection: "connected", sync: "unconfigured" })}
      loadInventory={async () => cachedSetupInventory(ctx)}
    />
  ), { width: 38, height: 15 })
  try {
    const initial = await view.waitForFrame((frame) => frame.includes("@before"))
    const rows = initial.split("\n")
    const manageRow = rows.findIndex((line) => line.includes("Manage settings"))
    expect(manageRow).toBeGreaterThan(-1)
    // `gh auth switch` can change the account at any time, so opening the hub
    // must re-read it rather than keep the value captured at mount.
    await view.mockMouse.click(6, manageRow)
    const refreshed = await view.waitForFrame((frame) => frame.includes("@after"))
    expect(refreshed).not.toContain("@before")
    expect(profileLoads).toBe(2)
  } finally {
    view.renderer.destroy()
  }
})

test("picks up a GitHub account switch without reopening the card", async () => {
  const ctx = context()
  const options = resolveOptions(ctx.options)
  const logins = ["before", "after"]
  let profileLoads = 0
  // `gh auth switch` rewrites gh's config; the card watches that stamp.
  let stamp = 1
  const view = await testRender(() => (
    <SetupCard
      ctx={ctx}
      sessionID="session"
      options={options}
      pin="top"
      accountPollMs={10}
      accountStamp={async () => stamp}
      loadProfile={async () => ({ login: logins[Math.min(profileLoads++, logins.length - 1)], connection: "connected", sync: "unconfigured" })}
      loadInventory={async () => cachedSetupInventory(ctx)}
    />
  ), { width: 38, height: 15 })
  try {
    await Bun.sleep(60)
    await view.flush()
    expect(view.captureCharFrame()).toContain("@before")
    // Polling a change stamp must not re-run the account lookup every tick.
    expect(profileLoads).toBe(1)

    stamp = 2
    await Bun.sleep(80)
    await view.flush()
    const switched = view.captureCharFrame()
    expect(switched).toContain("@after")
    expect(switched).not.toContain("@before")
    expect(profileLoads).toBe(2)
  } finally {
    view.renderer.destroy()
  }
})

test("offers an update only for a managed package install", async () => {
  const ctx = context()
  const toasts: string[] = []
  ctx.ui.toast.show = (toast) => { toasts.push(String(toast.message)) }
  const applied: string[] = []
  let resolveApply!: (value: UpdateState) => void
  const pending = new Promise<UpdateState>((resolve) => { resolveApply = resolve })

  const local = await testRender(() => (
    <SetupModal
      ctx={ctx}
      inventory={emptyInventory()}
      loading={false}
      update={{
        load: async () => ({ status: "local", path: "/plugins/novaspace" }),
        check: async () => ({ status: "local", path: "/plugins/novaspace" }),
      }}
    />
  ), { width: 54, height: 14 })
  try {
    const frame = await local.waitForFrame((value) => value.includes("Local checkout"))
    // A checkout has no version to compare, so offering an update would lie.
    expect(frame).not.toContain("Update →")
  } finally {
    local.renderer.destroy()
  }

  const managed = await testRender(() => (
    <SetupModal
      ctx={ctx}
      inventory={emptyInventory()}
      loading={false}
      update={{
        load: async () => ({ status: "current", target: "opencode-novaspace", version: "0.1.1" }),
        check: async () => ({ status: "outdated", target: "opencode-novaspace", version: "0.1.1" }),
        apply: async (_ctx, target) => { applied.push(target); return pending },
      }}
    />
  ), { width: 54, height: 14 })
  try {
    // The cached state lands first, then the slower registry check flags it.
    await managed.waitForFrame((value) => value.includes("v0.1.1"))
    const offered = await managed.waitForFrame((value) => value.includes("Update →"))
    const rows = offered.split("\n")
    const updateRow = rows.findIndex((line) => line.includes("Update →"))
    const column = rows[updateRow]!.indexOf("Update →")
    await managed.mockMouse.click(column + 2, updateRow)
    await managed.waitForFrame((value) => value.includes("Updating…"))
    expect(applied).toEqual(["opencode-novaspace"])

    resolveApply({ status: "updated", target: "opencode-novaspace", version: "0.1.1" })
    // The host can still report `updating` immediately after a successful
    // update, so the row must settle on its own rather than read that back.
    const done = await managed.waitForFrame((value) => value.includes("restart to load"))
    expect(done).not.toContain("Update →")
    expect(done).not.toContain("Updating…")
    // An already-mounted sidebar keeps running the previous code.
    expect(toasts.some((message) => message.includes("Restart the TUI"))).toBe(true)
  } finally {
    managed.renderer.destroy()
  }
})

test("settles the update row when the host still reports updating", async () => {
  const ctx = context()
  ctx.ui.toast.show = () => {}
  const view = await testRender(() => (
    <SetupModal
      ctx={ctx}
      inventory={emptyInventory()}
      loading={false}
      update={{
        load: async () => ({ status: "outdated", target: "opencode-novaspace", version: "0.1.1" }),
        check: async () => ({ status: "outdated", target: "opencode-novaspace", version: "0.1.1" }),
        // Mirrors the real host: the flag is still set right after the update.
        apply: async () => ({ status: "updated", target: "opencode-novaspace", version: "0.1.1" }),
      }}
    />
  ), { width: 54, height: 14 })
  try {
    const offered = await view.waitForFrame((value) => value.includes("Update →"))
    const rows = offered.split("\n")
    const updateRow = rows.findIndex((line) => line.includes("Update →"))
    await view.mockMouse.click(rows[updateRow]!.indexOf("Update →") + 2, updateRow)
    const settled = await view.waitForFrame((value) => value.includes("restart to load"))
    expect(settled).not.toContain("Updating…")
  } finally {
    view.renderer.destroy()
  }
})

test("native info uses current context, honours compaction/revert, and omits duplicate MCP info", async () => {
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
  const view = await testRender(() => <SessionInfoCard ctx={ctx} sessionID="session" options={resolveOptions({})} pin="bottom" />, { width: 38, height: 10 })
  try {
    const frame = await view.waitForFrame((value) => value.includes("Session info"))
    expect(frame).toContain("52,500 · 5%")
    expect(frame).toContain("$3.42")
    expect(frame).not.toContain("MCP")
    expect(frame).toContain("~/DEV")
  } finally { view.renderer.destroy() }
})
