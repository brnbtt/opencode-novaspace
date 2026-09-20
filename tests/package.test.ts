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

test("uses OpenCode V2 resolved theme tokens", async () => {
  const root = new URL("../src", import.meta.url).pathname
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root })) files.push(file)
  const source = await Promise.all(files.map((file) => Bun.file(`${root}/${file}`).text()))
  const shipped = source.join("\n")
  expect(shipped).not.toMatch(/\.theme\.(?:text\.(?:default|subdued)|background\.default)/)
  expect(shipped).not.toMatch(/\.theme\.(?:text\.)?feedback\.(?:info|warning|success|error)\.default/)
})

test("uses the host renderer for installed-package dimensions", async () => {
  const root = new URL("../src", import.meta.url).pathname
  const consumers = ["carousel.tsx", "drag-overlay.tsx", "cards/setup/modal.tsx", "cards/setup/sync-onboarding.tsx"]
  for (const file of consumers) {
    const source = await Bun.file(`${root}/${file}`).text()
    expect(source).toContain("useHostDimensions")
    expect(source).not.toContain('from "@opentui/solid"')
  }
})

test("documents installation and keeps card options in cli.json", async () => {
  const readme = await Bun.file(new URL("../README.md", import.meta.url).pathname).text()
  expect(readme).toContain("## Installation")
  expect(readme).toContain("opencode plugin add")
  // TUI plugins only receive options from cli.json; opencode.json(c) silently drops them.
  const configSection = readme.slice(readme.indexOf("## Configuration"), readme.indexOf("## Development"))
  expect(configSection).toContain("cli.json")
  expect(configSection).not.toMatch(/```jsonc\n\{\n  "plugins"/)
})

test("keeps host runtime peers optional so installs stay single-runtime", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url).pathname).json()
  // A materialized copy of these beside the plugin gives it a second Solid
  // runtime: the sidebar then renders one frame and never reacts again.
  for (const peer of ["@opentui/core", "@opentui/solid", "solid-js"]) {
    expect(manifest.peerDependencies[peer]).toBeString()
    expect(manifest.peerDependenciesMeta?.[peer]?.optional).toBe(true)
  }
})
