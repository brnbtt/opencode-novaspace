/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { TuiContext } from "../../types"
import { Divider, nativeScrollbar, novaMark, useHostDimensions } from "../../ui"
import { SetupActionLink, SetupActions } from "./action"
import type { StandardizationPreflight } from "./preflight"
import { profileSync, type ProfileSync, type SyncState } from "./sync"
import { syncGroups, type SyncGroup } from "./sync-files"

const sources: Record<SyncGroup, string> = {
  settings: "opencode.json(c)", terminal: "cli.json · themes/", skills: "skills/",
  instructions: "AGENTS.md", agents: "agents/ · commands/", plugins: "plugins/",
}
type Page = "files" | "repository" | "sync" | "review"

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
  const [typing, setTyping] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [preview, setPreview] = createSignal<Awaited<ReturnType<ProfileSync["preview"]>>>()
  const [page, setPage] = createSignal<Page>("files")
  const [filePage, setFilePage] = createSignal(0)
  const [resolution, setResolution] = createSignal<"local" | "remote">()
  let scroll: ScrollBoxRenderable | undefined
  let disposed = false
  const navigate = (next: Page) => { setTyping(false); setPage(next); scroll?.scrollTo(0) }
  const refresh = async () => { const value = await engine.state(); if (!disposed) setState(value) }
  onMount(() => {
    void engine.state().then(async (value) => {
      if (disposed) return
      setState(value); setSelected(value.selected)
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
  const connect = (create: boolean) => run(async () => {
    const automatic = !state()?.repository || state()?.automatic
    await engine.configure({ repository: repository(), selected: selected(), create })
    const synced = await engine.sync()
    return synced.status === "synced" && automatic ? engine.automatic(true) : synced
  }, "sync")
  const dirty = () => state()?.repository !== repository().trim() || JSON.stringify(state()?.selected) !== JSON.stringify(selected())
  const ready = () => !!state()?.repository && !dirty() && !busy()
  const notice = () => error() ?? (state()?.status === "error" ? state()?.message : undefined)
  const status = () => busy() ? "Working…" : ({ unconfigured: "Not connected", pending: "Ready", syncing: "Syncing…", synced: "Up to date", paused: "Paused", conflict: "Needs attention", error: "Error" }[state()?.status ?? "unconfigured"])
  const height = () => page() === "repository" ? 17 : page() === "sync" ? state()?.status === "conflict" || resolution() ? 28 : state()?.repository ? 20 : 12 : 23
  const details = () => [
    ...(preview()?.files ?? []).map((path) => ({ path, local: false })),
    ...(preview()?.keptLocal ?? []).map((entry) => ({ path: entry.path, local: true })),
  ]
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
              <text fg={props.ctx.theme.text.muted}>Your setup is prepared automatically.</text>
              <box flexDirection="row" justifyContent="space-between" height={1}>
                <text fg={props.ctx.theme.text.muted}>{preview() ? `${preview()!.files.length} files selected` : "Checking files…"}</text>
                <SetupActionLink id="sync-files-toggle" ctx={props.ctx} label="Details →" onPress={() => navigate("review")} />
              </box>
              <Show when={preview()?.keptLocal.length}><text fg={props.ctx.theme.text.muted}>{`${preview()?.keptLocal.length} machine-local entries preserved`}</text></Show>
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
                <SetupActionLink id="sync-connect" ctx={props.ctx} label={state()?.repository ? "Save connection" : "Connect & sync"} disabled={busy() || !selected().length || typing()} onPress={() => connect(false)} />
                <Show when={!state()?.repository}><SetupActionLink id="sync-create" ctx={props.ctx} label="Create & sync" disabled={busy() || !selected().length || typing()} onPress={() => connect(true)} /></Show>
              </box>
              <text fg={props.ctx.theme.text.muted} wrapMode="word">Selected portable settings sync automatically.</text>
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
                <Show when={state()?.keptLocal?.length}><text fg={props.ctx.theme.text.muted}>{`${state()?.keptLocal?.length} machine-local entries preserved`}</text></Show>
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
              <text fg={props.ctx.theme.text.base}><b>Sync details</b></text>
              <box flexDirection="column">
                <For each={details().slice(filePage() * 6, filePage() * 6 + 6)}>{(entry) => <text height={1} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>{`${entry.local ? "Local · " : "Sync · "}${entry.path}`}</text>}</For>
              </box>
              <Show when={details().length > 6}><box flexDirection="row" gap={1}>
                <SetupActionLink id="sync-files-prev" ctx={props.ctx} label="←" disabled={filePage() === 0} onPress={() => setFilePage(filePage() - 1)} />
                <text fg={props.ctx.theme.text.muted}>{`${filePage() + 1} / ${Math.ceil(details().length / 6)}`}</text>
                <SetupActionLink id="sync-files-next-page" ctx={props.ctx} label="→" disabled={(filePage() + 1) * 6 >= details().length} onPress={() => setFilePage(filePage() + 1)} />
              </box></Show>
              <text fg={props.ctx.theme.text.muted} wrapMode="word">Machine-specific values and linked sources stay local. Existing files keep their layout.</text>
              <SetupActionLink id="sync-review-back" ctx={props.ctx} label="← Files" onPress={() => navigate("files")} />
            </Show>
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
