/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SyncOnboardingModal } from "../src/cards/setup/sync-onboarding"
import { ProfileSync } from "../src/cards/setup/sync"
import type { Snapshot } from "../src/cards/setup/sync-files"
import { context, theme } from "./support"

for (const mode of ["dark", "light"]) test(`sync UI selects sources and starts automatic sync on connection (${mode})`, async () => {
  const home = await mkdtemp(join(tmpdir(), "novaspace-sync-ui-"))
  const paths = { home, config: join(home, "config"), state: join(home, "state") }
  await mkdir(paths.config)
  await writeFile(join(paths.config, "opencode.jsonc"), '{"model":"example/model","plugins":["opencode-novaspace"]}')
  await writeFile(join(paths.config, "cli.json"), '{"theme":{"name":"example"}}')
  let remote: Snapshot = {}, revision: string | undefined
  const created: string[] = []
  let denyCreate = mode === "dark"
  const engine = new ProfileSync(paths, {
    async account() { return "brunobett_microsoft" }, async verify(repo) { expect(repo).toBe("brunobett_microsoft/opencode-profile") },
    async create(repo) { created.push(repo); if (denyCreate) throw new Error("GitHub denied repository creation") },
    async read() { return { files: { ...remote }, revision } },
    async write(_repo, files) { remote = { ...files }; return revision = "saved" },
  })
  const ctx = context()
  if (mode === "light") ctx.theme = { ...theme, border: { base: "#a0a0a0" }, background: { base: "#fafafa", action: { primary: { hovered: "#d8e8fa" } } }, text: { ...theme.text, base: "#141414", muted: "#555555" } }
  let layer: (() => { commands: { bind: string; enabled?: () => boolean; run(): void | false }[] }) | undefined
  ctx.keymap = { layer: (value) => { layer = value } }
  const view = await testRender(() => <SyncOnboardingModal ctx={ctx} engine={engine} onBack={() => {}} />, { width: 76, height: 40 })
  const scroll = () => view.renderer.root.findDescendantById("setup-sync-onboarding-scroll") as ScrollBoxRenderable
  const ready = async () => {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      await view.flush()
      if (!view.captureCharFrame().includes("Working…")) return
      await Bun.sleep(10)
    }
    throw new Error(`Sync UI did not settle:\n${view.captureCharFrame()}`)
  }
  const click = async (id: string) => {
    // Disk state can settle before the modal's promise chain clears `busy`.
    // Wait for the UI, not a machine-speed-dependent delay between actions.
    await ready()
    const node = view.renderer.root.findDescendantById(id)!
    scroll().scrollTo(scroll().scrollTop + node.y - scroll().viewport.y - 2)
    await view.flush()
    await view.mockMouse.click(node.x + 1, node.y)
    await ready()
  }
  try {
    await view.waitForFrame((frame) => frame.includes("☑ OpenCode settings") && frame.includes("2 files selected"))
    expect(view.captureCharFrame()).toContain("✧ Profile sync")
    expect(scroll().scrollHeight).toBeLessThanOrEqual(scroll().viewport.height)
    // Navigate past the three tabs to the first group checkbox.
    for (let index = 0; index < 4; index++) layer!().commands.find((command) => command.bind === "tab")!.run()
    layer!().commands.find((command) => command.bind === "return")!.run()
    await view.flush()
    expect(view.captureCharFrame()).toContain("☐ OpenCode settings")
    layer!().commands.find((command) => command.bind === "return")!.run()
    await click("sync-group-terminal")
    await click("sync-tab-repository")
    expect(view.captureCharFrame()).toContain("brunobett_microsoft/opencode-profile")
    expect(view.captureCharFrame()).not.toContain("☑ OpenCode settings")
    if (mode === "dark") {
      await click("sync-create")
      expect(view.captureCharFrame()).toContain("GitHub denied repository creation")
      const notice = view.renderer.root.findDescendantById("sync-error")!
      expect(notice.y).toBeLessThan(scroll().y)
      denyCreate = false
      await click("sync-create")
      expect(created).toEqual(["brunobett_microsoft/opencode-profile", "brunobett_microsoft/opencode-profile"])
    } else await click("sync-connect")
    expect((await engine.state()).selected).not.toContain("terminal")
    expect((await engine.state()).automatic).toBe(true)
    expect((await engine.state()).status).toBe("synced")
    await click("sync-now")
    expect((await engine.state()).status).toBe("synced")
    expect(Object.keys(remote)).toEqual(["config/opencode.jsonc"])
    expect(await readFile(join(paths.config, "cli.json"), "utf8")).toContain("example")
    await click("sync-automatic")
    expect((await engine.state()).automatic).toBe(false)
    expect(view.captureCharFrame()).toContain("Automatic sync: Off")
    expect(view.captureCharFrame()).toContain("Profile sync")
    view.resize(56, 20)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Tab · Enter · Esc")
    expect(view.captureCharFrame()).toContain("Close")
    await click("sync-automatic")
    expect((await engine.state()).automatic).toBe(true)
  } finally { view.renderer.destroy(); await rm(home, { recursive: true, force: true }) }
})
