import { expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyFiles, collectFiles, decodeFile, type Snapshot } from "../src/cards/setup/sync-files"
import { ProfileSync } from "../src/cards/setup/sync"
import type { SyncRemote } from "../src/cards/setup/sync-remote"

test("transparent preparation preserves live JSONC, local plugins, credentials, paths and linked skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "novaspace-preserve-"))
  let files: Snapshot = {}, revision: string | undefined
  const remote: SyncRemote = {
    async account() { return "example" }, async verify() {},
    async read() { return { files: { ...files }, revision } },
    async write(_repo, next) { files = { ...next }; return revision = String(Number(revision ?? 0) + 1) },
  }
  const a = new ProfileSync({ home: join(root, "a"), config: join(root, "a/config"), state: join(root, "a/state") }, remote)
  const b = new ProfileSync({ home: join(root, "b"), config: join(root, "b/config"), state: join(root, "b/state") }, remote)
  const original = (name: string) => `{
  // Keep this ${name} comment and formatting.
  "model": "example/one",
  "plugins": ["/Users/${name}/plugin", "opencode-novaspace"],
  "mcp": {"servers": {"personal": {"headers": {"Authorization": "synthetic-${name}-secret"}}}},
  "worktree": {"directory": "/Users/${name}/worktrees"},
}\n`
  try {
    for (const engine of [a, b]) await mkdir(engine.paths.config, { recursive: true })
    await writeFile(join(a.paths.config, "opencode.jsonc"), original("alpha"))
    await writeFile(join(b.paths.config, "opencode.jsonc"), original("beta"))
    await mkdir(join(a.paths.home, ".agents"))
    const linked = join(root, "linked-skills")
    await mkdir(linked)
    await writeFile(join(linked, "SKILL.md"), "Existing linked skill")
    await symlink(linked, join(a.paths.home, ".agents/skills"))
    await mkdir(join(a.paths.config, "skills/local/references"), { recursive: true })
    await writeFile(join(a.paths.config, "skills/local/SKILL.md"), "Read references/machine.md")
    await writeFile(join(a.paths.config, "skills/local/references/machine.md"), "Use /Users/alpha/private-project")
    for (const engine of [a, b]) await engine.configure({ repository: "example/profile", selected: ["settings", "skills"] })
    const before = await stat(join(a.paths.config, "opencode.jsonc"))
    const result = await a.sync()
    expect(result.status).toBe("synced")
    expect(result.keptLocal?.map((entry) => entry.path)).toEqual(expect.arrayContaining(["config/opencode.jsonc#plugins", "config/opencode.jsonc#mcp", "config/opencode.jsonc#worktree", "agent-skills"]))
    expect(await readFile(join(a.paths.config, "opencode.jsonc"), "utf8")).toBe(original("alpha"))
    expect((await stat(join(a.paths.config, "opencode.jsonc"))).mtimeMs).toBe(before.mtimeMs)
    expect(JSON.stringify(files)).not.toContain(Buffer.from("synthetic-alpha-secret").toString("base64"))
    const portable = decodeFile(files["config/opencode.jsonc"]!).toString()
    expect(portable).toContain("example/one")
    expect(portable).not.toContain("synthetic-alpha-secret")
    expect(portable).not.toContain("/Users/")
    expect(portable).not.toContain("plugins")
    expect(Object.keys(files).some((key) => key.startsWith("config/skills/local/"))).toBe(false)
    expect(await readFile(join(a.paths.config, "skills/local/SKILL.md"), "utf8")).toBe("Read references/machine.md")
    expect((await b.sync()).status).toBe("synced")
    expect(await readFile(join(b.paths.config, "opencode.jsonc"), "utf8")).toBe(original("beta"))

    await writeFile(join(a.paths.config, "opencode.jsonc"), original("alpha").replace("example/one", "example/two"))
    expect((await a.sync()).status).toBe("synced")
    expect((await b.sync()).status).toBe("synced")
    expect(await readFile(join(b.paths.config, "opencode.jsonc"), "utf8")).toBe(original("beta").replace("example/one", "example/two"))
    await writeFile(join(a.paths.config, "opencode.jsonc"), original("alpha").replace("example/one", "example/three"))
    const beta = (await readFile(join(b.paths.config, "opencode.jsonc"), "utf8")).replace("  //", '  "default_agent": "review",\n  //')
    await writeFile(join(b.paths.config, "opencode.jsonc"), beta)
    expect((await a.sync()).status).toBe("synced")
    expect((await b.sync()).status).toBe("synced")
    expect((await a.sync()).status).toBe("synced")
    for (const engine of [a, b]) {
      const text = await readFile(join(engine.paths.config, "opencode.jsonc"), "utf8")
      expect(text).toContain("example/three")
      expect(text).toContain('"default_agent": "review"')
    }
    // Another machine can publish this location, but a local link is never followed or replaced.
    files["agent-skills/remote.md"] = Buffer.from("Remote skill").toString("base64")
    expect((await a.sync()).status).toBe("synced")
    expect((await lstat(join(a.paths.home, ".agents/skills"))).isSymbolicLink()).toBe(true)
    expect(await readdir(linked)).toEqual(["SKILL.md"])
    expect(await readFile(join(linked, "SKILL.md"), "utf8")).toBe("Existing linked skill")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("an edit made while a transfer is in flight is preserved", async () => {
  const home = await mkdtemp(join(tmpdir(), "novaspace-concurrent-"))
  const paths = { home, config: join(home, "config"), state: join(home, "state") }
  try {
    await mkdir(paths.config)
    await writeFile(join(paths.config, "AGENTS.md"), "Before transfer")
    const engine = new ProfileSync(paths, {
      async account() { return "example" }, async verify() {}, async read() { return { files: {} } },
      async write() { await writeFile(join(paths.config, "AGENTS.md"), "User edit during transfer"); return "saved" },
    })
    await engine.configure({ repository: "example/profile", selected: ["instructions"] })
    expect((await engine.sync()).status).toBe("error")
    expect(await readFile(join(paths.config, "AGENTS.md"), "utf8")).toBe("User edit during transfer")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("preparing one group never rewrites an unselected legacy remote group", async () => {
  const home = await mkdtemp(join(tmpdir(), "novaspace-selection-"))
  const paths = { home, config: join(home, "config"), state: join(home, "state") }
  const legacy = Buffer.from('{\n // Legacy source\n "plugins": ["/Users/another/plugin"]\n}').toString("base64")
  let uploaded: Snapshot = {}
  try {
    await mkdir(paths.config)
    await writeFile(join(paths.config, "AGENTS.md"), "Portable instructions")
    const engine = new ProfileSync(paths, {
      async account() { return "example" }, async verify() {},
      async read() { return { files: { "config/opencode.jsonc": legacy }, revision: "old" } },
      async write(_repo, files) { uploaded = files; return "new" },
    })
    await engine.configure({ repository: "example/profile", selected: ["instructions"] })
    expect((await engine.sync()).status).toBe("synced")
    expect(uploaded["config/opencode.jsonc"]).toBe(legacy)
    expect(await Bun.file(join(paths.config, "opencode.jsonc")).exists()).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("a restore staging failure leaves every existing file untouched", async () => {
  const home = await mkdtemp(join(tmpdir(), "novaspace-restore-"))
  const paths = { home, config: join(home, "config"), state: join(home, "state") }
  try {
    await mkdir(join(paths.config, "skills"), { recursive: true })
    await writeFile(join(paths.config, "opencode.json"), '{"model":"keep-this"}')
    await writeFile(join(paths.config, "skills/occupied"), "This is a file, not a directory")
    const before = await collectFiles(paths, ["settings", "skills"])
    const after = { ...before, "config/opencode.json": Buffer.from('{"model":"new"}').toString("base64"), "config/skills/occupied/child.md": Buffer.from("incoming").toString("base64") }
    await expect(applyFiles(paths, before, after, ["settings", "skills"])).rejects.toThrow()
    expect(await collectFiles(paths, ["settings", "skills"])).toEqual(before)
    expect((await readdir(paths.config)).filter((name) => name.includes("novaspace-"))).toEqual([])
  } finally { await rm(home, { recursive: true, force: true }) }
})
