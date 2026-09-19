import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadStandardizationPreflight } from "../src/cards/setup/preflight"
import { context } from "./support"

test("keeps project-specific OpenCode sources outside the global profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sidebar-preflight-"))
  const workspace = join(root, "packages/app")
  const projectConfig = join(workspace, ".opencode/opencode.jsonc")
  const projectSkill = join(workspace, ".agents/skills/review/SKILL.md")
  const instructions = join(root, "AGENTS.md")
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true })
    await mkdir(join(workspace, ".agents/skills/review"), { recursive: true })
    await writeFile(projectConfig, "{}\n")
    await writeFile(projectSkill, "# Review\n")
    await writeFile(instructions, "# Project instructions\n")

    const ctx = context()
    ctx.data.location.default = () => ({ directory: workspace })
    ctx.client.vcs.get = async () => ({
      location: { directory: workspace, project: { directory: root, canonical: root } },
      data: { branch: {} },
    })
    ctx.client.config!.get = async () => ({ data: [{ type: "document", path: projectConfig, info: {} }] })

    const preflight = await loadStandardizationPreflight(ctx)
    expect(preflight.project.map((item) => item.path)).toContain(projectConfig)
    expect(preflight.project.map((item) => item.path)).toContain(projectSkill.slice(0, -"/review/SKILL.md".length))
    expect(preflight.project.map((item) => item.path)).toContain(instructions)
    expect(preflight.project.every((item) => item.detail === "Project-owned · not synced with profile")).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
