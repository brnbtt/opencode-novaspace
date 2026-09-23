import { expect, test } from "bun:test"
import serverPlugin from "../src/index"

test("ships a TUI-only package without bundled OptMem tools", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
  expect(manifest.name).toBe("opencode-novaspace")
  expect(manifest.exports["./tui"]).toBe("./dist/tui.js")
  expect(serverPlugin.id).toBe("novaspace")
  expect(serverPlugin.setup()).toBeUndefined()
  expect(await Bun.file(new URL("../src/cards/memory/tools.ts", import.meta.url)).exists()).toBe(false)
})

test("ships only the built-in cards", async () => {
  const root = new URL("../src/cards", import.meta.url).pathname
  const folders = new Set<string>()
  for await (const file of new Bun.Glob("*/index.tsx").scan({ cwd: root })) folders.add(file.split("/")[0]!)
  expect([...folders].sort()).toEqual(["session-info", "setup"])
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

test("publishes compiled modules the host import rewrite can reach", async () => {
  const root = new URL("..", import.meta.url).pathname
  await Bun.$`bun run build`.cwd(root).quiet()

  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.js").scan({ cwd: `${root}/dist` })) files.push(file)
  expect(files.length).toBeGreaterThan(0)

  const sources = await Promise.all(files.map((file) => Bun.file(`${root}/dist/${file}`).text()))
  const shipped = sources.join("\n")

  // The host shares its Solid/OpenTUI runtime by rewriting specifiers it finds
  // in a module's source text. Under node_modules the JSX transform that would
  // emit them is skipped, so a pragma-only module resolves nothing and a
  // bundled copy resolves a second runtime. Compiled output carries them
  // literally, which is the only form the rewrite recognises.
  expect(shipped).toContain('from "@opentui/solid"')
  expect(shipped).not.toContain("@jsxImportSource")
  for (const source of sources) expect(source).not.toMatch(/<[A-Za-z]/)

  // Relative specifiers must survive as resolvable paths once the .tsx sources
  // are gone from the published tarball.
  for (const specifier of shipped.matchAll(/from\s+"(\.[^"]*)"/g)) {
    expect(specifier[1]).toEndWith(".js")
  }
})
