import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database } from "bun:sqlite"
import { pathsIn } from "../src/paths"
import { CardSync, type SyncState } from "../src/sync/engine"
import { collectFiles, decodeFile, validateSnapshot, type Snapshot } from "../src/sync/files"
import { mergeLayout } from "../src/sync/merge"
import { validRepository, type SyncRemote } from "../src/sync/remote"

const temporary: string[] = []
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }) })

function server() {
  let files: Snapshot = {}, revision: string | undefined, writes = 0, account = "example", offline = false
  const created: string[] = []
  const remote: SyncRemote = {
    async account() { return account },
    async create(repository) { created.push(repository) },
    async verify() { if (offline) throw new Error("Offline") },
    async read() { return { files: { ...files }, revision } },
    async write(_repository, next, sha) {
      if (sha !== revision) throw new Error("HTTP 409: remote changed")
      files = validateSnapshot({ ...next }); revision = String(++writes); return revision
    },
  }
  return {
    remote, created, files: () => files, writes: () => writes,
    account: (value: string) => { account = value },
    offline: (value: boolean) => { offline = value },
  }
}

async function machine(remote: SyncRemote) {
  const root = await mkdtemp(join(tmpdir(), "novaspace-sync-")); temporary.push(root)
  const paths = pathsIn(join(root, "novaspace"), join(root, "state"))
  await mkdir(paths.cards, { recursive: true })
  const engine = new CardSync(paths, remote)
  const write = async (key: string, content: string) => {
    const path = join(paths.root, key)
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, content)
  }
  const read = (key: string) => readFile(join(paths.root, key), "utf8").catch(() => undefined)
  return { engine, paths, write, read }
}

const layout = (value: object) => JSON.stringify({ version: 1, ...value })
const card = (title: string) => `export default { apiVersion: 1, title: ${JSON.stringify(title)}, render() { return null } }\n`

test("accepts managed GitHub usernames and rejects malformed repository targets", () => {
  expect(validRepository(" brunobett_microsoft/novaspace-cards ")).toBe("brunobett_microsoft/novaspace-cards")
  for (const value of ["owner", "owner/repo/extra", "owner/repo?ref=main", "owner name/repo", "-owner/repo"]) expect(() => validRepository(value)).toThrow("owner/repository")
})

test("two machines share cards and their layout, propagate edits and deletions, and keep backups", async () => {
  const hub = server()
  const a = await machine(hub.remote), b = await machine(hub.remote)
  await a.write("cards/hello/index.js", card("Hello"))
  await a.write("cards/hello/data.js", "export const data = 1\n")
  await a.write("cards/shared.js", "export const shared = true\n")
  await a.write("layout.json", layout({ cards: ["account", "custom:hello"], pins: { "custom:hello": "bottom" } }))
  await b.write("cards/local/index.js", card("Local"))

  const first = await a.engine.connect({ repository: "example/novaspace-cards", create: true })
  expect(hub.created).toEqual(["example/novaspace-cards"])
  expect(first.status).toBe("synced")
  expect(first.automatic).toBe(true)
  expect(first.message).toBe("1 card synced")
  expect(Object.keys(hub.files()).sort()).toEqual(["cards/hello/data.js", "cards/hello/index.js", "cards/shared.js", "layout.json"])

  const changes: string[][] = []
  b.engine.subscribe((_state, changed) => { if (changed.length) changes.push([...changed]) })
  const joined = await b.engine.connect({ repository: "example/novaspace-cards" })
  expect(joined.status).toBe("synced")
  expect(await b.read("cards/hello/index.js")).toBe(card("Hello"))
  expect(await b.read("cards/local/index.js")).toBe(card("Local"))
  expect(changes).toEqual([["cards/hello/data.js", "cards/hello/index.js", "cards/shared.js", "layout.json"]])
  expect(Object.keys(hub.files())).toContain("cards/local/index.js")

  // Rearranging on both machines merges per field, without a conflict.
  await b.write("cards/hello/index.js", card("Hello again"))
  await b.write("layout.json", layout({ cards: ["account", "custom:hello", "custom:local"], pins: { "custom:hello": "bottom" }, hidden: ["session-info"] }))
  await a.write("layout.json", layout({ cards: ["account", "custom:hello"], pins: { "custom:hello": false } }))
  expect((await b.engine.sync()).status).toBe("synced")
  const merged = await a.engine.sync()
  expect(merged.status).toBe("synced")
  expect(await a.read("cards/hello/index.js")).toBe(card("Hello again"))
  expect(JSON.parse((await a.read("layout.json"))!)).toEqual({ version: 1, cards: ["account", "custom:hello", "custom:local"], pins: { "custom:hello": false }, hidden: ["session-info"] })
  const backups = join(a.paths.state, "backups")
  const [stamp] = await readdir(backups)
  expect(await readFile(join(backups, stamp!, "cards/hello/index.js"), "utf8")).toBe(card("Hello"))

  // Deleting a card folder removes it everywhere, folder included.
  await rm(join(a.paths.cards, "hello"), { recursive: true })
  await a.engine.sync()
  await b.engine.sync()
  expect(await stat(join(b.paths.cards, "hello")).catch(() => undefined)).toBeUndefined()
  expect(await b.read("cards/shared.js")).toBe("export const shared = true\n")
})

test("pauses on a conflict and resolves it with either machine's version", async () => {
  const hub = server()
  const a = await machine(hub.remote), b = await machine(hub.remote)
  await a.write("cards/hello/index.js", card("Base"))
  await a.engine.connect({ repository: "example/cards" })
  await b.engine.connect({ repository: "example/cards" })
  await a.write("cards/hello/index.js", card("From A"))
  await b.write("cards/hello/index.js", card("From B"))
  await a.engine.sync()

  const conflict = await b.engine.sync()
  expect(conflict.status).toBe("conflict")
  expect(conflict.conflicts).toEqual(["cards/hello/index.js"])
  expect(await b.read("cards/hello/index.js")).toBe(card("From B"))
  // The automatic loop waits for a decision.
  expect((await b.engine.sync(undefined, true)).status).toBe("conflict")

  expect((await b.engine.sync("remote")).status).toBe("synced")
  expect(await b.read("cards/hello/index.js")).toBe(card("From A"))

  await a.write("cards/hello/index.js", card("A again"))
  await b.write("cards/hello/index.js", card("B wins"))
  await a.engine.sync()
  expect((await b.engine.sync()).status).toBe("conflict")
  expect((await b.engine.sync("local")).status).toBe("synced")
  expect(decodeFile(hub.files()["cards/hello/index.js"]!).toString()).toBe(card("B wins"))
})

test("keeps credentials, links and oversized files on this machine, whole card folders included", async () => {
  const hub = server()
  const a = await machine(hub.remote)
  await a.write("cards/safe/index.js", card("Safe"))
  await a.write("cards/secret/index.js", card("Secret"))
  await a.write("cards/secret/config.js", 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n')
  await a.write("cards/env/index.js", 'const key = process.env.API_KEY\nexport default { apiKey: "{env:API_KEY}" }\n')
  await a.write("cards/big/index.js", "x".repeat(600_000))
  await mkdir(join(a.paths.root, "..", "elsewhere"), { recursive: true })
  await writeFile(join(a.paths.root, "..", "elsewhere", "index.js"), card("Linked"))
  await symlink(join(a.paths.root, "..", "elsewhere"), join(a.paths.cards, "linked"))

  const { files, keptLocal } = await collectFiles(a.paths)
  expect(Object.keys(files).sort()).toEqual(["cards/env/index.js", "cards/safe/index.js"])
  expect(keptLocal.map((entry) => entry.path).sort()).toEqual(["cards/big", "cards/big/index.js", "cards/linked", "cards/secret", "cards/secret/config.js"])

  const synced = await a.engine.connect({ repository: "example/cards" })
  expect(synced.message).toBe("2 cards synced · 5 kept on this machine")
  expect(Object.keys(hub.files()).sort()).toEqual(["cards/env/index.js", "cards/safe/index.js"])
  // Local-only cards are left exactly as they are.
  expect(await a.read("cards/secret/index.js")).toBe(card("Secret"))
  expect(validateSnapshot.bind(null, { "cards/../escape.js": "" })).toThrow("Invalid card file")
  expect(validateSnapshot.bind(null, { "settings/opencode.json": "" })).toThrow("Invalid card file")
})

test("pauses when the GitHub account changes, reports outages and runs automatically once a minute", async () => {
  const hub = server()
  const a = await machine(hub.remote)
  await a.write("cards/hello/index.js", card("Hello"))
  await a.engine.connect({ repository: "example/cards" })

  hub.account("someone-else")
  const paused = await a.engine.sync()
  expect(paused.status).toBe("paused")
  expect(paused.message).toContain("@example")
  hub.account("example")

  hub.offline(true)
  const offline = await a.engine.sync()
  expect(offline.status).toBe("error")
  expect(offline.message).toBe("Offline")
  hub.offline(false)

  // Automatic runs are throttled across windows by the shared last-attempt time.
  const writes = hub.writes()
  await a.write("cards/hello/index.js", card("Edited"))
  expect((await a.engine.sync(undefined, true)).lastAttemptAt).toBe(offline.lastAttemptAt)
  expect(hub.writes()).toBe(writes)
  await a.engine.setAutomatic(false)
  const state = JSON.parse(await readFile(join(a.paths.state, "cards-sync.json"), "utf8")) as SyncState
  await writeFile(join(a.paths.state, "cards-sync.json"), JSON.stringify({ ...state, lastAttemptAt: 0 }))
  expect((await a.engine.sync(undefined, true)).status).toBe("error")
  await a.engine.setAutomatic(true)
  await writeFile(join(a.paths.state, "cards-sync.json"), JSON.stringify({ ...(await a.engine.state()), lastAttemptAt: 0 }))
  const stop = a.engine.start(60_000)
  await stop()
  expect(hub.writes()).toBe(writes + 1)
  expect((await a.engine.state()).status).toBe("synced")

  expect((await a.engine.disconnect()).repository).toBeUndefined()
  expect((await a.engine.sync()).status).toBe("unconfigured")
})

test("holds one cross-process lease", async () => {
  const hub = server()
  const a = await machine(hub.remote)
  await a.engine.connect({ repository: "example/cards" })
  const lease = new Database(join(a.paths.state, "lease.sqlite"))
  lease.exec("BEGIN IMMEDIATE")
  try {
    await expect(a.engine.sync()).rejects.toThrow("Another OpenCode window is syncing cards")
  } finally {
    lease.exec("ROLLBACK")
    lease.close()
  }
})

test("merges layout fields independently and prefers this machine on a collision", () => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64")
  const read = (value?: string) => JSON.parse(decodeFile(value!).toString())
  const base = encode({ version: 1, cards: ["a", "b"], pins: { a: "top", b: false } })
  const local = encode({ version: 1, cards: ["b", "a"], pins: { a: "top", b: "bottom" } })
  const remote = encode({ version: 1, cards: ["a", "b", "c"], pins: { a: false, b: false }, hidden: ["c"] })
  expect(read(mergeLayout(base, local, remote))).toEqual({ version: 1, cards: ["b", "a"], pins: { a: false, b: "bottom" }, hidden: ["c"] })
  expect(mergeLayout(base, local, local)).toBe(local)
  expect(mergeLayout(undefined, undefined, remote)).toBe(remote)
})
