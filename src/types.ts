import type { CliRenderer, RGBA } from "@opentui/core"
import type { JSX } from "solid-js"

export type Color = string | RGBA
export type Location = { directory: string; workspaceID?: string }

export type Session = {
  id: string
  parentID?: string
  title?: string
  outcome?: string
  agent?: string
  cost?: number
  model?: { id: string; providerID: string; variant?: string }
  revert?: { messageID: string }
  location: Location
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  time?: { created?: number; updated?: number; idle?: number }
}

export type SessionMessage = {
  id: string
  type: string
  status?: string
  model?: Session["model"]
  tokens?: Session["tokens"]
}

export type Theme = {
  border?: { base: Color }
  scrollbar?: { base: Color }
  background: {
    base: Color
    action: { primary: { hovered: Color } }
  }
  text: {
    base: Color
    muted: Color
    action: { primary: { hovered: Color } }
    feedback: {
      info: { base: Color }
      warning: { base: Color }
      success: { base: Color }
      error: { base: Color }
    }
  }
}

type Response<T> = {
  location: Location & { project: { directory: string; canonical: string } }
  data: T
}

type LocationCollection<T> = {
  sync?(location: Location): Promise<void>
  list(location: Location): readonly T[] | undefined
}

export type TuiContext = {
  renderer?: Pick<CliRenderer, "clearSelection">
  keymap?: {
    layer(input: () => { mode?: string; priority?: number; commands: { bind: string; enabled?: () => boolean; run(): void | false }[] }): void
  }
  options?: unknown
  app?: { version?: string }
  storage?: {
    store<T extends object>(key: string, options: { initial: T }): [T, (update: (draft: T) => void) => Promise<void>]
  }
  client: {
    vcs: {
      get(input: { location: Location }, options?: { signal: AbortSignal }): Promise<Response<{ branch: { current?: string } }>>
      status(input: { location: Location }, options?: { signal: AbortSignal }): Promise<Response<readonly { file: string }[]>>
    }
    plugin?: {
      list(input: { location: Location }): Promise<{ data: readonly {
        id: string
        source?: { type?: string; path?: string; package?: string }
        features?: { server?: boolean; tui?: boolean }
        state?: { status?: string }
      }[] }>
    }
    config?: {
      get(input: { location: Location }): Promise<{ data: readonly {
        type?: string
        path?: string
        info?: {
          model?: { providerID?: string; model?: string }
          update?: string
          formatter?: boolean
          websearch?: { provider?: string }
          worktree?: { directory?: string }
          permissions?: readonly { action?: string; resource?: string; effect?: string }[]
          providers?: Record<string, unknown>
          references?: Record<string, unknown>
        }
      }[] }>
    }
  }
  data: {
    location: {
      default(): Location
      vcs?: { info(location: Location): { branch: { current?: string } } | undefined }
      skill?: LocationCollection<{ id?: string; name?: string; description?: string; location?: string }>
      agent?: LocationCollection<{
        id?: string
        description?: string
        mode?: string
        model?: { id?: string; providerID?: string; variant?: string }
      }>
      command?: LocationCollection<{ name?: string; description?: string }>
      model?: LocationCollection<{ id?: string; providerID?: string; limit?: { context?: number } }>
      provider?: LocationCollection<{ id?: string; name?: string }>
      reference?: LocationCollection<{ name?: string; description?: string }>
      mcp?: { server?: LocationCollection<{ name?: string; status?: { status?: string } | string; error?: string }> }
    }
    session: {
      get(id: string): Session | undefined
      list(): readonly Session[]
      root(id: string): string | undefined
      family(id: string): readonly string[] | undefined
      status(id: string): { type: string } | undefined
      cost?(id: string): number
      message?: { list(id: string): readonly SessionMessage[] | undefined }
    }
  }
  theme: Theme
  ui: {
    slot(input: ({ append: "sidebar.content" | "app" } | { replace: "sidebar.content" | "sidebar.footer" }) & {
      render(props: { sessionID: string }): JSX.Element
    }): () => void
    router: { navigate(input: { type: "session"; sessionID: string }): void }
    toast: { show(input: { title?: string; message: string; variant?: "success" | "error" | "warning" | "info" }): void }
    format?: { path(value: string): string }
    dialog: {
      set(input: { size?: "small" | "medium" | "large"; centered?: boolean }): void
      show(render: () => JSX.Element, onClose?: () => void): void
      clear(): void
      select<T>(input: {
        title: string
        options: { title: string; value: T; description?: string; disabled?: boolean }[]
      }): Promise<T | undefined>
    }
  }
}
