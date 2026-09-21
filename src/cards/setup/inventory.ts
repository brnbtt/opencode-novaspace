import { readdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Location, TuiContext } from "../../types"

export type InventoryItem = {
  name: string
  detail?: string
  state?: "success" | "warning" | "muted"
  target?: SetupTarget
}

export type SetupSectionKey = "skills" | "instructions" | "plugins" | "mcp" | "agents"

export type SetupTarget = {
  path: string
  kind: "folder" | "file"
}

export type SetupInventory = {
  skills: InventoryItem[]
  instructions: InventoryItem[]
  plugins: InventoryItem[]
  mcp: InventoryItem[]
  agents: InventoryItem[]
  targets: Partial<Record<SetupSectionKey, SetupTarget>>
  files: Partial<Record<SetupSectionKey, SetupTarget[]>>
  settings?: SetupTarget
  terminalSettings?: SetupTarget
}

export type SetupSection = {
  key: SetupSectionKey
  icon: string
  label: string
  count: number
  status: string
  empty: string
  healthy?: boolean
  target?: SetupTarget
  files: SetupTarget[]
  items: InventoryItem[]
  itemLabel: string
  listTitle: string
}

export type SetupSectionGroup = {
  key: string
  sections: SetupSection[]
  target?: SetupTarget
  files: SetupTarget[]
}

const builtInAgents = new Set(["build", "general", "explore", "compaction", "title", "summary", "plan"])

async function within<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function status(value: { status?: { status?: string } | string }) {
  return typeof value.status === "string" ? value.status : value.status?.status ?? "unknown"
}

function modelLabel(model?: { id?: string; providerID?: string; variant?: string }) {
  if (!model?.id) return undefined
  return `${model.providerID ? `${model.providerID}/` : ""}${model.id}${model.variant ? ` · ${model.variant}` : ""}`
}

async function syncCollections(ctx: TuiContext, location: Location) {
  const collections = [
    ctx.data.location.skill,
    ctx.data.location.agent,
    ctx.data.location.mcp?.server,
  ]
  await Promise.allSettled(collections.flatMap((collection) => collection?.sync
    ? [within(collection.sync(location), 5_000, "Customization inventory")]
    : []))
}

async function firstExisting(paths: (string | undefined)[], kind: SetupTarget["kind"]): Promise<SetupTarget | undefined> {
  for (const path of [...new Set(paths.filter((value): value is string => !!value))]) {
    try {
      const info = await stat(path)
      if ((kind === "folder" && info.isDirectory()) || (kind === "file" && info.isFile())) return { path, kind }
    } catch {
      // Configuration sources are optional.
    }
  }
}

async function existingFiles(paths: (string | undefined)[]): Promise<SetupTarget[]> {
  const files: (SetupTarget | undefined)[] = await Promise.all([...new Set(paths.filter((value): value is string => !!value))].map(async (path): Promise<SetupTarget | undefined> => {
    try {
      return (await stat(path)).isFile() ? { path, kind: "file" as const } : undefined
    } catch {
      return undefined
    }
  }))
  return files.filter((file): file is SetupTarget => file !== undefined)
}

const ignoredFolders = new Set([".git", "node_modules", "backups"])

async function filesUnder(target?: SetupTarget): Promise<SetupTarget[]> {
  if (!target || target.kind !== "folder") return []
  const files: SetupTarget[] = []
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".DS_Store" || ignoredFolders.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() || entry.isSymbolicLink()) files.push({ path, kind: "file" })
    }
  }
  await visit(target.path)
  return files
}

function uniqueTargets(targets: SetupTarget[]) {
  return [...new Map(targets.map((target) => [target.path, target])).values()]
}

function pluginFolder(path?: string) {
  if (!path) return undefined
  return /\.[cm]?[jt]sx?$/.test(path) ? dirname(path) : path
}

function namedFile(files: SetupTarget[], name: string, preferred: string) {
  const normalizedName = name.toLowerCase()
  return files.find((file) => {
    const path = file.path.replaceAll("\\", "/").toLowerCase()
    return path.endsWith(`/${normalizedName}/${preferred.toLowerCase()}`) || path.endsWith(`/${normalizedName}.md`)
  })
}

function pluginTarget(path: string | undefined, settings: SetupTarget | undefined): SetupTarget | undefined {
  if (!path) return settings
  return { path, kind: /\.[cm]?[jt]sx?$/.test(path) ? "file" : "folder" }
}

function cachedSkills(ctx: TuiContext, location: Location): InventoryItem[] {
  return (ctx.data.location.skill?.list(location) ?? []).map((skill) => ({
    name: skill.name ?? skill.id ?? "Unnamed skill",
    detail: skill.description,
    target: skill.location ? { path: skill.location, kind: "file" } : undefined,
  }))
}

function cachedMcp(ctx: TuiContext, location: Location): InventoryItem[] {
  return (ctx.data.location.mcp?.server?.list(location) ?? []).map((server) => ({
    name: server.name ?? "Unnamed MCP",
    detail: status(server),
    state: status(server) === "connected" ? "success" : "warning",
  }))
}

function cachedAgents(ctx: TuiContext, location: Location): InventoryItem[] {
  return (ctx.data.location.agent?.list(location) ?? [])
    .filter((agent) => agent.id && !builtInAgents.has(agent.id))
    .map((agent) => ({
      name: agent.id!,
      detail: [modelLabel(agent.model), agent.description].filter(Boolean).join(" · "),
    }))
}

/** A useful first frame from OpenCode's local cache; network and sync setup are optional enrichment. */
export function cachedSetupInventory(ctx: TuiContext): SetupInventory {
  const location = ctx.data.location.default()
  return {
    skills: cachedSkills(ctx, location),
    instructions: [],
    plugins: [],
    mcp: cachedMcp(ctx, location),
    agents: cachedAgents(ctx, location),
    targets: {},
    files: {},
  }
}

export async function loadSetupInventory(ctx: TuiContext, options: { home?: string } = {}): Promise<SetupInventory> {
  const location = ctx.data.location.default()
  await syncCollections(ctx, location)
  const pluginRequest = ctx.client.plugin?.list({ location })
  const configRequest = ctx.client.config?.get({ location })
  const [pluginResult, configResult] = await Promise.allSettled([
    pluginRequest ? within(pluginRequest, 5_000, "Plugin inventory") : Promise.resolve(undefined),
    configRequest ? within(configRequest, 5_000, "Configuration inventory") : Promise.resolve(undefined),
  ])
  const plugins = pluginResult.status === "fulfilled" ? pluginResult.value?.data ?? [] : []
  const configs = configResult.status === "fulfilled" ? configResult.value?.data ?? [] : []
  const home = options.home ?? process.env.HOME
  const globalConfigFolder = home ? join(options.home ? join(home, ".config") : process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode") : undefined
  const documentPaths = configs
    .filter((config) => config.type === "document" && config.path)
    .map((config) => config.path!)
  const settings = await firstExisting([
    documentPaths.find((path) => globalConfigFolder && dirname(path) === globalConfigFolder),
    globalConfigFolder && join(globalConfigFolder, "opencode.jsonc"),
    globalConfigFolder && join(globalConfigFolder, "opencode.json"),
    ...documentPaths,
  ], "file")
  const settingsFolder = settings ? dirname(settings.path) : globalConfigFolder
  const globalInstructions = globalConfigFolder ? join(globalConfigFolder, "AGENTS.md") : undefined
  const instructionFiles = await existingFiles([join(location.directory, "AGENTS.md"), globalInstructions])
  const instructionFile = instructionFiles[0]
  const mcp = ctx.data.location.mcp?.server?.list(location) ?? []
  const agents = (ctx.data.location.agent?.list(location) ?? []).filter((agent) => agent.id && !builtInAgents.has(agent.id))

  const [skillsTarget, instructionsTarget, pluginsFolder, agentsFolder, settingsFolderTarget] = await Promise.all([
    firstExisting([
      join(location.directory, ".opencode/skills"),
      join(location.directory, ".agents/skills"),
      join(location.directory, ".claude/skills"),
      globalConfigFolder && join(globalConfigFolder, "skills"),
      home && join(home, ".agents/skills"),
      home && join(home, ".claude/skills"),
    ], "folder"),
    firstExisting([instructionFile && dirname(instructionFile.path), settingsFolder], "folder"),
    firstExisting([
      join(location.directory, ".opencode/plugins"),
      globalConfigFolder && join(globalConfigFolder, "plugins"),
      ...plugins.map((plugin) => pluginFolder(plugin.source?.path)),
    ], "folder"),
    firstExisting([
      join(location.directory, ".opencode/agents"),
      globalConfigFolder && join(globalConfigFolder, "agents"),
    ], "folder"),
    firstExisting([settingsFolder], "folder"),
  ])
  const pluginsTarget = pluginsFolder ?? settingsFolderTarget
  const agentsTarget = agentsFolder ?? settingsFolderTarget
  const [skillsFiles, pluginFiles, agentFiles] = await Promise.all([
    within(filesUnder(skillsTarget), 5_000, "Skill file inventory"),
    within(filesUnder(pluginsFolder), 5_000, "Plugin file inventory"),
    within(filesUnder(agentsFolder), 5_000, "Subagent file inventory"),
  ])
  const settingsFile = settings ? [settings] : []

  return {
    skills: (ctx.data.location.skill?.list(location) ?? []).map((skill) => {
      const name = skill.name ?? skill.id ?? "Unnamed skill"
      const locationTarget = skill.location ? { path: skill.location, kind: "file" as const } : undefined
      return { name, detail: skill.description, target: locationTarget ?? namedFile(skillsFiles, skill.id ?? name, "SKILL.md") }
    }),
    instructions: instructionFiles.map((file) => ({ name: "AGENTS.md", detail: file.path, target: file })),
    plugins: plugins.filter((plugin) => plugin.source?.type !== "builtin").map((plugin) => ({
      name: plugin.id,
      detail: [plugin.features?.server ? "server" : undefined, plugin.features?.tui ? "TUI" : undefined, plugin.source?.path ?? plugin.source?.target]
        .filter(Boolean).join(" · "),
      state: plugin.state?.status === "active" ? "success" : "warning",
      target: pluginTarget(plugin.source?.path, settings),
    })),
    mcp: mcp.map((server) => ({
      name: server.name ?? "Unnamed MCP",
      detail: status(server),
      state: status(server) === "connected" ? "success" : "warning",
      target: settings,
    })),
    agents: agents.map((agent) => ({
      name: agent.id!,
      detail: [modelLabel(agent.model), agent.description].filter(Boolean).join(" · "),
      target: namedFile(agentFiles, agent.id!, `${agent.id}.md`) ?? settings,
    })),
    targets: {
      skills: skillsTarget,
      instructions: instructionsTarget,
      plugins: pluginsTarget,
      mcp: settingsFolderTarget,
      agents: agentsTarget,
    },
    files: {
      skills: skillsFiles,
      instructions: instructionFiles,
      plugins: uniqueTargets([...pluginFiles, ...(plugins.length ? settingsFile : [])]),
      mcp: mcp.length ? settingsFile : [],
      agents: uniqueTargets([...agentFiles, ...(agents.length ? settingsFile : [])]),
    },
    settings,
    terminalSettings: await firstExisting([globalConfigFolder && join(globalConfigFolder, "cli.json")], "file"),
  }
}

export function setupSections(inventory: SetupInventory): SetupSection[] {
  const connectedMcp = inventory.mcp.filter((item) => item.state === "success").length
  return [
    { key: "skills", icon: "✦", label: "Skills", count: inventory.skills.length, status: "ready", empty: "No skills installed", target: inventory.targets.skills, files: inventory.files.skills ?? [], items: inventory.skills, itemLabel: "Skill", listTitle: "Available skills" },
    { key: "instructions", icon: "▤", label: "Instructions", count: inventory.instructions.length, status: "active", empty: "No instruction sources detected", target: inventory.targets.instructions, files: inventory.files.instructions ?? [], items: inventory.instructions, itemLabel: "Instruction", listTitle: "Instruction sources" },
    { key: "plugins", icon: "◆", label: "Plugins", count: inventory.plugins.length, status: "active", empty: "No custom plugins installed", target: inventory.targets.plugins, files: inventory.files.plugins ?? [], items: inventory.plugins, itemLabel: "Plugin", listTitle: "Configured plugins" },
    {
      key: "mcp", icon: "↔", label: "MCP", count: connectedMcp,
      status: connectedMcp === inventory.mcp.length ? "connected" : `of ${inventory.mcp.length}`,
      empty: "No MCP servers installed", healthy: inventory.mcp.length > 0 && connectedMcp === inventory.mcp.length,
      target: inventory.targets.mcp, files: inventory.files.mcp ?? [], items: inventory.mcp, itemLabel: "MCP", listTitle: "MCP servers",
    },
    { key: "agents", icon: "◇", label: "Subagents", count: inventory.agents.length, status: "available", empty: "No custom subagents configured", target: inventory.targets.agents, files: inventory.files.agents ?? [], items: inventory.agents, itemLabel: "Subagent", listTitle: "Available subagents" },
  ]
}

export function groupSetupSections(sections: SetupSection[]): SetupSectionGroup[] {
  const parent = sections.map((_, index) => index)
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!))
  const union = (left: number, right: number) => { parent[find(right)] = find(left) }
  for (let left = 0; left < sections.length; left++) {
    const leftFiles = new Set(sections[left]!.files.map((file) => file.path))
    for (let right = left + 1; right < sections.length; right++) {
      if (sections[right]!.files.some((file) => leftFiles.has(file.path))) union(left, right)
    }
  }

  const grouped = new Map<number, SetupSection[]>()
  sections.forEach((section, index) => {
    const root = find(index)
    grouped.set(root, [...(grouped.get(root) ?? []), section])
  })
  return [...grouped.values()].map((items) => {
    const fileCounts = new Map<string, number>()
    const files = [...new Map(items.flatMap((item) => item.files).map((file) => [file.path, file])).values()]
    for (const item of items) for (const file of item.files) fileCounts.set(file.path, (fileCounts.get(file.path) ?? 0) + 1)
    const shared = files.find((file) => (fileCounts.get(file.path) ?? 0) > 1)
    return {
      key: items.map((item) => item.key).join("-"),
      sections: items,
      target: items.length > 1 && shared ? { path: dirname(shared.path), kind: "folder" } : items[0]?.target,
      files,
    }
  })
}

export function emptyInventory(): SetupInventory {
  return {
    skills: [], instructions: [], plugins: [], mcp: [], agents: [], targets: {}, files: {},
  }
}
