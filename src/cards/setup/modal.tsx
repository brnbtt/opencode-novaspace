/** @jsxImportSource @opentui/solid */
import { MouseButton } from "@opentui/core"
import { For, Show } from "solid-js"
import type { TuiContext } from "../../types"
import { cardSurface, nativeScrollbar, useHostDimensions } from "../../ui"
import { displaySetupPath, SetupActionLink } from "./action"
import { groupSetupSections, setupSections, type SetupInventory, type SetupTarget } from "./inventory"
import type { StandardizationPreflight } from "./preflight"
import { SyncOnboardingModal } from "./sync-onboarding"

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

function TargetLink(props: {
  id: string
  ctx: TuiContext
  target: SetupTarget
  label?: string
  onPress(): void
}) {
  return <SetupActionLink {...props} label={props.label ?? (props.target.kind === "folder" ? "Open folder ↗" : "Open file ↗")} />
}

type SetupEntry = { label: string; target?: SetupTarget }

function EntryRows(props: {
  ctx: TuiContext
  section: string
  entries: SetupEntry[]
  open(target: SetupTarget): void
}) {
  return (
    <box flexDirection="column">
      <For each={props.entries}>{(entry, index) => (
        <box flexDirection="row" justifyContent="space-between" minWidth={0} height={1}>
          <text flexGrow={1} minWidth={0} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>
            {`• ${entry.label}`}
          </text>
          <Show when={entry.target}>{(target) => (
            <TargetLink
              id={`setup-${props.section}-item-${index()}`}
              ctx={props.ctx}
              target={target()}
              label="Open ↗"
              onPress={() => props.open(target())}
            />
          )}</Show>
        </box>
      )}</For>
    </box>
  )
}

function EntryList(props: {
  ctx: TuiContext
  section: string
  title: string
  entries: SetupEntry[]
  open(target: SetupTarget): void
}) {
  const rows = () => <EntryRows {...props} />
  const scrolling = () => props.entries.length > 5
  return (
    <box
      id={`setup-${props.section}-items-panel`}
      flexDirection="column"
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={cardSurface(props.ctx.theme, scrolling() ? 0.2 : 0.14)}
    >
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text fg={props.ctx.theme.text.base}><b>{props.title}</b></text>
        <text fg={props.ctx.theme.text.muted}>{props.entries.length}</text>
      </box>
      <Show when={props.entries.length > 0} fallback={<text paddingLeft={1} fg={props.ctx.theme.text.muted}>Nothing configured</text>}>
        <Show when={scrolling()} fallback={rows()}>
          <scrollbox
            id={`setup-${props.section}-items-scroll`}
            height={5}
            paddingRight={1}
            backgroundColor={cardSurface(props.ctx.theme, 0.2)}
            horizontalScrollbarOptions={{ visible: false }}
            verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}
            onMouseScroll={(event) => {
              if (event.scroll?.direction === "up" || event.scroll?.direction === "down") event.stopPropagation()
            }}
          >
            {rows()}
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}

export function SetupModal(props: {
  ctx: TuiContext
  inventory: SetupInventory
  loading: boolean
  openTarget?: OpenSetupTarget
  loadPreflight?: (ctx: TuiContext) => Promise<StandardizationPreflight>
}) {
  const dimensions = useHostDimensions(props.ctx)
  const open = (target: SetupTarget) => {
    void (props.openTarget ?? openSetupTarget)(target)
      .then(() => props.ctx.ui.toast.show({
        message: `Opened ${displaySetupPath(props.ctx, target.path)}`,
        variant: "success",
      }))
      .catch((error) => props.ctx.ui.toast.show({
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      }))
  }
  const groups = () => groupSetupSections(setupSections(props.inventory))
  const showSetup = () => {
    props.ctx.ui.dialog.show(() => <SetupModal {...props} />)
    props.ctx.ui.dialog.set({ size: "medium", centered: true })
  }
  const openSync = () => {
    props.ctx.ui.dialog.show(() => <SyncOnboardingModal ctx={props.ctx} loadPreflight={props.loadPreflight} onBack={showSetup} />)
    // show() replaces the host dialog and resets its size/centering.
    props.ctx.ui.dialog.set({ size: "medium", centered: true })
  }
  const settingsGrouped = () => !!props.inventory.settings
    && groups().some((group) => group.files.some((file) => file.path === props.inventory.settings!.path))
  return (
    <box
      id="sidebar-setup-modal"
      flexDirection="column"
      width="100%"
      height={Math.min(28, Math.max(18, Math.floor(dimensions().height * 0.72)))}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.ctx.theme.background.base}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1}>
        <text fg={props.ctx.theme.text.base}><b>novaSpace</b></text>
        <text fg={props.ctx.theme.text.muted}>{props.ctx.app?.version ? `v${props.ctx.app.version}` : ""}</text>
      </box>
      <text flexShrink={0} fg={props.ctx.theme.text.muted}>OpenCode customization at a glance.</text>

      <scrollbox
        id="setup-modal-scroll"
        flexGrow={1}
        minHeight={1}
        marginTop={1}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}
      >
        <box flexDirection="column" gap={1} paddingRight={1}>
          <box id="setup-sync-panel" flexDirection="row" justifyContent="space-between" alignItems="center" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={cardSurface(props.ctx.theme, 0.18)}>
            <text fg={props.ctx.theme.text.base}><b>Profile sync</b></text>
            <SetupActionLink id="setup-sync-open" ctx={props.ctx} label="Set up sync →" onPress={openSync} />
          </box>

          <Show when={props.loading}>
            <text fg={props.ctx.theme.text.muted}>Refreshing local setup…</text>
          </Show>
          <box flexDirection="column">
            <For each={groups()}>{(group) => {
                const groupedSettings = () => group.sections.length > 1
                  && !!props.inventory.settings
                  && group.files.some((file) => file.path === props.inventory.settings!.path)
                const entries = group.sections.flatMap((section) => section.items.map((item) => ({
                  label: group.sections.length > 1 ? `${section.itemLabel} · ${item.name}` : item.name,
                  target: item.target,
                })))
                const listTitle = group.sections.length > 1 ? "Configured items" : group.sections[0]?.listTitle ?? "Configured items"
                return (
                  <box
                    id={`setup-${group.key}-section`}
                    flexDirection="column"
                    marginBottom={1}
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={cardSurface(props.ctx.theme, groupedSettings() ? 0.14 : 0.1)}
                  >
                    <Show when={group.sections.length > 1}>
                      <text fg={props.ctx.theme.text.feedback.info.base}><b>{groupedSettings() ? "OpenCode settings" : "Shared configuration"}</b></text>
                    </Show>
                    <For each={group.sections}>{(section) => (
                      <box flexDirection="row" justifyContent="space-between" height={1} paddingLeft={group.sections.length > 1 ? 1 : 0}>
                        <text fg={props.ctx.theme.text.base}><b>{`${section.icon} ${section.label}`}</b></text>
                        <box flexDirection="row" gap={1}>
                          <text fg={props.ctx.theme.text.base}><b>{section.count}</b></text>
                          <text fg={section.healthy ? props.ctx.theme.text.feedback.success.base : props.ctx.theme.text.muted}>{section.status}</text>
                        </box>
                      </box>
                    )}</For>
                    <box flexDirection="row" justifyContent="space-between" minWidth={0}>
                      <text flexGrow={1} minWidth={0} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>
                        {group.target ? displaySetupPath(props.ctx, group.target.path) : group.sections[0]?.empty}
                      </text>
                      <Show when={group.target}>{(target) => (
                        <TargetLink id={`setup-${group.key}-open`} ctx={props.ctx} target={target()} onPress={() => open(target())} />
                      )}</Show>
                    </box>
                    <EntryList ctx={props.ctx} section={group.key} title={listTitle} entries={entries} open={open} />
                  </box>
                )
            }}</For>
          </box>

          <Show when={!settingsGrouped()}>
            <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={cardSurface(props.ctx.theme, 0.16)}>
              <text fg={props.ctx.theme.text.base}><b>OpenCode settings</b></text>
              <Show when={props.inventory.settings} fallback={<text fg={props.ctx.theme.text.muted}>No settings file detected</text>}>
                {(target) => (
                  <box flexDirection="row" justifyContent="space-between" minWidth={0}>
                    <text flexGrow={1} minWidth={0} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>{displaySetupPath(props.ctx, target().path)}</text>
                    <TargetLink id="setup-settings-open" ctx={props.ctx} target={target()} onPress={() => open(target())} />
                  </box>
                )}
              </Show>
            </box>
          </Show>
        </box>
      </scrollbox>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
        <text fg={props.ctx.theme.text.muted}>Esc to close</text>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={props.ctx.theme.background.action.primary.hovered}
          onMouseUp={(event) => {
            if (event.button === MouseButton.LEFT && !event.isDragging) props.ctx.ui.dialog.clear()
          }}
        >
          <text selectable={false} fg={props.ctx.theme.text.action.primary.hovered}>Close</text>
        </box>
      </box>
    </box>
  )
}
