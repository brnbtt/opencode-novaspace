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

for (const mode of ["dark", "light"]) test(`sync UI selects whole-file groups, connects, syncs and enables automation (${mode})`, async () => {
  const home = await mkdtemp(join(tmpdir(), "novaspace-sync-ui-"))
  const paths = { home, config: join(home, "config"), state: join(home, "state") }
  await mkdir(paths.config)
  await writeFile(join(paths.config, "opencode.jsonc"), '{"model":"example/model","plugins":["opencode-novaspace"]}')
  await writeFile(join(paths.config, "cli.json"), '{"theme":{"name":"example"}}')
  let remote: Snapshot = {}, revision: string | undefined
  const engine = new ProfileSync(paths, {
    async account() { return "example" }, async verify(repo) { expect(repo).toBe("example/opencode-profile") },
    async read() { return { files: { ...remote }, revision } },
    async write(_repo, files) { remote = { ...files }; return revision = "saved" },
  })
  const ctx = context()
  if (mode === "light") ctx.theme = { ...theme, border: { base: "#a0a0a0" }, background: { base: "#fafafa", action: { primary: { hovered: "#d8e8fa" } } }, text: { ...theme.text, base: "#141414", muted: "#555555" } }
  let layer: (() => { commands: { bind: string; enabled?: () => boolean; run(): void | false }[] }) | undefined
  ctx.keymap = { layer: (value) => { layer = value } }
  const view = await testRender(() => <SyncOnboardingModal ctx={ctx} engine={engine} onBack={() => {}} />, { width: 76, height: 40 })
  const scroll = () => view.renderer.root.findDescendantById("setup-sync-onboarding-scroll") as ScrollBoxRenderable
  const click = async (id: string) => {
    // Disk state can settle before the modal's promise chain clears `busy`.
    // Wait for the UI, not a machine-speed-dependent delay between actions.
    await view.waitForFrame((frame) => !frame.includes("Working…"))
    const node = view.renderer.root.findDescendantById(id)!
    scroll().scrollTo(scroll().scrollTop + node.y - scroll().viewport.y - 2)
    await view.flush()
    await view.mockMouse.click(node.x + 1, node.y)
    await view.waitForFrame((frame) => !frame.includes("Working…"))
  }
  try {
    await Bun.sleep(40); await view.flush()
    expect(view.captureCharFrame()).toContain("Choose what travels")
    expect(view.captureCharFrame()).toContain("╭")
    // Tab + Enter activates the first group checkbox, then restores it.
    layer!().commands.find((command) => command.bind === "tab")!.run()
    layer!().commands.find((command) => command.bind === "return")!.run()
    await view.flush()
    expect(view.captureCharFrame()).toContain("☐ OpenCode settings")
    layer!().commands.find((command) => command.bind === "return")!.run()
    await click("sync-group-terminal")
    await click("sync-connect")
    expect((await engine.state()).selected).not.toContain("terminal")
    await click("sync-now")
    expect((await engine.state()).status).toBe("synced")
    expect(Object.keys(remote)).toEqual(["config/opencode.jsonc"])
    expect(await readFile(join(paths.config, "cli.json"), "utf8")).toContain("example")
    await click("sync-automatic")
    expect((await engine.state()).automatic).toBe(true)
    expect(view.captureCharFrame()).toContain("Automatic sync: On")
    expect(view.captureCharFrame()).toContain("Profile sync")
    view.resize(56, 20)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Tab · Enter · Esc")
    expect(view.captureCharFrame()).toContain("Close")
    await click("sync-automatic")
    expect((await engine.state()).automatic).toBe(false)
  } finally { view.renderer.destroy(); await rm(home, { recursive: true, force: true }) }
})
