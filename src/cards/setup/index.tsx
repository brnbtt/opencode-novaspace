/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Card, cardHeader, Divider, metricRow } from "../../ui"
import { defineCard, type CardProps } from "../../card"
import { emptyInventory, loadSetupInventory, setupSections, type SetupInventory, type SetupSection } from "./inventory"
import { SetupModal, type OpenSetupTarget } from "./modal"
import type { StandardizationPreflight } from "./preflight"
import { loadGitHubProfile, type ProfileState } from "./profile"

function Layer(props: { row: SetupSection; index: number; revealed: number; ctx: CardProps["ctx"] }) {
  const active = () => props.index < props.revealed
  return (
    <box {...metricRow} height={1} flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <text selectable={false} fg={active() ? props.ctx.theme.text.feedback.info.default : props.ctx.theme.text.subdued}>{props.row.icon}</text>
        <text selectable={false} fg={props.ctx.theme.text.default}>{props.row.label}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text selectable={false} fg={props.ctx.theme.text.default}><b>{props.row.count}</b></text>
        <text selectable={false} fg={props.row.healthy ? props.ctx.theme.text.feedback.success.default : props.ctx.theme.text.subdued}>{props.row.status}</text>
      </box>
    </box>
  )
}

export function SetupCard(props: CardProps & {
  loadProfile?: (signal?: AbortSignal) => Promise<ProfileState>
  loadInventory?: (ctx: CardProps["ctx"]) => Promise<SetupInventory>
  loadPreflight?: (ctx: CardProps["ctx"]) => Promise<StandardizationPreflight>
  openTarget?: OpenSetupTarget
}) {
  const [inventory, setInventory] = createSignal<SetupInventory>(emptyInventory())
  const [inventoryLoading, setInventoryLoading] = createSignal(true)
  const [inventoryFailed, setInventoryFailed] = createSignal(false)
  const [profile, setProfile] = createSignal<ProfileState>({ connection: "signed-out", sync: "local" })
  const [profileLoading, setProfileLoading] = createSignal(true)
  const [revealed, setRevealed] = createSignal(0)
  let sweep: ReturnType<typeof setInterval> | undefined

  const refreshInventory = async () => {
    setInventoryLoading(true)
    setInventoryFailed(false)
    try {
      setInventory(await (props.loadInventory ?? loadSetupInventory)(props.ctx))
    } catch {
      setInventoryFailed(true)
    } finally {
      setInventoryLoading(false)
    }
  }
  createEffect(() => {
    props.ctx.data.location.default()
    void refreshInventory()
    const controller = new AbortController()
    setProfileLoading(true)
    void (props.loadProfile ?? loadGitHubProfile)(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setProfile(value) })
      .catch(() => { if (!controller.signal.aborted) setProfile({ connection: "signed-out", sync: "local" }) })
      .finally(() => { if (!controller.signal.aborted) setProfileLoading(false) })
    onCleanup(() => controller.abort())
  })
  onCleanup(() => { if (sweep) clearInterval(sweep) })

  const rows = createMemo(() => setupSections(inventory()))
  const profileName = createMemo(() => profileLoading()
    ? "Checking GitHub…"
    : profile().login ? `@${profile().login}` : "GitHub not connected")
  const syncLabel = createMemo(() => {
    if (profile().sync === "syncing") return "Syncing…"
    if (profile().sync === "synced") return "Synced"
    if (profile().sync === "pending") return "Pending"
    if (profile().sync === "error") return "Error"
    return "Local"
  })
  const syncColor = () => {
    const colors = props.ctx.theme.text
    if (profile().sync === "synced") return colors.feedback.success.default
    if (profile().sync === "syncing") return colors.feedback.info.default
    if (profile().sync === "pending") return colors.feedback.warning.default
    if (profile().sync === "error") return colors.feedback.error.default
    return colors.subdued
  }

  const hover = (active: boolean) => {
    if (sweep) clearInterval(sweep)
    if (!active) { setRevealed(0); return }
    setRevealed(0)
    sweep = setInterval(() => {
      setRevealed((value) => {
        if (value >= rows().length) {
          if (sweep) clearInterval(sweep)
          sweep = undefined
          return value
        }
        return value + 1
      })
    }, 45)
  }
  const open = () => {
    if (props.dragging) return
    props.ctx.ui.dialog.show(() => (
      <SetupModal
        ctx={props.ctx}
        inventory={inventory()}
        loading={inventoryLoading()}
        openTarget={props.openTarget}
        loadPreflight={props.loadPreflight}
      />
    ))
    // show() replaces the host dialog and resets its size/centering.
    props.ctx.ui.dialog.set({ size: "medium", centered: true })
    if (!inventoryLoading()) void refreshInventory()
  }

  return (
    <Card
      theme={props.ctx.theme}
      strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength}
      hoverStrength={props.options.hoverStrength}
      hoverDuration={props.options.hoverDuration}
      onHoverChange={hover}
      onPress={open}
    >
      <box {...cardHeader} height={1} flexShrink={0}>
        <text selectable={false} flexGrow={1} minWidth={0} wrapMode="none" truncate fg={props.ctx.theme.text.default}><b>{profileName()}</b></text>
        <box flexDirection="row" flexShrink={0} gap={1}>
          <text selectable={false} fg={syncColor()}>●</text>
          <text selectable={false} fg={props.ctx.theme.text.subdued}>{syncLabel()}</text>
        </box>
      </box>
      <Divider theme={props.ctx.theme} strong />
      <box flexDirection="column">
        {inventoryLoading() && inventory().skills.length === 0
          ? <text selectable={false} fg={props.ctx.theme.text.subdued}>Inspecting customization layers…</text>
          : inventoryFailed() && inventory().skills.length === 0
            ? <text selectable={false} fg={props.ctx.theme.text.feedback.warning.default}>Setup inventory unavailable</text>
          : rows().map((row, index) => <Layer row={row} index={index} revealed={revealed()} ctx={props.ctx} />)}
      </box>
      <Divider theme={props.ctx.theme} strong />
      <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
        <text selectable={false} fg={props.ctx.theme.text.feedback.info.default}>Manage settings</text>
        <text selectable={false} fg={props.ctx.theme.text.feedback.info.default}>→</text>
      </box>
    </Card>
  )
}

export const setup = defineCard({
  id: "setup",
  title: "Profile & setup",
  render: (props) => <SetupCard {...props} />,
})
