import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { applyFiles, collectFiles, equalSnapshots, groupFor, mergeSnapshots, reviewSnapshot, syncGroups, syncPaths, validateSnapshot, type Snapshot, type SyncGroup, type SyncPaths } from "./sync-files"
import { githubRemote, validRepository, type SyncRemote } from "./sync-remote"

export type SyncState = {
  version: 1
  repository?: string
  account?: string
  selected: SyncGroup[]
  automatic: boolean
  allowMachinePaths: boolean
  base: Snapshot
  status: "unconfigured" | "pending" | "syncing" | "synced" | "conflict" | "error" | "paused"
  lastSyncedAt?: number
  lastAttemptAt?: number
  message?: string
  conflicts?: string[]
}
const initial = (): SyncState => ({ version: 1, selected: ["settings", "terminal", "skills", "instructions", "agents"], automatic: false, allowMachinePaths: false, base: {}, status: "unconfigured" })

export class ProfileSync {
  constructor(readonly paths: SyncPaths = syncPaths(), readonly remote: SyncRemote = githubRemote) {}
  async state(): Promise<SyncState> {
    const text = await readFile(join(this.paths.state, "sync.json"), "utf8").catch((error) => { if (error.code !== "ENOENT") throw error })
    if (!text) return initial()
    const value = JSON.parse(text) as SyncState
    if (value.version !== 1 || !Array.isArray(value.selected) || value.selected.some((id) => !syncGroups.some((group) => group.id === id))) throw new Error("Invalid sync configuration")
    if (value.repository) validRepository(value.repository)
    validateSnapshot(value.base)
    return value
  }
  private async save(state: SyncState) {
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 })
    const temp = join(this.paths.state, `sync-${process.pid}.tmp`)
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 })
    await rename(temp, join(this.paths.state, "sync.json"))
  }
  private async locked<T>(run: () => Promise<T>): Promise<T> {
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 })
    // SQLite supplies an OS-backed cross-process lease, released on crashes too.
    // This database holds no profile data; sync.json is the inspectable state.
    const path = join(this.paths.state, "lease.sqlite")
    const lease = new Database(path, { create: true })
    try {
      await chmod(path, 0o600)
      try { lease.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE") }
      catch (error) {
        if ((error as { code?: string }).code !== "SQLITE_BUSY") throw error
        throw new Error("Another novaSpace window is syncing; try again shortly")
      }
      try { return await run() } finally { lease.exec("ROLLBACK") }
    } finally { lease.close() }
  }
  async configure(input: { repository: string; selected: SyncGroup[]; allowMachinePaths: boolean }) {
    return this.locked(async () => {
      validRepository(input.repository)
      if (!input.selected.length || input.selected.some((id) => !syncGroups.some((group) => group.id === id))) throw new Error("Select at least one sync group")
      const account = await this.remote.account()
      await this.remote.verify(input.repository)
      const old = await this.state()
      const same = old.repository === input.repository && old.account === account
      const state: SyncState = {
        ...initial(), ...input, account, status: "pending",
        base: same ? Object.fromEntries(Object.entries(old.base).filter(([key]) => old.selected.includes(groupFor(key)!) && input.selected.includes(groupFor(key)!))) : {},
        lastSyncedAt: same ? old.lastSyncedAt : undefined,
      }
      await this.save(state)
      return state
    })
  }
  async automatic(enabled: boolean) {
    return this.locked(async () => {
      const state = await this.state()
      if (!state.repository || !state.lastSyncedAt) throw new Error("Complete a sync before enabling automatic sync")
      state.automatic = enabled
      state.status = enabled ? "pending" : "paused"
      state.message = undefined
      await this.save(state)
      return state
    })
  }
  async disconnect() {
    return this.locked(async () => { await this.save(initial()); return initial() })
  }
  async preview(selected: SyncGroup[]) {
    const files = await collectFiles(this.paths, selected)
    return { files: Object.keys(files), ...reviewSnapshot(files) }
  }
  async sync(resolution?: "local" | "remote", automatic = false): Promise<SyncState> {
    return this.locked(async () => {
      const state = await this.state()
      if (!state.repository) return state
      // All TUI processes share the on-disk lease and last-attempt time.
      if (automatic && (!state.automatic || state.status === "conflict" || Date.now() - (state.lastAttemptAt ?? 0) < 55_000)) return state
      state.status = "syncing"
      state.lastAttemptAt = Date.now()
      state.message = undefined
      await this.save(state)
      try {
        if (await this.remote.account() !== state.account) throw new Error(`Sync paused: switch GitHub back to @${state.account}, or reconnect this profile`)
        await this.remote.verify(state.repository)
        const local = await collectFiles(this.paths, state.selected)
        const remote = await this.remote.read(state.repository)
        if (!remote.revision && Object.keys(state.base).length) throw new Error("The remote profile disappeared. Reconnect after reviewing the repository; local files were kept.")
        const { merged, conflicts } = mergeSnapshots(state.base, local, remote.files, state.selected)
        if (conflicts.length && !resolution) {
          state.status = "conflict"
          state.conflicts = conflicts
          state.message = "Both machines changed the same files. Choose which version to keep; automatic sync is waiting."
          await this.save(state)
          return state
        }
        for (const key of conflicts) {
          const value = resolution === "local" ? local[key] : remote.files[key]
          if (value === undefined) delete merged[key]
          else merged[key] = value
        }
        validateSnapshot(merged)
        const selectedFiles = Object.fromEntries(Object.entries(merged).filter(([key]) => state.selected.includes(groupFor(key)!)))
        const review = reviewSnapshot(selectedFiles)
        if (review.blockers.length) throw new Error(`Possible literal credentials in: ${review.blockers.join(", ")}. Use environment references before syncing.`)
        if (review.warnings.length && !state.allowMachinePaths) throw new Error(`Machine-specific paths in: ${review.warnings.join(", ")}. Review files and explicitly allow them, or make them portable.`)
        if (!equalSnapshots(await collectFiles(this.paths, state.selected), local)) throw new Error("Local files changed during sync; retry")
        if (!equalSnapshots(merged, remote.files)) await this.remote.write(state.repository, merged, remote.revision)
        await applyFiles(this.paths, local, merged, state.selected)
        state.base = selectedFiles
        state.status = "synced"
        state.conflicts = []
        state.lastSyncedAt = Date.now()
        state.message = `${Object.keys(selectedFiles).length} files synced. Restart OpenCode when restored plugins or server settings require it.`
      } catch (error) {
        state.status = "error"
        state.message = error instanceof Error ? error.message : String(error)
      }
      await this.save(state)
      return state
    })
  }
  start(interval = 60_000) {
    let running: Promise<void> | undefined
    let stopped = false
    const tick = () => {
      if (running || stopped) return running
      running = this.sync(undefined, true).then(() => {}, () => { /* Another TUI may own the lease. */ })
        .finally(() => { running = undefined })
      return running
    }
    const timer = setInterval(() => void tick(), interval)
    void tick()
    return () => { stopped = true; clearInterval(timer); return running ?? Promise.resolve() }
  }
}
export const profileSync = new ProfileSync()
