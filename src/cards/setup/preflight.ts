import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Location, TuiContext } from "../../types"

export type PreflightPath = {
  name: string
  path: string
  detail?: string
}

export type PreflightMove = {
  from: string
  to: string
  files: number
  detail: string
}

export type StandardizationPreflight = {
  root: string
  moves: PreflightMove[]
  ready: PreflightPath[]
  warnings: PreflightPath[]
  blockers: PreflightPath[]
  excluded: PreflightPath[]
  project: PreflightPath[]
}

async function pathKind(path: string) {
  try {
    const info = await stat(path)
    return info.isDirectory() ? "folder" : info.isFile() ? "file" : undefined
  } catch {
    return undefined
  }
}

async function countFiles(path: string): Promise<number> {
  if (await pathKind(path) !== "folder") return 0
  let count = 0
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === ".git" || entry.name === "node_modules") continue
      if (entry.isDirectory()) await visit(join(directory, entry.name))
      else if (entry.isFile() || entry.isSymbolicLink()) count++
    }
  }
  await visit(path)
  return count
}

function inside(path: string, root: string) {
  const value = relative(root, path)
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}

async function projectRoot(ctx: TuiContext, location: Location) {
  try {
    const result = await ctx.client.vcs.get({ location }, { signal: new AbortController().signal })
    return result.location.project?.directory ?? location.directory
  } catch {
    return location.directory
  }
}

async function projectSources(ctx: TuiContext, globalRoot: string) {
  const location = ctx.data.location.default()
  const root = await projectRoot(ctx, location)
  const directories: string[] = []
  let current = resolve(location.directory)
  const boundary = resolve(root)
  while (inside(current, boundary)) {
    directories.push(current)
    if (current === boundary) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  const candidates: [string, string][] = directories.flatMap((directory) => [
    ["OpenCode config", join(directory, "opencode.jsonc")],
    ["OpenCode config", join(directory, "opencode.json")],
    ["OpenCode config", join(directory, ".opencode/opencode.jsonc")],
    ["OpenCode config", join(directory, ".opencode/opencode.json")],
    ["Instructions", join(directory, "AGENTS.md")],
    ["Skills", join(directory, ".opencode/skills")],
    ["Skills", join(directory, ".agents/skills")],
    ["Skills", join(directory, ".claude/skills")],
    ["Subagents", join(directory, ".opencode/agents")],
    ["Commands", join(directory, ".opencode/commands")],
    ["Plugins", join(directory, ".opencode/plugins")],
  ])
  const configResult = await ctx.client.config?.get({ location }).catch(() => undefined)
  for (const document of configResult?.data ?? []) {
    if (document.type === "document" && document.path && !inside(document.path, globalRoot)) {
      candidates.push(["OpenCode config", document.path])
    }
  }

  const found: (PreflightPath | undefined)[] = await Promise.all(candidates.map(async ([name, path]): Promise<PreflightPath | undefined> => await pathKind(path)
    ? { name, path, detail: "Project-owned · not synced with profile" }
    : undefined))
  return [...new Map(found.filter((item): item is PreflightPath => item !== undefined).map((item) => [item.path, item])).values()]
}

async function inspectPortableConfig(path: string, warnings: PreflightPath[], blockers: PreflightPath[]) {
  const text = await readFile(path, "utf8").catch(() => "")
  if (!text) return
  const absolutePaths = [...text.matchAll(/"(\/(?:Users|home)\/[^"\n]+)"/g)].map((match) => match[1]!)
  for (const value of [...new Set(absolutePaths)]) {
    warnings.push({ name: "Machine-specific path", path, detail: value })
  }
  const secrets = [...text.matchAll(/"(api[_-]?key|token|secret|password|authorization)"\s*:\s*"([^"\n]+)"/gi)]
    .filter((match) => !match[2]!.includes("{env:"))
  for (const match of secrets) {
    blockers.push({ name: `Possible literal secret: ${match[1]}`, path, detail: "Replace it with an environment reference before syncing" })
  }
}

export async function loadStandardizationPreflight(ctx: TuiContext): Promise<StandardizationPreflight> {
  const home = process.env.HOME
  const root = join(process.env.XDG_CONFIG_HOME ?? (home ? join(home, ".config") : ".config"), "opencode")
  const ready: PreflightPath[] = []
  const warnings: PreflightPath[] = []
  const blockers: PreflightPath[] = []
  const excluded: PreflightPath[] = []
  const moves: PreflightMove[] = []

  const standard = [
    ["OpenCode settings", join(root, "opencode.jsonc")],
    ["OpenCode settings", join(root, "opencode.json")],
    ["Terminal settings", join(root, "cli.json")],
    ["Instructions", join(root, "AGENTS.md")],
    ["Skills", join(root, "skills")],
    ["Subagents", join(root, "agents")],
    ["Commands", join(root, "commands")],
    ["Plugins", join(root, "plugins")],
  ] as const
  for (const [name, path] of standard) {
    if (await pathKind(path)) ready.push({ name, path })
  }

  if (home) {
    for (const from of [join(home, ".agents/skills"), join(home, ".claude/skills")]) {
      if (await pathKind(from) !== "folder") continue
      const to = join(root, "skills")
      const targetExists = await pathKind(to) === "folder"
      moves.push({
        from,
        to,
        files: await countFiles(from),
        detail: targetExists ? "Merge review required; canonical skills folder already exists" : "Move into OpenCode's canonical global skills folder",
      })
    }
  }

  const service = join(root, "service.json")
  if (await pathKind(service)) excluded.push({ name: "Shared service configuration", path: service, detail: "Machine-local and may contain authentication" })
  const backups = join(root, "backups")
  if (await pathKind(backups)) excluded.push({ name: "Backups", path: backups, detail: "Local rollback data" })

  for (const config of ready.filter((item) => item.name === "OpenCode settings" || item.name === "Terminal settings")) {
    await inspectPortableConfig(config.path, warnings, blockers)
  }

  return {
    root,
    moves,
    ready,
    warnings,
    blockers,
    excluded,
    project: await projectSources(ctx, root),
  }
}

export function preflightStatus(preflight: StandardizationPreflight) {
  if (preflight.blockers.length) return "Blocked"
  if (preflight.moves.length || preflight.warnings.length) return "Needs review"
  return "Ready"
}
