/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { TuiContext } from "../../types"
import { cardSurface, nativeScrollbar, Panel, useHostDimensions } from "../../ui"
import { SetupActionLink, SetupActions } from "./action"
import { loadStandardizationPreflight, type StandardizationPreflight } from "./preflight"
import { PreflightView } from "./preflight-view"
import { profileSync, type ProfileSync, type SyncState } from "./sync"
import { syncGroups, type SyncGroup } from "./sync-files"
import { gh, validRepository } from "./sync-remote"

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
  const [reviewing, setReviewing] = createSignal(false)
  const [showFiles, setShowFiles] = createSignal(false)
  const [preflight, setPreflight] = createSignal<StandardizationPreflight>()
  let scroll: import("@opentui/core").ScrollBoxRenderable | undefined
  const [resolution, setResolution] = createSignal<"local" | "remote">()
  let disposed = false
  const refresh = async () => { const value = await engine.state(); if (!disposed) setState(value) }
  onMount(() => {
    void engine.state().then(async (value) => {
      if (disposed) return
      setState(value); setSelected(value.selected); setAllowPaths(value.allowMachinePaths)
      setRepository(value.repository ?? `${await engine.remote.account()}/opencode-profile`)
    }).catch((reason) => { if (!disposed) setError(String(reason)) })
    const timer = setInterval(() => { if (!busy()) void refresh().catch(() => {}) }, 2_000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => { disposed = true })
  createEffect(() => {
    const groups = selected()
    let active = true
    setPreview(undefined)
    void engine.preview(groups).then((value) => { if (active) { setPreview(value); setError(undefined) } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    onCleanup(() => { active = false })
  })
  const run = (action: () => Promise<SyncState>) => {
    if (busy()) return
    setBusy(true); setError(undefined)
    void action().then((value) => { if (!disposed) { setState(value); if (value.status === "error") setError(value.message) } })
      .catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!disposed) setBusy(false) })
  }
  const connect = (create: boolean) => run(async () => {
    validRepository(repository())
    if (create) await gh(["repo", "create", repository(), "--private", "--description", "Personal OpenCode profile synced by novaSpace"])
    return engine.configure({ repository: repository(), selected: selected(), allowMachinePaths: allowPaths() })
  })
  const dirty = () => state()?.repository !== repository() || JSON.stringify(state()?.selected) !== JSON.stringify(selected()) || state()?.allowMachinePaths !== allowPaths()
  const ready = () => !!state()?.repository && !dirty() && !busy()
  const review = () => {
    setReviewing(true)
    scroll?.scrollTo(0)
    void (props.loadPreflight ?? loadStandardizationPreflight)(props.ctx).then(setPreflight).catch((reason) => setError(String(reason)))
  }
  return (
    <SetupActions ctx={props.ctx} typing={typing()}>
    <box id="sidebar-sync-onboarding-modal" flexDirection="column" width="100%"
      height={Math.min(34, Math.max(10, dimensions().height - 6))}
      paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={props.ctx.theme.background.base}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
        <text fg={props.ctx.theme.text.base}><b>Profile sync</b></text>
        <text fg={props.ctx.theme.text.muted}>{busy() ? "Working…" : state()?.status ?? "Loading…"}</text>
      </box>
      <text flexShrink={0} fg={props.ctx.theme.text.muted}>Your selected global files, across machines.</text>
      <scrollbox id="setup-sync-onboarding-scroll" ref={(value) => { scroll = value }} flexGrow={1} minHeight={1} marginTop={1}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}>
        <box flexDirection="column" gap={1} paddingRight={2}>
        <Show when={!reviewing()} fallback={<PreflightView ctx={props.ctx} preflight={preflight()} loading={!preflight()} error={error()} back={() => { setReviewing(false); scroll?.scrollTo(0) }} />}>
          <Panel theme={props.ctx.theme} strength={0.1}>
            <text fg={props.ctx.theme.text.base}><b>1  Choose what travels</b></text>
            <text fg={props.ctx.theme.text.muted} wrapMode="word">Groups select whole files. Plugins, MCP and inline agents share OpenCode settings and travel together.</text>
            <For each={syncGroups}>{(group) => <box flexDirection="column">
              <SetupActionLink id={`sync-group-${group.id}`} ctx={props.ctx} disabled={busy()} label={`${selected().includes(group.id) ? "☑" : "☐"} ${group.label}`} onPress={() => setSelected((value) => value.includes(group.id) ? value.filter((id) => id !== group.id) : [...value, group.id])} />
              <Show when={showFiles()}><text paddingLeft={1} fg={props.ctx.theme.text.muted} wrapMode="word">{group.detail}</text></Show>
            </box>}</For>
          </Panel>
          <box flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={cardSurface(props.ctx.theme, 0.1)}>
            <SetupActionLink id="sync-files-toggle" ctx={props.ctx} label={preview() ? `${preview()!.files.length} local files · ${showFiles() ? "hide details ↑" : "review details ↓"}` : "Reviewing files…"} onPress={() => setShowFiles(!showFiles())} />
            <Show when={showFiles()}><For each={preview()?.files}>{(file) => <text fg={props.ctx.theme.text.muted} wrapMode="word">{file}</text>}</For></Show>
            <Show when={preview()?.blockers.length}><text fg={props.ctx.theme.text.feedback.error.base} wrapMode="word">{`Possible credentials: ${preview()?.blockers.join(", ")}. Replace literal values with environment references.`}</text></Show>
            <Show when={preview()?.warnings.length}><text fg={props.ctx.theme.text.feedback.warning.base} wrapMode="word">{showFiles() ? `Machine-specific paths: ${preview()?.warnings.join(", ")}` : `${preview()?.warnings.length} files have machine-specific paths · review details`}</text></Show>
            <SetupActionLink id="sync-allow-paths" ctx={props.ctx} disabled={busy()} label={`${allowPaths() ? "☑" : "☐"} Allow reviewed machine-specific paths`} onPress={() => setAllowPaths(!allowPaths())} />
            <Show when={showFiles()}><text fg={props.ctx.theme.text.muted} wrapMode="word">Local only: sign-ins, environment variables, service settings, sessions, current session model, caches, project files and saved card drag positions. Configured default models and cli.json preferences are included when selected.</text></Show>
          </box>
          <Panel theme={props.ctx.theme} strength={0.1}>
            <text fg={props.ctx.theme.text.base}><b>2  Private GitHub repository</b></text>
            <Show when={typing()} fallback={<SetupActionLink id="sync-repository-edit" ctx={props.ctx} label={repository() || "Set owner/repository →"} disabled={busy()} onPress={() => setTyping(true)} />}>
              <input id="sync-repository-input" value={repository()} placeholder="owner/opencode-profile" focused={typing()} onInput={setRepository} onSubmit={() => setTyping(false)} />
              <SetupActionLink id="sync-repository-done" ctx={props.ctx} label="Done editing ↵" onPress={() => setTyping(false)} />
            </Show>
            <text fg={props.ctx.theme.text.muted} wrapMode="word">Use gh auth login in your terminal first. Connect the same repository on your other machine. Connecting saves this selection; syncing uploads and restores files.</text>
            <box flexDirection="row" flexWrap="wrap" gap={1}>
              <SetupActionLink id="sync-connect" ctx={props.ctx} label={state()?.repository ? "Save selection" : "Connect existing"} disabled={busy() || !selected().length || typing()} onPress={() => connect(false)} />
              <Show when={!state()?.repository}><SetupActionLink id="sync-create" ctx={props.ctx} label="Create private repo & connect" disabled={busy() || !selected().length || typing()} onPress={() => connect(true)} /></Show>
            </box>
          </Panel>
          <Panel theme={props.ctx.theme} strength={0.1}>
            <text fg={props.ctx.theme.text.base}><b>3  Sync & keep in step</b></text>
            <text fg={props.ctx.theme.text.muted} wrapMode="word">Two-way sync checks once a minute while OpenCode is open. Concurrent edits to the same file pause sync for review. Replaced or deleted local files are backed up.</text>
            <Show when={state()?.account}><text fg={props.ctx.theme.text.muted}>{`Connected as @${state()?.account}`}</text></Show>
            <text fg={props.ctx.theme.text.muted}>{state()?.lastSyncedAt ? `Last sync: ${new Date(state()!.lastSyncedAt!).toLocaleString()}` : "Not synced yet"}</text>
            <Show when={dirty() && state()?.repository}><text fg={props.ctx.theme.text.feedback.warning.base}>Save your selection before syncing.</text></Show>
            <SetupActionLink id="sync-now" ctx={props.ctx} label={busy() ? "Syncing…" : "Sync now ↔"} disabled={!ready()} onPress={() => run(() => engine.sync())} />
            <SetupActionLink id="sync-automatic" ctx={props.ctx} label={`Automatic sync: ${state()?.automatic ? "On · pause" : "Off · enable"}`} disabled={!ready() || !state()?.lastSyncedAt} onPress={() => run(() => engine.automatic(!state()?.automatic))} />
            <Show when={state()?.status === "conflict"}>
              <text fg={props.ctx.theme.text.feedback.warning.base} wrapMode="word">{`Conflicting files: ${state()?.conflicts?.join(", ")}`}</text>
              <SetupActionLink id="sync-keep-local" ctx={props.ctx} disabled={!ready()} label="Keep this machine's conflicting files…" onPress={() => setResolution("local")} />
              <SetupActionLink id="sync-keep-remote" ctx={props.ctx} disabled={!ready()} label="Use repository's conflicting files…" onPress={() => setResolution("remote")} />
            </Show>
            <Show when={resolution()}>
              <text fg={props.ctx.theme.text.feedback.warning.base} wrapMode="word">{resolution() === "local" ? "Replace conflicting repository files with this machine's versions? Previous remote versions remain in Git history." : "Replace conflicting local files with repository versions? Local originals are saved in novaSpace backups."}</text>
              <SetupActionLink id="sync-resolve-confirm" ctx={props.ctx} disabled={!ready()} label="Confirm & sync" onPress={() => { const choice = resolution(); setResolution(undefined); run(() => engine.sync(choice)) }} />
              <SetupActionLink id="sync-resolve-cancel" ctx={props.ctx} label="Cancel" onPress={() => setResolution(undefined)} />
            </Show>
            <Show when={state()?.message}><text fg={props.ctx.theme.text.muted} wrapMode="word">{state()?.message}</text></Show>
            <Show when={state()?.repository}><SetupActionLink id="sync-disconnect" ctx={props.ctx} label="Disconnect · keep local & remote files" disabled={busy()} onPress={() => run(() => engine.disconnect())} /></Show>
          </Panel>
          <SetupActionLink id="setup-sync-review" ctx={props.ctx} label="Review local layout →" onPress={review} />
        </Show>
        <Show when={error()}><text fg={props.ctx.theme.text.feedback.error.base} wrapMode="word">{error()}</text></Show>
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
