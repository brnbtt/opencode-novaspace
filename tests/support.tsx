import type { JSX } from "solid-js"
import type { TuiContext } from "../src/types"

export const theme = {
  background: { default: "#102030", action: { primary: { hovered: "#90a0b0" } } },
  text: {
    default: "#eeeeee", subdued: "#aaaaaa", action: { primary: { hovered: "#ffffff" } },
    feedback: {
      info: { default: "#00aaff" }, warning: { default: "#ffaa00" },
      success: { default: "#00cc66" }, error: { default: "#ff4444" },
    },
  },
}

export function collection<T>(items: T[]) {
  return { async sync() {}, list: () => items }
}

export function context(dialogRender?: (render: () => JSX.Element) => void): TuiContext {
  const session = {
    id: "session",
    cost: 2.36,
    agent: "build",
    model: { id: "gpt-5.6-sol", providerID: "github-copilot", variant: "high" },
    location: { directory: "/Users/example/DEV" },
    tokens: { input: 168_611, output: 10_881, cache: { read: 3_000_000 } },
  }
  return {
    app: { version: "2.0.7" },
    options: {},
    theme,
    client: {
      vcs: {
        async get() { return { location: { ...session.location, project: { directory: session.location.directory, canonical: session.location.directory } }, data: { branch: { current: "main" } } } },
        async status() { return { location: { ...session.location, project: { directory: session.location.directory, canonical: session.location.directory } }, data: [] } },
      },
      plugin: { async list() { return { data: [
        { id: "opencode.core", source: { type: "builtin" } },
        { id: "novaspace.server", source: { type: "local", path: "/plugins/novaspace" }, features: { server: true, tui: true }, state: { status: "active" } },
      ] } } },
      config: { async get() { return { data: [{
        type: "document",
        path: "/Users/example/.config/opencode/opencode.jsonc",
        info: {
          model: { providerID: "github-copilot", model: "gpt-5.6-sol" },
          update: "auto",
          formatter: true,
          websearch: { provider: "parallel" },
          worktree: { directory: "/Users/example/DEV/worktrees" },
          permissions: [{ action: "browser", resource: "*", effect: "deny" }],
          providers: { "github-copilot": {} },
        },
      }] } } },
    },
    data: {
      location: {
        default: () => session.location,
        skill: collection(Array.from({ length: 10 }, (_, index) => ({ id: `skill-${index}`, name: `skill-${index}`, description: `Skill ${index}` }))),
        agent: collection([
          { id: "build" },
          { id: "advisor", mode: "subagent", model: { id: "gpt-6-astra", providerID: "github-copilot", variant: "max" } },
          { id: "deep-sol", mode: "subagent", model: { id: "gpt-5.6-sol", providerID: "github-copilot", variant: "max" } },
          { id: "deep-opus", mode: "subagent" },
          { id: "fast-gemini", mode: "subagent" },
        ]),
        command: collection([{ name: "init" }, { name: "review" }]),
        provider: collection([{ id: "github-copilot", name: "GitHub Copilot" }]),
        reference: collection([]),
        model: collection([{ id: "gpt-5.6-sol", providerID: "github-copilot", limit: { context: 1_050_000 } }]),
        mcp: { server: collection([
          { name: "agency-gateway", status: { status: "connected" } },
          { name: "playwright", status: { status: "connected" } },
        ]) },
      },
      session: {
        get: () => session,
        list: () => [session],
        root: () => session.id,
        family: () => [session.id],
        status: () => ({ type: "idle" }),
      },
    },
    ui: {
      slot: () => () => {},
      router: { navigate() {} },
      toast: { show() {} },
      format: { path: (value) => value.replace("/Users/example", "~") },
      dialog: {
        set() {},
        show(render) { dialogRender?.(render) },
        clear() {},
        async select() { return undefined },
      },
    },
  }
}
