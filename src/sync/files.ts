import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import type { NovaPaths } from "../paths"

/**
 * A snapshot maps a portable key to base64 file content. Keys are relative to
 * the novaSpace folder: `cards/...` for card files and `layout.json` for the
 * sidebar arrangement.
 */
export type Snapshot = Record<string, string>
export type LocalEntry = { path: string; reason: string }

export const layoutKey = "layout.json"
const ignored = new Set([".git", "node_modules", ".DS_Store", ".env"])
const temporaryFile = (name: string) => /\.novaspace-[a-f0-9-]+\.tmp$/.test(name)
const skipped = (name: string) => ignored.has(name) || name.startsWith(".env.") || temporaryFile(name)
export const limits = { file: 500_000, total: 700_000, files: 1_000 }

// The optional x: prefix preserves the executable flag without copying ownership
// or broad filesystem permissions between machines.
export function decodeFile(value: string) { return Buffer.from(value.startsWith("x:") ? value.slice(2) : value, "base64") }
export function encodeFile(value: Buffer, mode: number) { return `${mode & 0o111 ? "x:" : ""}${value.toString("base64")}` }

export function isSyncKey(key: string) {
  if (key === layoutKey) return true
  if (!key.startsWith("cards/") || key.includes("\\")) return false
  return key.slice(6).split("/").every((part) => !!part && part !== "." && part !== ".." && !skipped(part))
}

export function pathFor(key: string, paths: NovaPaths) {
  if (!isSyncKey(key)) throw new Error(`Unsupported card path: ${key}`)
  return key === layoutKey ? paths.layout : join(paths.cards, key.slice(6))
}

/** The card folder a key belongs to, for keys inside a card folder under `cards/`. */
export function cardFolder(key: string) {
  return key.match(/^cards\/([^/]+)\//)?.[1]
}

// Credentials must never leave the machine through a card. Card code that
// needs a secret should read it from the environment at runtime.
export function containsCredential(text: string) {
  return /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)
    || /["']?(?:api[_-]?key|access[_-]?token|secret|password|authorization)["']?\s*[:=]\s*["'](?!\{env:|\$\{|\$env:|process\.env)[^"'\n]{8,}["']/i.test(text)
}

async function rejectLinks(path: string, paths: NovaPaths) {
  const stop = resolve(paths.root)
  let current = resolve(path)
  while (current !== stop) {
    const info = await lstat(current).catch((error) => { if (error.code !== "ENOENT") throw error })
    if (info?.isSymbolicLink()) throw new Error(`Linked file stays on this machine: ${path}`)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid card snapshot")
  const result: Snapshot = {}
  const names = new Set<string>()
  let bytes = 0
  for (const [key, content] of Object.entries(value)) {
    if (!isSyncKey(key) || typeof content !== "string") throw new Error(`Invalid card file: ${key}`)
    const encoded = content.startsWith("x:") ? content.slice(2) : content
    if (decodeFile(content).toString("base64") !== encoded) throw new Error(`Invalid card file encoding: ${key}`)
    const name = key.toLowerCase()
    if (names.has(name)) throw new Error(`Case-colliding card path: ${key}`)
    names.add(name)
    bytes += content.length
    if (bytes > limits.total || names.size > limits.files) throw new Error("Cards exceed the 500 KB / 1,000 file sync limit")
    result[key] = content
  }
  for (const name of names) {
    const parts = name.split("/")
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join("/"))) throw new Error(`Overlapping card path: ${name}`)
  }
  return result
}

/**
 * Read the portable snapshot. Files that must not leave this machine (links,
 * oversized files, credentials) are reported in `keptLocal`, and a card folder
 * with any such file stays local as a whole: half a card cannot run elsewhere.
 */
export async function collectFiles(paths: NovaPaths): Promise<{ files: Snapshot; keptLocal: LocalEntry[] }> {
  const files: Snapshot = {}
  const keptLocal: LocalEntry[] = []
  const keep = (path: string, reason: string) => { keptLocal.push({ path, reason }) }
  const visit = async (key: string, path: string) => {
    const info = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
    if (!info) return
    if (info.isSymbolicLink() || info.isFile() && info.nlink > 1) return keep(key, "Linked files stay on this machine")
    if (info.isDirectory()) {
      for (const item of (await readdir(path)).sort()) if (!skipped(item)) await visit(`${key}/${item}`, join(path, item))
      return
    }
    if (!info.isFile()) return
    if (info.size > limits.file) return keep(key, "Large files stay on this machine")
    const content = await readFile(path)
    if (containsCredential(content.toString("utf8"))) return keep(key, "Files with credentials stay on this machine")
    files[key] = encodeFile(content, info.mode)
  }
  await visit("cards", paths.cards)
  delete files.cards
  const layout = await lstat(paths.layout).catch((error) => { if (error.code !== "ENOENT") throw error })
  if (layout?.isFile()) files[layoutKey] = encodeFile(await readFile(paths.layout), 0o600)

  for (const entry of [...keptLocal]) {
    const folder = cardFolder(entry.path)
    if (!folder || keptLocal.some((item) => item.path === `cards/${folder}`)) continue
    keptLocal.push({ path: `cards/${folder}`, reason: "Cards with local-only files stay on this machine" })
    for (const key of Object.keys(files)) if (cardFolder(key) === folder) delete files[key]
  }
  return { files: validateSnapshot(files), keptLocal }
}

export function equalSnapshots(a: Snapshot, b: Snapshot) {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key])
}

/**
 * Change local files from `before` to `after`. Every validation, backup and
 * staged write finishes before any live file changes, and a failure rolls our
 * writes back without overwriting a concurrent edit.
 */
export async function applyFiles(paths: NovaPaths, before: Snapshot, after: Snapshot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, path: pathFor(key, paths), before: before[key], after: after[key], mode: 0o600, temp: "", committed: false }))
  const current = async (path: string) => {
    await rejectLinks(path, paths)
    const info = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
    return info ? { content: encodeFile(await readFile(path), info.mode), mode: info.mode & 0o777 } : undefined
  }
  try {
    for (const change of changes) {
      const existing = await current(change.path)
      if (existing?.content !== change.before) throw new Error(`Card file changed during sync: ${change.key}; retry`)
      change.mode = existing?.mode ?? 0o644
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
      if ((await current(change.path))?.content !== change.before) throw new Error(`Card file changed during sync: ${change.key}; retry`)
      if (change.after === undefined) await unlink(change.path)
      else await rename(change.temp, change.path)
      change.committed = true
    }
  } catch (error) {
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
  await removeEmptyFolders(paths, changes.filter((change) => change.after === undefined).map((change) => change.path))
  return changes.map((change) => change.key)
}

async function removeEmptyFolders(paths: NovaPaths, removed: string[]) {
  const stop = resolve(paths.cards)
  for (const path of removed) {
    let folder = dirname(resolve(path))
    while (folder.startsWith(`${stop}${sep}`)) {
      if ((await readdir(folder).catch(() => [""])).length) break
      await rmdir(folder).catch(() => {})
      folder = dirname(folder)
    }
  }
}
