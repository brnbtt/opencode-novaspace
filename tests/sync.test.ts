import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database } from "bun:sqlite"
import { ProfileSync } from "../src/cards/setup/sync"
import { collectFiles, validateSnapshot, type Snapshot, type SyncPaths } from "../src/cards/setup/sync-files"
import type { SyncRemote } from "../src/cards/setup/sync-remote"
import { validRepository } from "../src/cards/setup/sync-remote"

const temporary: string[] = []
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }) })
async function machine(remote: SyncRemote) {
  const home = await mkdtemp(join(tmpdir(), "novaspace-sync-")); temporary.push(home)
  const paths: SyncPaths = { home, config: join(home, ".config/opencode"), state: join(home, "state") }
  await mkdir(paths.config, { recursive: true })
  return new ProfileSync(paths, remote)
}
function server() {
  let files: Snapshot = {}, revision: string | undefined, writes = 0, account = "example"
  let fail = false, race = false
  const remote: SyncRemote = {
    async account() { return account },
    async verify() { if (fail) throw new Error("Offline") },
    async read() { return { files: { ...files }, revision } },
    async write(_repository, next, sha) {
      if (race || sha !== revision) throw new Error("HTTP 409: remote changed")
      files = { ...next }; revision = String(++writes); return revision
    },
  }
  return { remote, files: () => files, writes: () => writes, account: (value: string) => { account = value }, offline: (value: boolean) => { fail = value }, race: (value: boolean) => { race = value }, remove: () => { files = {}; revision = undefined } }
}
const configure = (engine: ProfileSync) => engine.configure({ repository: "example/profile", selected: ["settings", "terminal", "skills", "instructions"], allowMachinePaths: false })

test("accepts managed GitHub usernames and rejects malformed repository targets", () => {
  expect(validRepository(" brunobett_microsoft/opencode-profile ")).toBe("brunobett_microsoft/opencode-profile")
  expect(validRepository("brnbtt/opencode-profile")).toBe("brnbtt/opencode-profile")
  for (const value of ["owner", "owner/repo/extra", "owner/repo?ref=main", "owner name/repo", "-owner/repo"]) expect(() => validRepository(value)).toThrow("owner/repository")
})

test("two machines converge, preserve unselected files, restore deletions with backups, and pause on conflicts", async () => {
  const host = server(), a = await machine(host.remote), b = await machine(host.remote)
  await writeFile(join(a.paths.config, "opencode.jsonc"), '{"model":"example/model-one","plugins":["opencode-novaspace"],"mcp":{"servers":{}}}')
  await writeFile(join(a.paths.config, "cli.json"), '{"theme":{"name":"light"}}')
  await mkdir(join(a.paths.config, "themes"))
  await writeFile(join(a.paths.config, "themes/custom.json"), '{"base":{}}')
  await writeFile(join(a.paths.config, "service.json"), '{"local":"never-sync"}')
  await mkdir(join(a.paths.home, ".agents/skills/review"), { recursive: true })
  await writeFile(join(a.paths.home, ".agents/skills/review/SKILL.md"), "Review code")
  await writeFile(join(a.paths.home, ".agents/skills/review/check.sh"), "#!/bin/sh\ntrue\n", { mode: 0o700 })
  await configure(a); await configure(b)
  expect((await a.sync()).status).toBe("synced")
  expect((await b.sync()).status).toBe("synced")
  expect(await readFile(join(b.paths.config, "opencode.jsonc"), "utf8")).toContain("model-one")
  expect(await readFile(join(b.paths.home, ".agents/skills/review/SKILL.md"), "utf8")).toBe("Review code")
  expect(Object.keys(host.files())).toHaveLength(5)
  expect(await readFile(join(b.paths.config, "themes/custom.json"), "utf8")).toBe('{"base":{}}')
  expect((await stat(join(b.paths.home, ".agents/skills/review/check.sh"))).mode & 0o100).toBe(0o100)
  await chmod(join(a.paths.home, ".agents/skills/review/check.sh"), 0o600)
  await a.sync(); await b.sync()
  expect((await stat(join(b.paths.home, ".agents/skills/review/check.sh"))).mode & 0o111).toBe(0)
  expect(host.files()["config/service.json"]).toBeUndefined()
  const writes = host.writes()
  await a.sync(); await b.sync()
  expect(host.writes()).toBe(writes)

  await writeFile(join(a.paths.config, "cli.json"), '{"theme":{"name":"dark"}}')
  await writeFile(join(b.paths.config, "AGENTS.md"), "Keep changes focused")
  await a.sync(); await b.sync(); await a.sync()
  expect(await readFile(join(b.paths.config, "cli.json"), "utf8")).toContain("dark")
  expect(await readFile(join(a.paths.config, "AGENTS.md"), "utf8")).toBe("Keep changes focused")

  await writeFile(join(a.paths.config, "cli.json"), '{"theme":{"name":"a"}}')
  await writeFile(join(b.paths.config, "cli.json"), '{"theme":{"name":"b"}}')
  await a.sync()
  expect((await b.sync()).conflicts).toEqual(["config/cli.json"])
  expect(await readFile(join(b.paths.config, "cli.json"), "utf8")).toContain('"b"')
  expect((await b.sync("remote")).status).toBe("synced")
  expect(await readFile(join(b.paths.config, "cli.json"), "utf8")).toContain('"a"')
  expect((await readdir(join(b.paths.state, "backups"))).length).toBeGreaterThan(0)

  await unlink(join(a.paths.config, "AGENTS.md")); await a.sync(); await b.sync()
  expect(await Bun.file(join(b.paths.config, "AGENTS.md")).exists()).toBe(false)
  await b.configure({ repository: "example/profile", selected: ["instructions"], allowMachinePaths: false })
  await writeFile(join(b.paths.config, "cli.json"), "local-only")
  await b.sync()
  expect(Buffer.from(host.files()["config/cli.json"]!, "base64").toString()).toContain('"a"')
})

test("automatic loop syncs while running and respects pause, account switches, offline failures and remote races", async () => {
  const host = server(), a = await machine(host.remote)
  await configure(a)
  await writeFile(join(a.paths.config, "AGENTS.md"), "one")
  await a.sync(); await a.automatic(true)
  // Expire the shared cross-process attempt throttle for the timer test.
  const state = await a.state(); state.lastAttemptAt = 0
  await writeFile(join(a.paths.state, "sync.json"), JSON.stringify(state))
  await writeFile(join(a.paths.config, "AGENTS.md"), "two")
  const stop = a.start(10)
  try {
    for (let i = 0; i < 100 && Buffer.from(host.files()["config/AGENTS.md"]!, "base64").toString() !== "two"; i++) await Bun.sleep(10)
    expect(Buffer.from(host.files()["config/AGENTS.md"]!, "base64").toString()).toBe("two")
  } finally { await stop() }
  await a.automatic(false)
  const writes = host.writes()
  await writeFile(join(a.paths.config, "AGENTS.md"), "three")
  await a.sync(undefined, true)
  expect(host.writes()).toBe(writes)
  host.account("other")
  expect((await a.sync()).message).toContain("switch GitHub back")
  host.account("example"); host.offline(true)
  expect((await a.sync()).status).toBe("error")
  host.offline(false); host.race(true)
  expect((await a.sync()).message).toContain("409")
  expect((await a.state()).base["config/AGENTS.md"]).toBe(Buffer.from("two").toString("base64"))
  host.race(false)
  expect((await a.sync()).status).toBe("synced")
  host.remove()
  expect((await a.sync()).message).toContain("disappeared")
  expect(await readFile(join(a.paths.config, "AGENTS.md"), "utf8")).toBe("three")
})

test("rejects invalid paths and automatically keeps private settings local", async () => {
  expect(() => validateSnapshot({ "config/skills/../../service.json": "" })).toThrow()
  expect(() => validateSnapshot({ "config/service.json": "" })).toThrow()
  expect(() => validateSnapshot({ "config/skills/A": "", "config/skills/a": "" })).toThrow("Case-colliding")
  expect(() => validateSnapshot({ "config/skills/a": "", "config/skills/a/b": "" })).toThrow("Overlapping")
  const host = server(), a = await machine(host.remote)
  await configure(a)
  await writeFile(join(a.paths.config, "opencode.json"), '{"apiKey":"literal-secret"}')
  expect((await a.sync()).status).toBe("synced")
  expect(await readFile(join(a.paths.config, "opencode.json"), "utf8")).toBe('{"apiKey":"literal-secret"}')
  expect(Buffer.from(host.files()["config/opencode.json"]!, "base64").toString()).not.toContain("literal-secret")
  await writeFile(join(a.paths.config, "opencode.json"), '{"plugins":["/Users/someone/local-plugin"]}')
  expect((await a.sync()).status).toBe("synced")
  expect(await readFile(join(a.paths.config, "opencode.json"), "utf8")).toContain("/Users/someone/local-plugin")
  expect(Buffer.from(host.files()["config/opencode.json"]!, "base64").toString()).not.toContain("/Users/")
  await mkdir(join(a.paths.config, "skills"))
  await symlink(join(a.paths.config, "opencode.json"), join(a.paths.config, "skills/link"))
  await expect(collectFiles(a.paths, ["skills"])).rejects.toThrow("Symlink")
})

test("holds one cross-process lease and preserves existing files on first-connection conflicts", async () => {
  const host = server(), a = await machine(host.remote), b = await machine(host.remote)
  await configure(a); await configure(b)
  await writeFile(join(a.paths.config, "cli.json"), '{"theme":"remote"}')
  await writeFile(join(b.paths.config, "cli.json"), '{"theme":"local"}')
  await a.sync()
  expect((await b.sync()).status).toBe("conflict")
  expect(await readFile(join(b.paths.config, "cli.json"), "utf8")).toBe('{"theme":"local"}')
  expect((await b.sync("local")).status).toBe("synced")
  const lease = new Database(join(b.paths.state, "lease.sqlite"))
  lease.exec("BEGIN IMMEDIATE")
  try { await expect(b.sync()).rejects.toThrow("Another novaSpace") }
  finally { lease.exec("ROLLBACK"); lease.close() }
})
