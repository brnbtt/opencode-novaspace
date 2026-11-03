import { decodeFile, encodeFile, layoutKey, type LocalEntry, type Snapshot } from "./files"

type Layout = Record<string, unknown>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function readLayout(content?: string): Layout | undefined {
  if (content === undefined) return undefined
  try {
    const value = JSON.parse(decodeFile(content).toString("utf8"))
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function pick<T>(base: T, local: T, remote: T): T {
  if (same(local, remote) || same(remote, base)) return local
  if (same(local, base)) return remote
  // Both machines rearranged the same thing. The layout is a preference, not
  // work to lose, so this machine's latest arrangement wins without a prompt.
  return local
}

/**
 * Merge the layout field by field (`pins` card by card), so moving a card on one
 * machine and hiding another elsewhere both survive.
 */
export function mergeLayout(base?: string, local?: string, remote?: string): string | undefined {
  const b = readLayout(base) ?? {}, l = readLayout(local), r = readLayout(remote)
  if (!l) return remote
  if (!r) return local === base ? remote : local
  const merged: Layout = {}
  for (const field of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (field === "pins") {
      const bp = (b.pins ?? {}) as Layout, lp = (l.pins ?? {}) as Layout, rp = (r.pins ?? {}) as Layout
      const pins: Layout = {}
      for (const id of new Set([...Object.keys(bp), ...Object.keys(lp), ...Object.keys(rp)])) {
        const value = pick(bp[id], lp[id], rp[id])
        if (value !== undefined) pins[id] = value
      }
      merged.pins = pins
      continue
    }
    const value = pick(b[field], l[field], r[field])
    if (value !== undefined) merged[field] = value
  }
  const text = `${JSON.stringify(merged, null, 2)}\n`
  return local !== undefined && same(readLayout(local), merged) ? local : encodeFile(Buffer.from(text), 0o600)
}

export function protectedPath(key: string, entries: readonly LocalEntry[]) {
  return entries.some((entry) => key === entry.path || key.startsWith(`${entry.path}/`))
}

/**
 * Three-way merge of the card folder. Each file merges as a whole: when both
 * machines changed the same file differently it is a conflict, unless a
 * resolution picks a side. Files kept local on this machine are neither sent
 * nor overwritten; the repository keeps whatever it already had for them.
 */
export function mergeSnapshots(base: Snapshot, local: Snapshot, remote: Snapshot, keptLocal: readonly LocalEntry[] = [], resolution?: "local" | "remote") {
  const merged: Snapshot = {}
  const conflicts: string[] = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[key], l = local[key], r = remote[key]
    let value: string | undefined
    if (protectedPath(key, keptLocal)) value = r
    else if (key === layoutKey) value = mergeLayout(b, l, r)
    else if (l === r || r === b) value = l
    else if (l === b) value = r
    else if (resolution) value = resolution === "local" ? l : r
    else { conflicts.push(key); value = r }
    if (value !== undefined) merged[key] = value
  }
  return { merged, conflicts: conflicts.sort() }
}

/** What this machine's files should become after a merge. */
export function localTarget(local: Snapshot, merged: Snapshot, keptLocal: readonly LocalEntry[]) {
  const result: Snapshot = {}
  for (const [key, value] of Object.entries(merged)) if (!protectedPath(key, keptLocal)) result[key] = value
  for (const [key, value] of Object.entries(local)) if (protectedPath(key, keptLocal)) result[key] = value
  return result
}
