import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSetupInventory } from "../src/cards/setup/inventory"
import { context } from "./support"

// Windows does not set HOME, so the global config folder must not depend on it.
test("finds the global AGENTS.md when HOME is not set", async () => {
  const root = await mkdtemp(join(tmpdir(), "novaspace-no-home-"))
  const instructions = join(root, "opencode/AGENTS.md")
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  try {
    await mkdir(join(root, "opencode"), { recursive: true })
    await writeFile(instructions, "# Global instructions\n")
    delete process.env.HOME
    process.env.XDG_CONFIG_HOME = root

    const ctx = context()
    ctx.data.location.default = () => ({ directory: join(root, "workspace") })
    const inventory = await loadSetupInventory(ctx)
    expect(inventory.instructions.map((item) => item.target?.path)).toEqual([instructions])
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
