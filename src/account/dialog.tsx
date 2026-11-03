/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { TuiContext } from "../types"
import { accent, Card, cardBorder, faint, gradient, nativeScrollbar, novaMark, toneColor, useHostDimensions } from "../ui"
import { ActionLink, DialogActions, displayPath, openPath } from "../dialog"
import { customCards } from "../cards/registry"
import { cardSync, type CardSync, type SyncState } from "../sync/engine"
import { applyUpdate, checkForUpdate, installedVersion, loadUpdateState, updateSummary, type UpdateState } from "../update"
import { relativeTime, syncBadge } from "./status"

export type UpdateHooks = {
  load?: (ctx: TuiContext) => Promise<UpdateState>
  check?: (ctx: TuiContext) => Promise<UpdateState>
  apply?: (ctx: TuiContext, target: string) => Promise<UpdateState>
}

export type AccountDialogProps = {
  ctx: TuiContext
  login?: string
  cardsDirectory: string
  engine?: CardSync
  open?: (path: string) => Promise<void>
  update?: UpdateHooks
}

function Section(props: { ctx: TuiContext; title: string; icon: string; aside?: () => JSX.Element; children: JSX.Element }) {
  return (
    <Card theme={props.ctx.theme} title={props.title} icon={props.icon} hoverStrength={0} meta={props.aside?.()}>
      {props.children}
    </Card>
  )
}

/** The wordmark, each letter a step along the accent gradient. */
function Wordmark(props: { ctx: TuiContext }) {
  const word = "novaSpace"
  const colors = () => gradient(accent(props.ctx.theme), props.ctx.theme.text.base, word.length)
  return (
    <text selectable={false}>
      <b>{word.split("").map((letter, index) => <span style={{ fg: colors()[index] }}>{letter}</span>)}</b>
    </text>
  )
}

export function AccountDialog(props: AccountDialogProps) {
  const engine = props.engine ?? cardSync()
  const theme = () => props.ctx.theme
  const dimensions = useHostDimensions(props.ctx)
  const [state, setState] = createSignal<SyncState>()
  const [repository, setRepository] = createSignal(props.login ? `${props.login}/novaspace-cards` : "")
  const [typing, setTyping] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [resolution, setResolution] = createSignal<"local" | "remote">()
  const [update, setUpdate] = createSignal<UpdateState>({ status: "unknown" })
  const [now, setNow] = createSignal(Date.now())
  let disposed = false
  let applying = false
  let scroll: ScrollBoxRenderable | undefined
  const [overflow, setOverflow] = createSignal(false)
  const measure = () => { if (scroll && !scroll.isDestroyed) setOverflow(scroll.scrollHeight > scroll.viewport.height) }

  const refresh = () => engine.state().then((value) => { if (!disposed) setState(value) }).catch(() => {})
  const settle = (value: UpdateState) => { if (!disposed && !applying) setUpdate(value) }
  onMount(() => {
    void refresh()
    onCleanup(engine.subscribe((value) => { if (!disposed) setState(value) }))
    // Other OpenCode windows sync through the same state file.
    const timer = setInterval(() => { setNow(Date.now()); if (!busy()) void refresh() }, 2_000)
    onCleanup(() => clearInterval(timer))
    void (props.update?.load ?? loadUpdateState)(props.ctx).then(settle)
    void (props.update?.check ?? checkForUpdate)(props.ctx).then((value) => { if (value.status !== "error") settle(value) })
  })
  onCleanup(() => { disposed = true })

  const run = (action: () => Promise<SyncState>) => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    void action()
      .then((value) => { if (!disposed) setState(value) })
      .catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!disposed) setBusy(false) })
  }
  const connect = (create: boolean) => run(() => engine.connect({ repository: repository(), create }))
  const runUpdate = () => {
    const current = update()
    if (current.status !== "outdated" || applying) return
    const { target, version } = current
    applying = true
    setUpdate({ status: "updating", target, version })
    void (props.update?.apply ?? applyUpdate)(props.ctx, target).then((value) => {
      if (disposed) return
      setUpdate(value)
      props.ctx.ui.toast.show(value.status === "error"
        ? { message: value.message, variant: "error" }
        : { message: "novaSpace updated. Restart OpenCode to load it.", variant: "success" })
    })
  }
  const openCards = () => {
    void (props.open ?? openPath)(props.cardsDirectory)
      .catch((reason) => props.ctx.ui.toast.show({ message: reason instanceof Error ? reason.message : String(reason), variant: "error" }))
  }

  const connected = () => !!state()?.repository
  const badge = createMemo(() => syncBadge(props.login, state()))
  const titles = () => customCards().map((card) => card.title)
  const notice = createMemo(() => {
    if (error()) return { text: error()!, tone: "error" as const }
    const value = state()
    if (!value?.repository) return undefined
    if (value.account !== props.login) return { text: `Signed in as ${props.login ? `@${props.login}` : "nobody"}. Switch gh back to @${value.account} or disconnect.`, tone: "warning" as const }
    if (value.status === "error" || value.status === "paused") return value.message ? { text: value.message, tone: value.status === "error" ? "error" as const : "warning" as const } : undefined
    if (value.status === "conflict") return { text: `Changed on both machines: ${(value.conflicts ?? []).slice(0, 4).map((key) => key.replace(/^cards\//, "")).join(", ")}${(value.conflicts?.length ?? 0) > 4 ? "…" : ""}`, tone: "warning" as const }
    return undefined
  })
  const lastSync = () => {
    const value = state()
    if (!value) return ""
    const when = relativeTime(value.lastSyncedAt, now())
    return `${when ? `Synced ${when}` : "Not synced yet"} · ${value.automatic ? "automatic" : "manual"}${value.keptLocal?.length ? ` · ${value.keptLocal.length} kept local` : ""}`
  }
  const height = () => {
    const sync = !props.login ? 3 : !connected() ? 4 : 3 + (notice() ? 3 : 0) + (state()?.status === "conflict" ? 2 : 0)
    // Each section tile adds a cap row above and below its content.
    return Math.min(22 + sync + (error() && !connected() ? 3 : 0), Math.max(12, dimensions().height - 4))
  }

  return (
    <DialogActions ctx={props.ctx} typing={typing()}>
      <box id="novaspace-dialog" flexDirection="column" width="100%" height={height()}
        paddingLeft={3} paddingRight={3} paddingTop={1} paddingBottom={1} backgroundColor={theme().background.base}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
          <box flexDirection="row" gap={1}>
            <text selectable={false} fg={accent(theme())}>{novaMark}</text>
            <Wordmark ctx={props.ctx} />
          </box>
          <text selectable={false} fg={faint(theme())}>{installedVersion(update()) ? `v${installedVersion(update())}` : ""}</text>
        </box>
        <text selectable={false} flexShrink={0} fg={theme().text.muted}>Your sidebar cards, on every machine.</text>
        <scrollbox id="novaspace-dialog-scroll" ref={(value) => { scroll = value }} onSizeChange={measure} flexGrow={1} minHeight={1} marginTop={1}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ ...nativeScrollbar(theme(), overflow()), position: "absolute", right: 0, top: 0, height: "100%" }}>
          <box flexDirection="column" gap={1} paddingRight={2} onSizeChange={measure}>
            <Section ctx={props.ctx} title="Cards" icon="▦" aside={() => <box marginRight={-1}><ActionLink id="cards-open" ctx={props.ctx} label="Open folder ↗" onPress={openCards} /></box>}>
              <text fg={theme().text.base} wrapMode="none" truncate>{displayPath(props.ctx, props.cardsDirectory)}</text>
              <text fg={theme().text.muted} wrapMode="word">{titles().length ? titles().join(" · ") : "No cards yet. Add a folder with an index.js."}</text>
            </Section>

            <Section ctx={props.ctx} title="Sync" icon="⇅" aside={() => (
              <text id="sync-badge" selectable={false} fg={toneColor(theme(), badge().tone)}>{busy() ? "◌ Working…" : `${badge().glyph} ${badge().label}`}</text>
            )}>
              <Show when={props.login} fallback={
                <text fg={theme().text.muted} wrapMode="word">Sign in with the GitHub CLI (gh auth login) to sync cards and their layout through a private repository.</text>
              }>
                <Show when={connected()} fallback={<>
                  <text fg={theme().text.muted} wrapMode="word">Keep cards and their layout in a private GitHub repository.</text>
                  <Show when={typing()} fallback={
                    <box marginLeft={-1}><ActionLink id="sync-repository" ctx={props.ctx} variant="quiet" label={`${repository() || "owner/repository"}  ✎`} disabled={busy()} onPress={() => setTyping(true)} /></box>
                  }>
                    <box flexDirection="row" gap={1} height={1} marginLeft={-1}>
                      <input id="sync-repository-input" flexGrow={1} value={repository()} placeholder="owner/novaspace-cards" focused={typing()}
                        backgroundColor={cardBorder(theme())} onInput={setRepository} onSubmit={() => setTyping(false)} />
                      <ActionLink id="sync-repository-done" ctx={props.ctx} label="Done ↵" onPress={() => setTyping(false)} />
                    </box>
                  </Show>
                  <box flexDirection="row" gap={1} height={1} marginLeft={-1}>
                    <ActionLink id="sync-create" ctx={props.ctx} variant="primary" label="Create & sync" disabled={busy() || typing()} onPress={() => connect(true)} />
                    <ActionLink id="sync-connect" ctx={props.ctx} label="Use existing" disabled={busy() || typing()} onPress={() => connect(false)} />
                  </box>
                </>}>
                  <text fg={theme().text.base} wrapMode="none" truncate>{state()?.repository}</text>
                  <text fg={theme().text.muted} wrapMode="none" truncate>{lastSync()}</text>
                  <box flexDirection="row" gap={1} height={1} marginLeft={-1}>
                    <ActionLink id="sync-now" ctx={props.ctx} variant="primary" label="Sync now" disabled={busy()} onPress={() => run(() => engine.sync())} />
                    <ActionLink id="sync-automatic" ctx={props.ctx} label={`Auto: ${state()?.automatic ? "on" : "off"}`} disabled={busy()} onPress={() => run(() => engine.setAutomatic(!state()?.automatic))} />
                    <ActionLink id="sync-disconnect" ctx={props.ctx} variant="quiet" label="Disconnect" disabled={busy()} onPress={() => run(() => engine.disconnect())} />
                  </box>
                </Show>
                <Show when={notice()}>{(value) => (
                  <text id="sync-notice" fg={toneColor(theme(), value().tone)} wrapMode="word">{value().text}</text>
                )}</Show>
                <Show when={connected() && state()?.status === "conflict"}>
                  <Show when={resolution()} fallback={
                    <box flexDirection="row" gap={1} height={1} marginLeft={-1}>
                      <ActionLink id="sync-keep-local" ctx={props.ctx} label="Keep this machine's" disabled={busy()} onPress={() => setResolution("local")} />
                      <ActionLink id="sync-keep-remote" ctx={props.ctx} label="Use repository's" disabled={busy()} onPress={() => setResolution("remote")} />
                    </box>
                  }>{(choice) => <>
                    <text fg={theme().text.muted} wrapMode="word">{choice() === "local" ? "Replace the repository's versions? Git history keeps the old ones." : "Replace this machine's versions? Originals are backed up."}</text>
                    <box flexDirection="row" gap={1} height={1} marginLeft={-1}>
                      <ActionLink id="sync-resolve-confirm" ctx={props.ctx} variant="primary" label="Confirm" disabled={busy()} onPress={() => { const value = choice(); setResolution(undefined); run(() => engine.sync(value)) }} />
                      <ActionLink id="sync-resolve-cancel" ctx={props.ctx} variant="quiet" label="Cancel" onPress={() => setResolution(undefined)} />
                    </box>
                  </>}</Show>
                </Show>
              </Show>
            </Section>

            <Section ctx={props.ctx} title="Updates" icon="↑" aside={() => (
              <Show when={updateSummary(update()).action}>{(label) => <box marginRight={-1}><ActionLink id="update-apply" ctx={props.ctx} label={label()} onPress={runUpdate} /></box>}</Show>
            )}>
              <text id="update-status" selectable={false} wrapMode="none" truncate fg={update().status === "error" ? theme().text.feedback.error.base : theme().text.muted}>{updateSummary(update()).label}</text>
            </Section>
          </box>
        </scrollbox>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
          <text selectable={false} fg={faint(theme())}>tab · enter · esc</text>
          <box marginRight={-1}><ActionLink id="dialog-close" ctx={props.ctx} variant="quiet" label="Close" onPress={() => props.ctx.ui.dialog.clear()} /></box>
        </box>
      </box>
    </DialogActions>
  )
}

export function showAccountDialog(props: AccountDialogProps) {
  props.ctx.ui.dialog.show(() => <AccountDialog {...props} />)
  // show() replaces the host dialog and resets its size and centering.
  props.ctx.ui.dialog.set({ size: "medium", centered: true })
}
