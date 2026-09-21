/**
 * Publish-time compilation.
 *
 * OpenCode shares its own Solid/OpenTUI runtime with a plugin by rewriting the
 * plugin's import specifiers. That rewrite operates on the file's source text,
 * and the Solid JSX transform that would otherwise produce those specifiers is
 * skipped for anything under node_modules — where a published package always
 * lands. Shipping raw .tsx therefore resolves a second Solid runtime (no
 * reactivity) or fails outright.
 *
 * Compiling ahead of time emits literal `@opentui/solid` / `solid-js` imports
 * into the published source, which is the form the host rewrite recognises.
 */
import { transformAsync, type PluginItem } from "@babel/core"
import solidPreset from "babel-preset-solid"
import typescriptPreset from "@babel/preset-typescript"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const OUT = join(ROOT, "dist")

const ENTRIES = ["index.ts", "tui.tsx"]
const JSX = /\.[cm]?[jt]sx$/
const TS = /\.[cm]?tsx?$/
const SPECIFIER_PATTERNS = [
  /(from\s+["'])([^"']+)(["'])/g,
  /(import\s+["'])([^"']+)(["'])/g,
  /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
]

const exists = async (path: string) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const isDirectory = async (path: string) => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function collect(dir: string, found: string[] = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await collect(path, found)
    else if (TS.test(entry.name)) found.push(path)
  }
  return found
}

/**
 * `foo.ts` re-exporting `foo.tsx` exists only to keep reactive code on the
 * host's JSX loader. Compiled output has no such split, and both would claim
 * `foo.js`, so the shim is dropped and its name is taken by the .tsx.
 */
async function isShim(path: string) {
  if (!path.endsWith(".ts")) return false
  const sibling = `${path.slice(0, -3)}.tsx`
  if (!(await exists(sibling))) return false
  const body = (await readFile(path, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim()
  return /^export\s+\*\s+from\s+["']\.\/[^"']+["']$/.test(body)
}

async function resolveSpecifier(specifier: string, importer: string) {
  if (!specifier.startsWith(".")) return specifier
  const base = resolve(dirname(importer), specifier)
  const stripped = base.replace(/\.[cm]?tsx?$/, "")
  for (const candidate of [`${stripped}.tsx`, `${stripped}.ts`]) {
    if (await exists(candidate)) return `${specifier.replace(/\.[cm]?tsx?$/, "")}.js`
  }
  if (await isDirectory(base)) {
    for (const candidate of ["index.tsx", "index.ts"]) {
      if (await exists(join(base, candidate))) return `${specifier}/index.js`
    }
  }
  throw new Error(`Unresolved import ${specifier} in ${relative(ROOT, importer)}`)
}

async function rewrite(code: string, importer: string) {
  const edits: Array<[string, string]> = []
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2]!
      if (!specifier.startsWith(".")) continue
      const next = await resolveSpecifier(specifier, importer)
      if (next !== specifier) edits.push([match[0], `${match[1]}${next}${match[3]}`])
    }
  }
  let out = code
  for (const [from, to] of edits) out = out.split(from).join(to)
  return out
}

async function compile(path: string) {
  const source = await readFile(path, "utf8")
  const presets: PluginItem[] = []
  if (JSX.test(path)) presets.push([solidPreset, { moduleName: "@opentui/solid", generate: "universal" }])
  if (TS.test(path)) presets.push([typescriptPreset])
  const result = await transformAsync(source, {
    filename: path,
    configFile: false,
    babelrc: false,
    presets,
  })
  if (!result?.code) throw new Error(`Empty output for ${relative(ROOT, path)}`)
  // No JSX survives the transform, so the pragma is inert and only misleads.
  const code = result.code.replace(/^\s*\/\*\*\s*@jsxImportSource[^*]*\*\/\s*$/gm, "")
  return rewrite(code, path)
}

const sources = [
  ...ENTRIES.map((entry) => join(ROOT, entry)),
  ...(await collect(join(ROOT, "src"))),
]

await rm(OUT, { recursive: true, force: true })

let written = 0
let skipped = 0
for (const path of sources) {
  if (await isShim(path)) {
    skipped += 1
    continue
  }
  const target = join(OUT, relative(ROOT, path).replace(/\.[cm]?tsx?$/, ".js"))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, await compile(path))
  written += 1
}

console.log(`compiled ${written} files to dist/ (${skipped} shims dropped)`)
