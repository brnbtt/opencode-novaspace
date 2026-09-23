import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cards } from "../src/cards/registry"
import type { CardProps } from "../src/card"
import { cardChrome, loadCustomCard, loadCustomCards } from "../src/custom-cards"
import { context } from "./support"

const dir = await mkdtemp(join(tmpdir(), "novaspace-custom-"))
afterAll(() => rm(dir, { recursive: true, force: true }))

// Bun caches directory listings during resolution, so give each module a fresh directory.
async function module(name: string, body: string) {
  const path = join(await mkdtemp(join(dir, "card-")), name)
  await writeFile(path, body)
  return path
}

test("loads a local card module, hands it the card chrome and keeps props reactive", async () => {
  const path = await module("probe.js", `
    export const seen = []
    export default { apiVersion: 1, title: "Probe", render(props) { seen.push(props); return null } }
  `)
  const stop = await loadCustomCard("custom:probe", path)
  try {
    const card = cards()["custom:probe"]!
    expect(card.title).toBe("Probe")
    let session = "one"
    const props = { get sessionID() { return session } } as CardProps
    card.render(props)
    const { seen } = await import(path)
    const received = seen[0]
    expect(received.chrome).toBe(cardChrome)
    session = "two"
    expect(received.sessionID).toBe("two")
  } finally { stop() }
  expect(cards()["custom:probe"]).toBeUndefined()
})

test("skips invalid or missing modules with a toast instead of failing the sidebar", async () => {
  const invalid = await module("invalid.js", `export default { title: "No version", render() { return null } }`)
  const ctx = context()
  const toasts: string[] = []
  ctx.ui.toast.show = (input) => { toasts.push(input.message) }
  ctx.options = { customCards: { "custom:invalid": invalid, "custom:missing": join(dir, "missing.js") } }
  const stop = loadCustomCards(ctx)
  try {
    for (let i = 0; i < 50 && toasts.length < 2; i++) await Bun.sleep(10)
    expect(toasts).toHaveLength(2)
    expect(toasts.find((message) => message.includes("custom:invalid"))).toContain("apiVersion: 1")
    expect(toasts.some((message) => message.includes("custom:missing"))).toBe(true)
    expect(cards()["custom:invalid"]).toBeUndefined()
  } finally { stop() }
})
