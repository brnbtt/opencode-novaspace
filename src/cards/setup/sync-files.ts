import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"

export const syncGroups = [
  { id: "settings", label: "OpenCode settings", detail: "Default model, providers, plugins, MCP, permissions and inline agents · whole opencode.json(c)" },
  { id: "terminal", label: "Appearance & preferences", detail: "Theme, keybindings, terminal preferences and novaSpace options · cli.json and themes/" },
  { id: "skills", label: "Skills", detail: "Global skills from OpenCode, .agents and .claude folders" },
  { id: "instructions", label: "Instructions", detail: "Global AGENTS.md" },
  { id: "agents", label: "Agents & commands", detail: "Global agent and command files" },
  { id: "plugins", label: "Local plugin files", detail: "Profile-owned plugin scripts; installed packages are restored from settings" },
] as const
export type SyncGroup = typeof syncGroups[number]["id"]
export type Snapshot = Record<string, string>
// The optional x: prefix preserves the executable flag without copying ownership
// or broad filesystem permissions between machines.
export function decodeFile(value: string) { return Buffer.from(value.startsWith("x:") ? value.slice(2) : value, "base64") }
export function encodeFile(value: Buffer, mode: number) { return `${mode & 0o111 ? "x:" : ""}${value.toString("base64")}` }
export type LocalEntry = { path: string; reason: string }
export type SyncPaths = { home: string; config: string; state: string }
export function syncPaths(): SyncPaths {
  const home = process.env.HOME ?? homedir()
  return {
    home,
    config: join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode"),
    state: join(process.env.XDG_STATE_HOME ?? join(home, ".local/state"), "novaspace"),
  }
}
const roots: Record<SyncGroup, string[]> = {
  settings: ["config/opencode.json", "config/opencode.jsonc"],
  terminal: ["config/cli.json", "config/themes"],
  instructions: ["config/AGENTS.md"],
  skills: ["config/skills", "agent-skills", "claude-skills"],
  agents: ["config/agents", "config/commands"],
  plugins: ["config/plugins"],
}
const directories = new Set(["config/skills", "agent-skills", "claude-skills", "config/agents", "config/commands", "config/plugins", "config/themes"])
const ignored = new Set([".git", "node_modules", ".DS_Store", "backups", ".env"])
const temporaryFile = (name: string) => /\.novaspace-[a-f0-9-]+\.tmp$/.test(name)
export function groupFor(key: string): SyncGroup | undefined {
  if (key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === ".." || ignored.has(part) || part.startsWith(".env.") || temporaryFile(part))) return
  return syncGroups.find(({ id }) => roots[id].some((root) => key === root && !directories.has(root) || directories.has(root) && key.startsWith(`${root}/`)))?.id
}
export function pathFor(key: string, paths: SyncPaths) {
  if (!groupFor(key)) throw new Error(`Unsupported profile path: ${key}`)
  if (key.startsWith("config/")) return join(paths.config, key.slice(7))
  if (key.startsWith("agent-skills/")) return join(paths.home, ".agents/skills", key.slice(13))
  return join(paths.home, ".claude/skills", key.slice(14))
}
async function regularPath(path: string, paths: SyncPaths) {
  let current = resolve(path)
  while (true) {
    const info = await lstat(current).catch((error) => { if (error.code !== "ENOENT") throw error })
    if (info?.isSymbolicLink()) throw new Error(`Symlink needs local review: ${path}`)
    if (current === resolve(paths.config) || current === resolve(paths.home)) return
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profile snapshot")
  const result: Snapshot = {}
  const names = new Set<string>()
  let bytes = 0
  for (const [key, content] of Object.entries(value)) {
    if (!groupFor(key) || typeof content !== "string") throw new Error(`Invalid profile file: ${key}`)
    const encoded = content.startsWith("x:") ? content.slice(2) : content
    if (decodeFile(content).toString("base64") !== encoded) throw new Error(`Invalid profile encoding: ${key}`)
    const name = key.toLowerCase()
    if (names.has(name)) throw new Error(`Case-colliding profile path: ${key}`)
    names.add(name)
    bytes += content.length
    if (bytes > 700_000 || Object.keys(result).length >= 1000) throw new Error("Profile exceeds the 500 KB / 1,000 file limit")
    result[key] = content
  }
  for (const name of names) {
    const parts = name.split("/")
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join("/"))) throw new Error(`Overlapping profile path: ${name}`)
  }
  return result
}
export function reviewSnapshot(files: Snapshot) {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const [key, content] of Object.entries(files)) {
    const text = decodeFile(content).toString("utf8")
    if (/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)
      || /["']?(?:api[_-]?key|access[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*["'](?!\{env:|\$\{|\$env:|process\.env)[^"'\n]+["']/i.test(text)) blockers.push(key)
    if (/(?:\/Users\/|\/home\/|[A-Z]:\\\\)/.test(text)) warnings.push(key)
  }
  return { blockers, warnings }
}
export async function collectFiles(paths: SyncPaths, selected: readonly SyncGroup[], keptLocal?: LocalEntry[]): Promise<Snapshot> {
  const result: Snapshot = {}
  let bytes = 0
  const visit = async (key: string, path: string) => {
    const info = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
    if (!info) return
    if (keptLocal && info.isFile() && info.nlink > 1) {
      keptLocal.push({ path: key, reason: "Linked source stays on this machine" })
      return
    }
    try { await regularPath(path, paths) }
    catch (error) {
      if (!keptLocal || !(error instanceof Error) || !error.message.startsWith("Symlink needs local review")) throw error
      keptLocal.push({ path: key, reason: "Linked source stays on this machine" })
      return
    }
    if (info.isDirectory()) {
      for (const item of (await readdir(path)).sort()) {
        if (ignored.has(item) || item.startsWith(".env.") || temporaryFile(item)) continue
        await visit(`${key}/${item}`, join(path, item))
      }
    } else if (info.isFile()) {
      if (!groupFor(key)) throw new Error(`Unsupported profile file: ${key}`)
      if (info.size > 500_000) {
        if (!keptLocal) throw new Error(`Profile file too large: ${key}`)
        keptLocal.push({ path: key, reason: "Large file stays on this machine" })
        return
      }
      result[key] = encodeFile(await readFile(path), info.mode)
      bytes += result[key]!.length
      if (bytes > 700_000 || Object.keys(result).length > 1000) throw new Error("Profile exceeds the 500 KB / 1,000 file limit")
    }
  }
  for (const group of selected) for (const root of roots[group]) {
    const path = root.startsWith("config/") ? join(paths.config, root.slice(7))
      : join(paths.home, root === "agent-skills" ? ".agents/skills" : ".claude/skills")
    await visit(root, path)
  }
  return validateSnapshot(result)
}
export function mergeSnapshots(base: Snapshot, local: Snapshot, remote: Snapshot, selected: readonly SyncGroup[]) {
  const merged: Snapshot = { ...remote }
  const conflicts: string[] = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (!selected.includes(groupFor(key)!)) continue
    const b = base[key], l = local[key], r = remote[key]
    if (l !== r && l !== b && r !== b) { conflicts.push(key); continue }
    const value = l === b ? r : l
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  return { merged, conflicts }
}
export function equalSnapshots(a: Snapshot, b: Snapshot) {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key])
}
export async function applyFiles(paths: SyncPaths, before: Snapshot, after: Snapshot, selected: readonly SyncGroup[]) {
  if (!equalSnapshots(await collectFiles(paths, selected, []), before)) throw new Error("Local files changed during sync; retry to include the latest edits")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => selected.includes(groupFor(key)!) && before[key] !== after[key])
    .map((key) => ({ key, path: pathFor(key, paths), before: before[key], after: after[key], mode: 0o600, temp: "", committed: false }))
  const current = async (path: string) => {
    await regularPath(path, paths)
    const info = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
    return info ? { content: encodeFile(await readFile(path), info.mode), mode: info.mode & 0o777 } : undefined
  }
  try {
    // Finish every validation, backup and staged write before changing any live file.
    for (const change of changes) {
      const existing = await current(change.path)
      if (existing?.content !== change.before) throw new Error(`File changed during sync: ${change.key}`)
      change.mode = existing?.mode ?? 0o600
      if (change.before !== undefined) {
        const backup = join(paths.state, "backups", stamp, change.key)
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
        await writeFile(backup, decodeFile(change.before), { mode: 0o600, flag: "wx" })
      }
      if (change.after !== undefined) {
        await mkdir(dirname(change.path), { recursive: true })
        change.temp = `${change.path}.novaspace-${randomUUID()}.tmp`
        const mode = (change.mode & ~0o111) | (change.after.startsWith("x:") ? 0o100 : 0)
        await writeFile(change.temp, decodeFile(change.after), { mode, flag: "wx" })
      }
    }
    for (const change of changes) {
      if ((await current(change.path))?.content !== change.before) throw new Error(`File changed during sync: ${change.key}`)
      if (change.after === undefined) await unlink(change.path)
      else await rename(change.temp, change.path)
      change.committed = true
    }
  } catch (error) {
    // Roll back our writes, but never overwrite a concurrent edit by the user.
    const failed: string[] = []
    for (const change of changes.filter((item) => item.committed).reverse()) {
      try {
        if ((await current(change.path))?.content !== change.after) continue
        if (change.before === undefined) await unlink(change.path)
        else {
          change.temp = `${change.path}.novaspace-${randomUUID()}.tmp`
          await writeFile(change.temp, decodeFile(change.before), { mode: change.mode, flag: "wx" })
          await rename(change.temp, change.path)
        }
      } catch { failed.push(change.key) }
    }
    if (failed.length) throw new Error(`Restore interrupted for ${failed.join(", ")}; originals are in ${join(paths.state, "backups", stamp)}`)
    throw error
  } finally {
    for (const change of changes) if (change.temp) await unlink(change.temp).catch((error) => { if (error.code !== "ENOENT") throw error })
  }
}
