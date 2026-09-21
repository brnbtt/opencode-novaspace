/** @jsxImportSource @opentui/solid */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { TuiContext } from "../../types"
import { Divider, nativeScrollbar, novaMark, useHostDimensions } from "../../ui"
import { displaySetupPath, SetupActionLink, SetupActions } from "./action"
import { profileSync, type ProfileSync, type SyncState } from "./sync"
import { groupSetupSections, setupSections, type SetupInventory, type SetupTarget } from "./inventory"
import type { StandardizationPreflight } from "./preflight"
import { SyncOnboardingModal } from "./sync-onboarding"
import { applyUpdate, checkForUpdate, installedVersion, loadUpdateState, updateSummary, type UpdateState } from "./update"

export type OpenSetupTarget = (target: SetupTarget) => Promise<void>

export function setupOpenCommand(target: SetupTarget) {
  return process.platform === "darwin"
    ? ["/usr/bin/open", target.path]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", target.path]
      : ["xdg-open", target.path]
}

export async function openSetupTarget(target: SetupTarget) {
  const child = Bun.spawn(setupOpenCommand(target), { stdin: "ignore", stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(stderr.trim() || `Could not open ${target.path} with its default application`)
}

export function setupLocations(inventory: SetupInventory) {
  const locations: { id: string; title: string; target?: SetupTarget }[] = groupSetupSections(setupSections(inventory)).map((group) => {
    const settings = inventory.settings && group.files.some((file) => file.path === inventory.settings!.path)
    return {
      id: group.key,
      title: settings ? "OpenCode settings" : group.sections.map((section) => section.label).join(" · "),
      target: settings ? inventory.settings : group.sections[0]?.key === "instructions" && group.files.length === 1 ? group.files[0] : group.target,
    }
  })
  if (inventory.settings && !locations.some((item) => item.target?.path === inventory.settings!.path)) locations.push({ id: "settings", title: "OpenCode settings", target: inventory.settings })
  if (inventory.terminalSettings) locations.push({ id: "terminal", title: "Appearance & preferences", target: inventory.terminalSettings })
  return locations.filter((item, index) => !item.target || locations.findIndex((other) => other.target?.path === item.target!.path) === index)
}

export function SetupModal(props: {
  ctx: TuiContext
  inventory: SetupInventory
  loading: boolean
  syncEngine?: ProfileSync
  openTarget?: OpenSetupTarget
  loadPreflight?: (ctx: TuiContext) => Promise<StandardizationPreflight>
  update?: {
    load?: (ctx: TuiContext) => Promise<UpdateState>
    check?: (ctx: TuiContext) => Promise<UpdateState>
    apply?: (ctx: TuiContext, target: string) => Promise<UpdateState>
  }
}) {
  const dimensions = useHostDimensions(props.ctx)
  const [update, setUpdate] = createSignal<UpdateState>({ status: "unknown" })
  const [sync, setSync] = createSignal<SyncState>()
  let disposed = false
  let applying = false
  const settle = (value: UpdateState) => { if (!disposed && !applying) setUpdate(value) }
  onMount(() => {
    void (props.syncEngine ?? profileSync).state().then((value) => { if (!disposed) setSync(value) }).catch(() => {})
    void (props.update?.load ?? loadUpdateState)(props.ctx).then(settle)
    void (props.update?.check ?? checkForUpdate)(props.ctx).then((value) => {
      if (value.status !== "error") settle(value)
    })
  })
  onCleanup(() => { disposed = true })
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
        : { message: "novaSpace updated. Restart the TUI to load it.", variant: "success" })
    })
  }
  const open = (target: SetupTarget) => {
    void (props.openTarget ?? openSetupTarget)(target)
      .catch((error) => props.ctx.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" }))
  }
  const showSetup = () => {
    props.ctx.ui.dialog.show(() => <SetupModal {...props} />)
    props.ctx.ui.dialog.set({ size: "medium", centered: true })
  }
  const openSync = () => {
    props.ctx.ui.dialog.show(() => <SyncOnboardingModal ctx={props.ctx} engine={props.syncEngine} loadPreflight={props.loadPreflight} onBack={showSetup} />)
    props.ctx.ui.dialog.set({ size: "medium", centered: true })
  }
  const locations = () => setupLocations(props.inventory)
  return (
    <SetupActions ctx={props.ctx}>
      <box id="sidebar-setup-modal" flexDirection="column" width="100%"
        height={Math.min(9 + locations().length * 3, Math.max(10, dimensions().height - 6))}
        paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={props.ctx.theme.background.base}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={props.ctx.theme.text.feedback.info.base}>{novaMark}</text>
            <text fg={props.ctx.theme.text.base}><b>novaSpace settings</b></text>
          </box>
          <text fg={props.ctx.theme.text.muted}>{installedVersion(update()) ? `v${installedVersion(update())}` : ""}</text>
        </box>
        <box id="setup-update-panel" flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
          <text selectable={false} flexGrow={1} minWidth={0} wrapMode="none" truncate fg={update().status === "error" ? props.ctx.theme.text.feedback.error.base : props.ctx.theme.text.muted}>{updateSummary(update()).label}</text>
          <Show when={updateSummary(update()).action}>{(label) => <SetupActionLink id="setup-update-apply" ctx={props.ctx} label={label()} onPress={runUpdate} />}</Show>
        </box>
        <box id="setup-sync-panel" flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
          <text fg={props.ctx.theme.text.base}>Profile sync</text>
          <SetupActionLink id="setup-sync-open" ctx={props.ctx} label={sync()?.repository ? "Manage →" : "Set up →"} onPress={openSync} />
        </box>
        <Divider theme={props.ctx.theme} strong />
        <scrollbox id="setup-modal-scroll" flexGrow={1} minHeight={1}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}>
          <box flexDirection="column" paddingRight={2}>
            <For each={locations()}>{(item) => (
              <box id={`setup-${item.id}-section`} flexDirection="column" marginBottom={1}>
                <box flexDirection="row" justifyContent="space-between" height={1}>
                  <text fg={props.ctx.theme.text.base}><b>{item.title}</b></text>
                  <Show when={item.target}>{(target) => <SetupActionLink id={`setup-${item.id}-open`} ctx={props.ctx} label="Open ↗" onPress={() => open(target())} />}</Show>
                </box>
                <text fg={props.ctx.theme.text.muted} minWidth={0} wrapMode="none" truncate>{item.target ? displaySetupPath(props.ctx, item.target.path) : props.loading ? "Finding source…" : "No local source"}</text>
              </box>
            )}</For>
          </box>
        </scrollbox>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
          <text fg={props.ctx.theme.text.muted}>Tab · Enter · Esc to close</text>
          <SetupActionLink id="setup-close" ctx={props.ctx} label="Close" onPress={() => props.ctx.ui.dialog.clear()} />
        </box>
      </box>
    </SetupActions>
  )
}
