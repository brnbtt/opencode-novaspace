import { expect, test } from "bun:test"
import serverPlugin from "../src/index"

test("ships a TUI-only package without bundled OptMem tools", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
  expect(manifest.name).toBe("opencode-novaspace")
  expect(manifest.exports["./tui"]).toBe("./tui.tsx")
  expect(serverPlugin.id).toBe("novaspace")
  expect(serverPlugin.setup()).toBeUndefined()
  expect(await Bun.file(new URL("../src/cards/memory/tools.ts", import.meta.url)).exists()).toBe(false)
})

test("pins the OpenTUI JSX runtime in every shipped TSX module", async () => {
  const root = new URL("..", import.meta.url).pathname
  const files: string[] = []
  for await (const file of new Bun.Glob("src/**/*.tsx").scan({ cwd: root })) files.push(file)
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const firstLine = (await Bun.file(`${root}/${file}`).text()).split("\n", 1)[0]
    expect(firstLine).toBe("/** @jsxImportSource @opentui/solid */")
  }
})
