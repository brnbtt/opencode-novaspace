/** @jsxImportSource @opentui/solid */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
// .tsx selects OpenCode's host-Solid import rewrite for this reactive helper.
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { cardIDList, pinMap } from "./config"
import type { LayoutStore, SharedLayout } from "./layout"

function parse(text: string): SharedLayout | undefined {
  const value = JSON.parse(text) as Record<string, unknown>
  if (!value || typeof value !== "object" || value.version !== 1) return undefined
  const layout: SharedLayout = {}
  if (Array.isArray(value.cards)) layout.cards = cardIDList(value.cards)
  if (value.pins && typeof value.pins === "object") layout.pins = pinMap(value.pins)
  if (Array.isArray(value.hidden)) layout.hidden = cardIDList(value.hidden)
  return layout
}

function stamp(path: string) {
  try { return statSync(path).mtimeMs } catch { return undefined }
}

function read(path: string): SharedLayout | undefined {
  try { return parse(readFileSync(path, "utf8")) } catch { return undefined }
}

function write(path: string, layout: SharedLayout) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify({ version: 1, ...layout }, null, 2)}\n`)
  renameSync(temp, path)
}

/**
 * The sidebar arrangement as a small JSON file in the novaSpace folder, so card
 * sync can carry it between machines. Changes made elsewhere (another window,
 * or a sync) are picked up by polling the file's modification time.
 */
export function createLayoutFile(path: string, seed: SharedLayout = {}, options: { poll?: number } = {}) {
  const existing = read(path)
  const [state, setState] = createStore<SharedLayout>(existing ?? structuredClone(seed))
  if (!existing && (seed.cards || seed.pins || seed.hidden)) {
    try { write(path, seed) } catch { /* Saved again on the next edit. */ }
  }
  let seen = stamp(path)
  const reload = (force = false) => {
    const current = stamp(path)
    if (!force && current === seen) return
    seen = current
    setState(reconcile(read(path) ?? {}))
  }
  const timer = setInterval(() => reload(), options.poll ?? 2_000)
  const store: LayoutStore<SharedLayout> = [state, async (update) => {
    setState(produce(update))
    write(path, structuredClone(unwrap(state)))
    seen = stamp(path)
  }]
  return { store, reload, dispose: () => clearInterval(timer) }
}
