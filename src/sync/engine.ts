import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { novaPaths, type NovaPaths } from "../paths"
import { applyFiles, cardFolder, collectFiles, equalSnapshots, validateSnapshot, type LocalEntry, type Snapshot } from "./files"
import { localTarget, mergeSnapshots } from "./merge"
import { githubRemote, validRepository, type SyncRemote } from "./remote"

export type SyncStatus = "unconfigured" | "pending" | "syncing" | "synced" | "conflict" | "error" | "paused"
export type SyncState = {
  version: 1
  repository?: string
  account?: string
  automatic: boolean
  /** The snapshot both sides agreed on last time; the merge base. */
  base: Snapshot
  status: SyncStatus
  lastSyncedAt?: number
  lastAttemptAt?: number
  message?: string
  conflicts?: string[]
  keptLocal?: LocalEntry[]
}
export type SyncListener = (state: SyncState, changed: readonly string[]) => void

const stateFile = "cards-sync.json"
const initial = (): SyncState => ({ version: 1, automatic: false, base: {}, status: "unconfigured" })

export function cardCount(files: Snapshot) {
  return new Set(Object.keys(files).map(cardFolder).filter(Boolean)).size
}

export class CardSync {
  private listeners = new Set<SyncListener>()
  constructor(readonly paths: NovaPaths = novaPaths(), readonly remote: SyncRemote = githubRemote) {}

  async state(): Promise<SyncState> {
    const text = await readFile(join(this.paths.state, stateFile), "utf8").catch((error) => { if (error.code !== "ENOENT") throw error })
    if (!text) return initial()
    const value = JSON.parse(text) as SyncState
    if (value.version !== 1) throw new Error("Unsupported card sync state; reconnect sync")
    if (value.repository) validRepository(value.repository)
    validateSnapshot(value.base)
    return value
  }

  /** Called after every state change in this process; `changed` lists local files sync rewrote. */
  subscribe(listener: SyncListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async save(state: SyncState, changed: readonly string[] = []) {
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 })
    const temp = join(this.paths.state, `${stateFile}.${process.pid}.tmp`)
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 })
    await rename(temp, join(this.paths.state, stateFile))
    for (const listener of this.listeners) {
      try { listener(structuredClone(state), changed) } catch { /* A broken listener must not fail sync. */ }
    }
  }

  private async locked<T>(run: () => Promise<T>): Promise<T> {
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 })
    // SQLite supplies an OS-backed cross-process lease, released on crashes too.
    const path = join(this.paths.state, "lease.sqlite")
    const lease = new Database(path, { create: true })
    try {
      await chmod(path, 0o600)
      try { lease.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE") }
      catch (error) {
        if ((error as { code?: string }).code !== "SQLITE_BUSY") throw error
        throw new Error("Another OpenCode window is syncing cards; try again shortly")
      }
      try { return await run() } finally { lease.exec("ROLLBACK") }
    } finally { lease.close() }
  }

  /** Connect a private repository and run the first sync. Automatic sync starts on. */
  async connect(input: { repository: string; create?: boolean }) {
    await this.locked(async () => {
      const repository = validRepository(input.repository)
      const account = await this.remote.account()
      if (input.create) {
        if (!this.remote.create) throw new Error("Repository creation is unavailable")
        await this.remote.create(repository)
      }
      await this.remote.verify(repository)
      const old = await this.state()
      const same = old.repository === repository && old.account === account
      await this.save({
        ...initial(), repository, account, automatic: true, status: "pending",
        base: same ? old.base : {}, lastSyncedAt: same ? old.lastSyncedAt : undefined,
      })
    })
    return this.sync()
  }

  async setAutomatic(enabled: boolean) {
    return this.locked(async () => {
      const state = await this.state()
      if (!state.repository) throw new Error("Connect a repository first")
      state.automatic = enabled
      await this.save(state)
      return state
    })
  }

  async disconnect() {
    return this.locked(async () => { await this.save(initial()); return initial() })
  }

  async sync(resolution?: "local" | "remote", automatic = false): Promise<SyncState> {
    return this.locked(async () => {
      const state = await this.state()
      if (!state.repository) return state
      // All OpenCode windows share the on-disk lease and last-attempt time.
      if (automatic && (!state.automatic || state.status === "conflict" || Date.now() - (state.lastAttemptAt ?? 0) < 55_000)) return state
      state.status = "syncing"
      state.lastAttemptAt = Date.now()
      state.message = undefined
      await this.save(state)
      let changed: string[] = []
      try {
        const account = await this.remote.account()
        if (account !== state.account) {
          state.status = "paused"
          state.message = `Signed in to GitHub as @${account}. Switch back to @${state.account} or reconnect to sync.`
          await this.save(state)
          return state
        }
        await this.remote.verify(state.repository)
        const local = await collectFiles(this.paths)
        const remote = await this.remote.read(state.repository)
        if (!remote.revision && Object.keys(state.base).length) throw new Error("The cards file disappeared from the repository. Reconnect after checking it; local cards were kept.")
        const { merged, conflicts } = mergeSnapshots(state.base, local.files, remote.files, local.keptLocal, resolution)
        state.keptLocal = local.keptLocal
        if (conflicts.length) {
          state.status = "conflict"
          state.conflicts = conflicts
          state.message = "Both machines changed the same card files. Choose which version to keep."
          await this.save(state)
          return state
        }
        validateSnapshot(merged)
        if (!equalSnapshots((await collectFiles(this.paths)).files, local.files)) throw new Error("Cards changed during sync; retrying shortly")
        if (!equalSnapshots(merged, remote.files)) await this.remote.write(state.repository, merged, remote.revision)
        changed = await applyFiles(this.paths, local.files, localTarget(local.files, merged, local.keptLocal))
        const count = cardCount(merged)
        state.base = merged
        state.status = "synced"
        state.conflicts = []
        state.lastSyncedAt = Date.now()
        state.message = `${count} ${count === 1 ? "card" : "cards"} synced${local.keptLocal.length ? ` · ${local.keptLocal.length} kept on this machine` : ""}`
      } catch (error) {
        state.status = "error"
        state.message = error instanceof Error ? error.message : String(error)
      }
      await this.save(state, changed)
      return state
    })
  }

  start(interval = 60_000) {
    let running: Promise<void> | undefined
    let stopped = false
    const tick = () => {
      if (running || stopped) return running
      running = this.sync(undefined, true).then(() => {}, () => { /* Another window may hold the lease. */ })
        .finally(() => { running = undefined })
      return running
    }
    const timer = setInterval(() => void tick(), interval)
    void tick()
    return () => { stopped = true; clearInterval(timer); return running ?? Promise.resolve() }
  }
}

let shared: CardSync | undefined
/** The process-wide engine, created on first use so tests never touch real paths. */
export function cardSync() {
  return shared ??= new CardSync()
}
