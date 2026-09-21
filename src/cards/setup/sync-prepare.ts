import { applyEdits, getNodeValue, modify, parseTree, type ParseError } from "jsonc-parser"
import { decodeFile, encodeFile, groupFor, mergeSnapshots, reviewSnapshot, type LocalEntry, type Snapshot, type SyncGroup } from "./sync-files"

type Config = Record<string, unknown>
export type PreparedProfile = { files: Snapshot; fields: Record<string, string[]>; keptLocal: LocalEntry[] }
const configFile = (key: string) => /^config\/(opencode\.jsonc?|cli\.json)$/.test(key)
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]))
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Config, right = b as Config
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  }
  return false
}
function config(content: string): Config | undefined {
  const errors: ParseError[] = []
  const tree = parseTree(decodeFile(content).toString("utf8"), errors, { allowTrailingComma: true })
  if (!tree || tree.type !== "object" || errors.length) return
  const keys = tree.children?.map((property) => property.children?.[0]?.value) ?? []
  if (new Set(keys).size !== keys.length) return
  return getNodeValue(tree) as Config
}
function encoded(value: Config, original?: string) {
  return encodeFile(Buffer.from(JSON.stringify(value, null, 2) + "\n"), original?.startsWith("x:") ? 0o700 : 0o600)
}
function localValue(value: unknown, name = ""): boolean {
  if (typeof value === "string") {
    const env = /^(\{env:[^}]+\}|\$\{[^}]+\}|\$env:\w+)$/.test(value)
    if (env) return false
    if (/(?:api[_-]?key|token|secret|password|auth|credential|cookie)/i.test(name) && value.length > 0) return true
    if (name === "shell" || /(?:^\/(?!\/)|(?:^|\s)\.{1,2}[/\\]|~[/\\]|[A-Za-z]:[/\\]|file:\/\/|\/(?:Users|home|private|Volumes|opt|usr|var|mnt)\/)/.test(value)) return true
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)) return true
    if (!value.startsWith("@") && /\.(?:[cm]?js|tsx?|py|ps1|sh|cmd|bat)$/i.test(value)) return true
    return reviewSnapshot({ "config/AGENTS.md": Buffer.from(value).toString("base64") }).blockers.length > 0
  }
  if (Array.isArray(value)) return value.some((item) => localValue(item, name))
  return !!value && typeof value === "object" && Object.entries(value).some(([key, item]) => localValue(item, key))
}
export function protectedPath(key: string, entries: LocalEntry[]) {
  return entries.some((entry) => key === entry.path || key.startsWith(`${entry.path}/`))
}

/** Prepare a portable copy only. Live configuration is never rewritten here. */
export function prepareProfile(raw: Snapshot, initial: LocalEntry[] = []): PreparedProfile {
  const files: Snapshot = {}, fields: Record<string, string[]> = {}, keptLocal = [...initial]
  for (const [key, content] of Object.entries(raw)) {
    if (configFile(key)) {
      const value = config(content)
      if (!value) { keptLocal.push({ path: key, reason: "Unrecognized configuration stays local" }); continue }
      const local = Object.keys(value).filter((name) => localValue(value[name], name))
      fields[key] = local
      for (const name of local) keptLocal.push({ path: `${key}#${name}`, reason: "Machine-specific settings or credentials stay local" })
      files[key] = encoded(Object.fromEntries(Object.entries(value).filter(([name]) => !local.includes(name))), content)
    } else {
      const review = reviewSnapshot({ [key]: content })
      if (review.blockers.length || review.warnings.length) keptLocal.push({ path: key, reason: "Machine-specific content or credentials stay local" })
      else files[key] = content
    }
  }
  // Never export half a skill or plugin bundle when one of its dependencies is
  // machine-local. Keep the whole bundle intact on the source machine.
  for (const entry of [...keptLocal]) {
    const root = entry.path.match(/^((?:config\/(?:skills|plugins)|agent-skills|claude-skills)\/[^/]+)\//)?.[1]
    if (!root || keptLocal.some((item) => item.path === root)) continue
    keptLocal.push({ path: root, reason: "Bundle with local dependencies stays on this machine" })
    for (const key of Object.keys(files)) if (key.startsWith(`${root}/`)) delete files[key]
  }
  return { files, fields, keptLocal }
}

/** Merge portable config fields independently while ignoring local-only fields. */
export function mergeProfiles(base: Snapshot, local: PreparedProfile, remote: PreparedProfile, selected: readonly SyncGroup[], resolution?: "local" | "remote") {
  const result = mergeSnapshots(base, local.files, remote.files, selected)
  const conflicts = new Set(result.conflicts)
  for (const key of new Set([...Object.keys(base), ...Object.keys(local.files), ...Object.keys(remote.files)])) {
    if (!selected.includes(groupFor(key)!)) continue
    if (protectedPath(key, local.keptLocal)) {
      conflicts.delete(key)
      if (remote.files[key] === undefined) delete result.merged[key]
      else result.merged[key] = remote.files[key]!
      continue
    }
    if (configFile(key) && local.files[key] !== undefined && remote.files[key] !== undefined) {
      const b = base[key] ? config(base[key]!) ?? {} : {}, l = config(local.files[key]!)!, r = config(remote.files[key]!)!
      const merged = new Map(Object.entries(r))
      conflicts.delete(key)
      for (const name of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        if (local.fields[key]?.includes(name)) continue
        const collision = !same(l[name], r[name]) && !same(l[name], b[name]) && !same(r[name], b[name])
        if (collision && !resolution) { conflicts.add(key); continue }
        const value = collision ? resolution === "local" ? l[name] : r[name] : same(l[name], b[name]) ? r[name] : l[name]
        if (value === undefined) merged.delete(name)
        else merged.set(name, value)
      }
      result.merged[key] = encoded(Object.fromEntries(merged), local.files[key])
    } else if (conflicts.has(key) && resolution) {
      const value = resolution === "local" ? local.files[key] : remote.files[key]
      if (value === undefined) delete result.merged[key]
      else result.merged[key] = value
      conflicts.delete(key)
    }
  }
  return { merged: result.merged, conflicts: [...conflicts] }
}

/** Overlay incoming portable settings without changing this machine's private
 * fields, formatting, comments, paths, or files omitted from the portable copy. */
export function materializeProfile(raw: Snapshot, local: PreparedProfile, incoming: Snapshot, selected: readonly SyncGroup[]): Snapshot {
  const result: Snapshot = { ...raw }
  for (const key of new Set([...Object.keys(local.files), ...Object.keys(incoming)])) {
    if (!selected.includes(groupFor(key)!) || protectedPath(key, local.keptLocal)) continue
    const next = incoming[key]
    if (configFile(key) && raw[key] !== undefined) {
      const original = config(raw[key]!)!
      const desired = next ? config(next)! : {}
      const localFields = local.fields[key] ?? []
      if (next === undefined && !localFields.length) { delete result[key]; continue }
      let text = decodeFile(raw[key]!).toString("utf8")
      for (const name of new Set([...Object.keys(original), ...Object.keys(desired)])) {
        if (localFields.includes(name) || same(original[name], desired[name])) continue
        text = applyEdits(text, modify(text, [name], desired[name], { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" } }))
      }
      result[key] = encodeFile(Buffer.from(text), raw[key]!.startsWith("x:") ? 0o700 : 0o600)
    } else if (next === undefined) delete result[key]
    else result[key] = next
  }
  return result
}
