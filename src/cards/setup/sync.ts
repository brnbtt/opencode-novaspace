import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { applyFiles, collectFiles, equalSnapshots, groupFor, syncGroups, syncPaths, validateSnapshot, type LocalEntry, type Snapshot, type SyncGroup, type SyncPaths } from "./sync-files"
import { materializeProfile, mergeProfiles, prepareProfile } from "./sync-prepare"
import { githubRemote, validRepository, type SyncRemote } from "./sync-remote"

export type SyncState = {
  version: 1
  repository?: string
  account?: string
  selected: SyncGroup[]
  automatic: boolean
  keptLocal?: LocalEntry[]
  base: Snapshot
  status: "unconfigured" | "pending" | "syncing" | "synced" | "conflict" | "error" | "paused"
  lastSyncedAt?: number
  lastAttemptAt?: number
  message?: string
  conflicts?: string[]
}
const initial = (): SyncState => ({ version: 1, selected: ["settings", "terminal", "skills", "instructions", "agents"], automatic: false, base: {}, status: "unconfigured" })

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
  async configure(input: { repository: string; selected: SyncGroup[]; create?: boolean; allowMachinePaths?: boolean }) {
    return this.locked(async () => {
      const repository = validRepository(input.repository)
      if (!input.selected.length || input.selected.some((id) => !syncGroups.some((group) => group.id === id))) throw new Error("Select at least one sync group")
      const account = await this.remote.account()
      if (input.create) {
        if (!this.remote.create) throw new Error("Repository creation is unavailable")
        await this.remote.create(repository)
      }
      await this.remote.verify(repository)
      const old = await this.state()
      const same = old.repository === repository && old.account === account
      const state: SyncState = {
        ...initial(), repository, selected: input.selected, account, status: "pending",
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
      state.status = enabled ? state.status === "synced" ? "synced" : "pending" : "paused"
      state.message = undefined
      await this.save(state)
      return state
    })
  }
  async disconnect() {
    return this.locked(async () => { await this.save(initial()); return initial() })
  }
  async preview(selected: SyncGroup[]) {
    const keptLocal: LocalEntry[] = []
    const raw = await collectFiles(this.paths, selected, keptLocal)
    const profile = prepareProfile(raw, keptLocal)
    return { files: Object.keys(profile.files), keptLocal: profile.keptLocal }
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
        const keptLocal: LocalEntry[] = []
        const raw = await collectFiles(this.paths, state.selected, keptLocal)
        const local = prepareProfile(raw, keptLocal)
        const remote = await this.remote.read(state.repository)
        if (!remote.revision && Object.keys(state.base).length) throw new Error("The remote profile disappeared. Reconnect after reviewing the repository; local files were kept.")
        const base = prepareProfile(state.base).files
        const remoteProfile = prepareProfile(remote.files)
        // A device only prepares the groups it selected. Preserve other groups
        // byte-for-byte, including legacy snapshots owned by another device.
        for (const [key, value] of Object.entries(remote.files)) if (!state.selected.includes(groupFor(key)!)) remoteProfile.files[key] = value
        const { merged, conflicts } = mergeProfiles(base, local, remoteProfile, state.selected, resolution)
        state.keptLocal = local.keptLocal
        if (conflicts.length && !resolution) {
          state.status = "conflict"
          state.conflicts = conflicts
          state.message = "Both machines changed the same files. Choose which version to keep; automatic sync is waiting."
          await this.save(state)
          return state
        }
        validateSnapshot(merged)
        const selectedFiles = Object.fromEntries(Object.entries(merged).filter(([key]) => state.selected.includes(groupFor(key)!)))
        if (!equalSnapshots(await collectFiles(this.paths, state.selected, []), raw)) throw new Error("Local files changed during sync; retry")
        if (!equalSnapshots(merged, remote.files)) await this.remote.write(state.repository, merged, remote.revision)
        await applyFiles(this.paths, raw, materializeProfile(raw, local, merged, state.selected), state.selected)
        state.base = selectedFiles
        state.status = "synced"
        state.conflicts = []
        state.lastSyncedAt = Date.now()
        state.message = `${Object.keys(selectedFiles).length} files synced${state.keptLocal.length ? ` · ${state.keptLocal.length} machine-local entries preserved` : ""}.`
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
