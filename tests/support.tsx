import type { JSX } from "solid-js"
import type { TuiContext } from "../src/types"

export const theme = {
  background: { base: "#102030", action: { primary: { hovered: "#90a0b0" } } },
  text: {
    base: "#eeeeee", muted: "#aaaaaa", action: { primary: { hovered: "#ffffff" } },
    feedback: {
      info: { base: "#00aaff" }, warning: { base: "#ffaa00" },
      success: { base: "#00cc66" }, error: { base: "#ff4444" },
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
      plugin: { async list() { return { data: [
        { id: "opencode.core", source: { type: "builtin" } },
        { id: "novaspace", source: { type: "local", path: "/plugins/novaspace" }, features: { server: true, tui: true }, state: { status: "active" } },
      ] } } },
    },
    data: {
      location: {
        default: () => session.location,
        model: collection([{ id: "gpt-5.6-sol", providerID: "github-copilot", limit: { context: 1_050_000 } }]),
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
