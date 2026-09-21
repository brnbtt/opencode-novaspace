/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { TuiContext } from "../../types"
import { Divider, nativeScrollbar, novaMark, useHostDimensions } from "../../ui"
import { SetupActionLink, SetupActions } from "./action"
import { loadStandardizationPreflight, type StandardizationPreflight } from "./preflight"
import { PreflightView } from "./preflight-view"
import { profileSync, type ProfileSync, type SyncState } from "./sync"
import { syncGroups, type SyncGroup } from "./sync-files"

const sources: Record<SyncGroup, string> = {
  settings: "opencode.json(c)", terminal: "cli.json · themes/", skills: "skills/",
  instructions: "AGENTS.md", agents: "agents/ · commands/", plugins: "plugins/",
}
type Page = "files" | "repository" | "sync" | "review" | "layout"

export function SyncOnboardingModal(props: {
  ctx: TuiContext
  loadPreflight?: (ctx: TuiContext) => Promise<StandardizationPreflight>
  engine?: ProfileSync
  onBack(): void
}) {
  const engine = props.engine ?? profileSync
  const dimensions = useHostDimensions(props.ctx)
  const [state, setState] = createSignal<SyncState>()
  const [selected, setSelected] = createSignal<SyncGroup[]>([])
  const [repository, setRepository] = createSignal("")
  const [allowPaths, setAllowPaths] = createSignal(false)
  const [typing, setTyping] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [preview, setPreview] = createSignal<{ files: string[]; blockers: string[]; warnings: string[] }>()
  const [page, setPage] = createSignal<Page>("files")
  const [filePage, setFilePage] = createSignal(0)
  const [preflight, setPreflight] = createSignal<StandardizationPreflight>()
  const [resolution, setResolution] = createSignal<"local" | "remote">()
  let scroll: ScrollBoxRenderable | undefined
  let disposed = false
  const navigate = (next: Page) => { setTyping(false); setPage(next); scroll?.scrollTo(0) }
  const refresh = async () => { const value = await engine.state(); if (!disposed) setState(value) }
  onMount(() => {
    void engine.state().then(async (value) => {
      if (disposed) return
      setState(value); setSelected(value.selected); setAllowPaths(value.allowMachinePaths)
      if (value.repository) { setRepository(value.repository); navigate("sync") }
      else {
        const account = await engine.remote.account()
        if (!disposed) setRepository(`${account}/opencode-profile`)
      }
    }).catch((reason) => { if (!disposed) setError(String(reason)) })
    const timer = setInterval(() => { if (!busy()) void refresh().catch(() => {}) }, 2_000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => { disposed = true })
  createEffect(() => {
    const groups = selected()
    let active = true
    setPreview(undefined); setFilePage(0)
    void engine.preview(groups).then((value) => { if (active) { setPreview(value); setError(undefined) } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    onCleanup(() => { active = false })
  })
  const run = (action: () => Promise<SyncState>, next?: Page) => {
    if (busy()) return
    setBusy(true); setError(undefined)
    void action().then((value) => {
      if (disposed) return
      setState(value)
      if (value.status === "error") setError(value.message)
      else if (next) { if (value.repository) setRepository(value.repository); navigate(next) }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!disposed) setBusy(false) })
  }
  const connect = (create: boolean) => run(() => engine.configure({ repository: repository(), selected: selected(), allowMachinePaths: allowPaths(), create }), "sync")
  const dirty = () => state()?.repository !== repository().trim() || JSON.stringify(state()?.selected) !== JSON.stringify(selected()) || state()?.allowMachinePaths !== allowPaths()
  const ready = () => !!state()?.repository && !dirty() && !busy()
  const notice = () => error() ?? (state()?.status === "error" ? state()?.message : undefined)
  const status = () => busy() ? "Working…" : ({ unconfigured: "Not connected", pending: "Ready", syncing: "Syncing…", synced: "Up to date", paused: "Paused", conflict: "Needs attention", error: "Error" }[state()?.status ?? "unconfigured"])
  const height = () => page() === "repository" ? 17 : page() === "sync" ? state()?.status === "conflict" || resolution() ? 28 : state()?.repository ? 18 : 12 : page() === "layout" ? 28 : 23
  const reviewLayout = () => {
    navigate("layout")
    void (props.loadPreflight ?? loadStandardizationPreflight)(props.ctx).then(setPreflight).catch((reason) => setError(String(reason)))
  }
  return (
    <SetupActions ctx={props.ctx} typing={typing()}>
      <box id="sidebar-sync-onboarding-modal" flexDirection="column" width="100%"
        height={Math.min(height() + (notice() ? 3 : 0), Math.max(10, dimensions().height - 6))}
        paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={props.ctx.theme.background.base}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={props.ctx.theme.text.feedback.info.base}>{novaMark}</text>
            <text fg={props.ctx.theme.text.base}><b>Profile sync</b></text>
          </box>
          <text fg={props.ctx.theme.text.muted}>{status()}</text>
        </box>
        <Show when={notice()}><text id="sync-error" flexShrink={0} maxHeight={4} fg={props.ctx.theme.text.feedback.error.base} wrapMode="word">{notice()}</text></Show>
        <box flexDirection="row" flexShrink={0} gap={1} marginTop={1}>
          <For each={["files", "repository", "sync"] as const}>{(tab) => <SetupActionLink id={`sync-tab-${tab}`} ctx={props.ctx} selected={page() === tab} label={{ files: "Files", repository: "Repository", sync: "Sync" }[tab]} onPress={() => navigate(tab)} />}</For>
        </box>
        <Divider theme={props.ctx.theme} />
        <scrollbox id="setup-sync-onboarding-scroll" ref={(value) => { scroll = value }} flexGrow={1} minHeight={1}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}>
          <box flexDirection="column" gap={1} paddingRight={2}>
            <Show when={page() === "files"}>
              <box flexDirection="column">
                <For each={syncGroups}>{(group) => <box flexDirection="row" justifyContent="space-between" minWidth={0} height={1}>
                  <SetupActionLink id={`sync-group-${group.id}`} ctx={props.ctx} disabled={busy()} label={`${selected().includes(group.id) ? "☑" : "☐"} ${group.label}`} onPress={() => setSelected((value) => value.includes(group.id) ? value.filter((id) => id !== group.id) : [...value, group.id])} />
                  <text minWidth={0} flexShrink={1} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>{sources[group.id]}</text>
                </box>}</For>
              </box>
              <text fg={props.ctx.theme.text.muted}>Shared files sync together.</text>
              <box flexDirection="row" justifyContent="space-between" height={1}>
                <text fg={props.ctx.theme.text.muted}>{preview() ? `${preview()!.files.length} files selected` : "Checking files…"}</text>
                <SetupActionLink id="sync-files-toggle" ctx={props.ctx} label="Review →" onPress={() => navigate("review")} />
              </box>
              <Show when={preview()?.blockers.length}><text fg={props.ctx.theme.text.feedback.error.base}>Possible credentials found · review files</text></Show>
              <Show when={preview()?.warnings.length && !allowPaths()}><SetupActionLink id="sync-path-review" ctx={props.ctx} label={`${preview()?.warnings.length} files need path review →`} onPress={() => navigate("review")} /></Show>
              <Show when={state()?.repository && dirty()} fallback={<Show when={!state()?.repository}><SetupActionLink id="sync-files-next" ctx={props.ctx} label="Continue →" disabled={!selected().length} onPress={() => navigate("repository")} /></Show>}>
                <SetupActionLink id="sync-save-selection" ctx={props.ctx} label="Save selection" disabled={busy() || !selected().length} onPress={() => connect(false)} />
              </Show>
            </Show>
            <Show when={page() === "repository"}>
              <text fg={props.ctx.theme.text.base}><b>Private GitHub repository</b></text>
              <Show when={typing()} fallback={<SetupActionLink id="sync-repository-edit" ctx={props.ctx} label={repository() || "Set owner/repository →"} disabled={busy()} onPress={() => setTyping(true)} />}>
                <input id="sync-repository-input" value={repository()} placeholder="owner/opencode-profile" focused={typing()} onInput={setRepository} onSubmit={() => setTyping(false)} />
                <SetupActionLink id="sync-repository-done" ctx={props.ctx} label="Done ↵" onPress={() => setTyping(false)} />
              </Show>
              <box flexDirection="row" flexWrap="wrap" gap={1}>
                <SetupActionLink id="sync-connect" ctx={props.ctx} label={state()?.repository ? "Save connection" : "Connect existing"} disabled={busy() || !selected().length || typing()} onPress={() => connect(false)} />
                <Show when={!state()?.repository}><SetupActionLink id="sync-create" ctx={props.ctx} label="Create private repository" disabled={busy() || !selected().length || typing()} onPress={() => connect(true)} /></Show>
              </box>
              <text fg={props.ctx.theme.text.muted} wrapMode="word">Use this same repository on your other machines.</text>
            </Show>
            <Show when={page() === "sync"}>
              <Show when={state()?.repository} fallback={<SetupActionLink id="sync-connect-first" ctx={props.ctx} label="Connect a repository →" onPress={() => navigate("repository")} />}>
                <text fg={props.ctx.theme.text.muted} wrapMode="word">{state()?.repository}</text>
                <text fg={props.ctx.theme.text.muted}>{state()?.lastSyncedAt ? `Last sync · ${new Date(state()!.lastSyncedAt!).toLocaleString()}` : "Not synced yet"}</text>
                <Show when={dirty()}><SetupActionLink id="sync-unsaved" ctx={props.ctx} label="Save selection before syncing →" onPress={() => navigate("files")} /></Show>
                <box flexDirection="row" flexWrap="wrap" gap={1}>
                  <SetupActionLink id="sync-now" ctx={props.ctx} label={busy() ? "Syncing…" : "Sync now ↔"} disabled={!ready()} onPress={() => run(() => engine.sync())} />
                  <SetupActionLink id="sync-automatic" ctx={props.ctx} label={`Automatic sync: ${state()?.automatic ? "On" : "Off"}`} disabled={!ready() || !state()?.lastSyncedAt} onPress={() => run(() => engine.automatic(!state()?.automatic))} />
                </box>
                <text fg={props.ctx.theme.text.muted}>Automatic sync runs every minute while OpenCode is open.</text>
                <Show when={state()?.status === "conflict"}>
                  <text fg={props.ctx.theme.text.feedback.warning.base} wrapMode="word">{`Both machines changed: ${state()?.conflicts?.join(", ")}`}</text>
                  <SetupActionLink id="sync-keep-local" ctx={props.ctx} disabled={!ready()} label="Keep this machine's versions…" onPress={() => setResolution("local")} />
                  <SetupActionLink id="sync-keep-remote" ctx={props.ctx} disabled={!ready()} label="Use repository versions…" onPress={() => setResolution("remote")} />
                </Show>
                <Show when={resolution()}>
                  <text fg={props.ctx.theme.text.feedback.warning.base} wrapMode="word">{resolution() === "local" ? "Replace the conflicting repository files? Previous versions stay in Git history." : "Replace the conflicting local files? Originals are backed up."}</text>
                  <SetupActionLink id="sync-resolve-confirm" ctx={props.ctx} disabled={!ready()} label="Confirm & sync" onPress={() => { const choice = resolution(); setResolution(undefined); run(() => engine.sync(choice)) }} />
                  <SetupActionLink id="sync-resolve-cancel" ctx={props.ctx} label="Cancel" onPress={() => setResolution(undefined)} />
                </Show>
                <SetupActionLink id="sync-disconnect" ctx={props.ctx} label="Disconnect" disabled={busy()} onPress={() => run(() => engine.disconnect(), "files")} />
              </Show>
            </Show>
            <Show when={page() === "review"}>
              <text fg={props.ctx.theme.text.base}><b>Selected files</b></text>
              <box flexDirection="column">
                <For each={preview()?.files.slice(filePage() * 6, filePage() * 6 + 6)}>{(file) => <text height={1} wrapMode="none" truncate fg={preview()?.blockers.includes(file) ? props.ctx.theme.text.feedback.error.base : preview()?.warnings.includes(file) ? props.ctx.theme.text.feedback.warning.base : props.ctx.theme.text.muted}>{file}</text>}</For>
              </box>
              <Show when={(preview()?.files.length ?? 0) > 6}><box flexDirection="row" gap={1}>
                <SetupActionLink id="sync-files-prev" ctx={props.ctx} label="←" disabled={filePage() === 0} onPress={() => setFilePage(filePage() - 1)} />
                <text fg={props.ctx.theme.text.muted}>{`${filePage() + 1} / ${Math.ceil((preview()?.files.length ?? 0) / 6)}`}</text>
                <SetupActionLink id="sync-files-next-page" ctx={props.ctx} label="→" disabled={(filePage() + 1) * 6 >= (preview()?.files.length ?? 0)} onPress={() => setFilePage(filePage() + 1)} />
              </box></Show>
              <Show when={preview()?.blockers.length}><text fg={props.ctx.theme.text.feedback.error.base} wrapMode="word">Red files may contain credentials. Use environment references before syncing.</text></Show>
              <Show when={preview()?.warnings.length || allowPaths()}>
                <text fg={props.ctx.theme.text.feedback.warning.base}>Highlighted files contain machine-specific paths.</text>
                <SetupActionLink id="sync-allow-paths" ctx={props.ctx} disabled={busy()} label={`${allowPaths() ? "☑" : "☐"} Allow reviewed paths`} onPress={() => setAllowPaths(!allowPaths())} />
              </Show>
              <box flexDirection="row" justifyContent="space-between">
                <SetupActionLink id="sync-review-back" ctx={props.ctx} label="← Files" onPress={() => navigate("files")} />
                <SetupActionLink id="setup-sync-review" ctx={props.ctx} label="Local layout →" onPress={reviewLayout} />
              </box>
            </Show>
            <Show when={page() === "layout"}><PreflightView ctx={props.ctx} preflight={preflight()} loading={!preflight()} error={error()} back={() => navigate("review")} /></Show>
          </box>
        </scrollbox>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
          <text fg={props.ctx.theme.text.muted}>Tab · Enter · Esc</text>
          <SetupActionLink id="setup-sync-setup-back" ctx={props.ctx} label="← Settings" onPress={props.onBack} />
          <SetupActionLink id="sync-close" ctx={props.ctx} label="Close" onPress={() => props.ctx.ui.dialog.clear()} />
        </box>
      </box>
    </SetupActions>
  )
}
