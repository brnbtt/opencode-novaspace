import type { TuiContext } from "../../types"

/**
 * The server plugin id novaSpace registers. A package install reports one
 * entry for the pair, carrying both the server and TUI features.
 */
const PLUGIN_ID = "novaspace"

export type UpdateState =
  /** Not resolved yet, or the host did not report this plugin. */
  | { status: "unknown" }
  /** Loaded from a checkout; the host has no version to compare or update. */
  | { status: "local"; path?: string }
  | { status: "current"; target: string; version?: string }
  | { status: "outdated"; target: string; version?: string }
  | { status: "updating"; target: string; version?: string }
  | { status: "error"; message: string }

export function updateSummary(state: UpdateState): { label: string; action?: string; tone: "muted" | "info" | "error" } {
  switch (state.status) {
    case "local":
      return { label: "Local checkout", tone: "muted" }
    case "current":
      return { label: state.version ? `Up to date · v${state.version}` : "Up to date", tone: "muted" }
    case "outdated":
      return { label: state.version ? `v${state.version} installed` : "Update available", action: "Update →", tone: "info" }
    case "updating":
      return { label: "Updating…", tone: "info" }
    case "error":
      return { label: state.message, tone: "error" }
    default:
      return { label: "Version unavailable", tone: "muted" }
  }
}

export function installedVersion(state: UpdateState) {
  return state.status === "current" || state.status === "outdated" || state.status === "updating" ? state.version : undefined
}

function toState(entry?: {
  source?: { type?: string; path?: string; target?: string; version?: string; outdated?: boolean; updating?: boolean }
}): UpdateState {
  const source = entry?.source
  if (!source) return { status: "unknown" }
  if (source.type === "local") return { status: "local", path: source.path }
  if (source.type !== "package" || !source.target) return { status: "unknown" }
  const { target, version } = source
  if (source.updating) return { status: "updating", target, version }
  return { status: source.outdated ? "outdated" : "current", target, version }
}

async function entryFor(ctx: TuiContext) {
  const list = await ctx.client.plugin?.list({ location: ctx.data.location.default() })
  return list?.data.find((plugin) => plugin.id === PLUGIN_ID)
}

/** Read the host's current view without asking it to contact the registry. */
export async function loadUpdateState(ctx: TuiContext): Promise<UpdateState> {
  try {
    return toState(await entryFor(ctx))
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Plugin status unavailable" }
  }
}

/**
 * Ask the host to refresh its registry view, then re-read it. `check` reports
 * every plugin, so the freshly flagged entry is read back from `list`.
 */
export async function checkForUpdate(ctx: TuiContext): Promise<UpdateState> {
  try {
    const current = toState(await entryFor(ctx))
    if (current.status === "local" || current.status === "unknown") return current
    if (!ctx.client.plugin?.check) return current
    await ctx.client.plugin.check({ target: current.status === "error" ? undefined : current.target })
    return toState(await entryFor(ctx))
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Update check failed" }
  }
}

export async function applyUpdate(ctx: TuiContext, target: string): Promise<UpdateState> {
  try {
    if (!ctx.client.plugin?.update) return { status: "error", message: "This OpenCode version cannot update plugins" }
    await ctx.client.plugin.update({ targets: [target] })
    return toState(await entryFor(ctx))
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Update failed" }
  }
}
