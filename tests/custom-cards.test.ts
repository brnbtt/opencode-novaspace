import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cards } from "../src/cards/registry"
import type { CardProps } from "../src/card"
import { cardChrome, createCardLibrary, discoverCards, loadCustomCard } from "../src/custom-cards"
import { context } from "./support"

const dir = await mkdtemp(join(tmpdir(), "novaspace-custom-"))
afterAll(() => rm(dir, { recursive: true, force: true }))

// Bun caches directory listings during resolution, so give each test a fresh folder.
async function folder() {
  return mkdtemp(join(dir, "cards-"))
}
async function card(root: string, name: string, body: string) {
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, "index.js"), body)
}
const valid = (title: string) => `export default { apiVersion: 1, title: ${JSON.stringify(title)}, render() { return null } }`
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10)
  expect(check()).toBe(true)
}

test("finds card folders with an index.js and ignores everything else", async () => {
  const root = await folder()
  await card(root, "subagents", valid("Subagents"))
  await card(root, "working-set", valid("Working Set"))
  await card(root, "Bad-Name", valid("Bad"))
  await card(root, "_lib", valid("Helper"))
  await mkdir(join(root, "empty"))
  await writeFile(join(root, "shared.js"), "export const x = 1")
  expect((await discoverCards(root)).map((found) => found.id)).toEqual(["custom:subagents", "custom:working-set"])
  expect(await discoverCards(join(root, "missing"))).toEqual([])
})

test("loads a card module, hands it the card chrome and keeps props reactive", async () => {
  const root = await folder()
  await card(root, "probe", `
    export const seen = []
    export default { apiVersion: 1, title: "Probe", render(props) { seen.push(props); return null } }
  `)
  const path = join(root, "probe", "index.js")
  const stop = await loadCustomCard("custom:probe", path)
  try {
    const loaded = cards()["custom:probe"]!
    expect(loaded.title).toBe("Probe")
    let session = "one"
    loaded.render({ get sessionID() { return session } } as CardProps)
    const { seen } = await import(path)
    expect(seen[0].chrome).toBe(cardChrome)
    expect(typeof seen[0].chrome.Meter).toBe("function")
    session = "two"
    expect(seen[0].sessionID).toBe("two")
  } finally { stop() }
  expect(cards()["custom:probe"]).toBeUndefined()
})

test("the library follows the folder: new cards load, removed ones unload, broken ones are reported once", async () => {
  const root = await folder()
  await card(root, "alpha", valid("Alpha"))
  await card(root, "broken", `export default { title: "No version", render() { return null } }`)
  const ctx = context()
  const toasts: string[] = []
  ctx.ui.toast.show = (input) => { toasts.push(input.message) }
  const library = createCardLibrary(ctx, root, { poll: 60_000 })
  try {
    await until(() => !!cards()["custom:alpha"] && toasts.length === 1)
    expect(toasts[0]).toContain("Could not load card broken")
    expect(toasts[0]).toContain("apiVersion: 1")
    expect(library.found().map((found) => found.name)).toEqual(["alpha", "broken"])

    await card(root, "beta", valid("Beta"))
    await library.refresh()
    await until(() => !!cards()["custom:beta"])
    expect(toasts).toHaveLength(1)

    // A changed card keeps its loaded code until restart, and says so once.
    const later = new Date(Date.now() + 5_000)
    await utimes(join(root, "alpha", "index.js"), later, later)
    await library.refresh()
    await library.refresh()
    expect(toasts.filter((message) => message.includes("alpha changed"))).toHaveLength(1)

    await rm(join(root, "alpha"), { recursive: true })
    await library.refresh()
    expect(cards()["custom:alpha"]).toBeUndefined()
    expect(cards()["custom:beta"]?.title).toBe("Beta")
  } finally { library.dispose() }
  expect(cards()["custom:beta"]).toBeUndefined()
})
