/** @jsxImportSource @opentui/solid */
import { MouseButton } from "@opentui/core"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { TuiContext } from "../../types"
import { cardSurface, nativeScrollbar, useHostDimensions } from "../../ui"
import { SetupActionLink } from "./action"
import { loadStandardizationPreflight, preflightStatus, type StandardizationPreflight } from "./preflight"
import { PreflightView } from "./preflight-view"

function SyncStep(props: {
  ctx: TuiContext
  number: number
  title: string
  description: string
  status: string
  active?: boolean
  action?: { id: string; label: string; run(): void }
}) {
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={cardSurface(props.ctx.theme, props.active ? 0.18 : 0.1)}>
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text fg={props.ctx.theme.text.base}><b>{`${props.number}  ${props.title}`}</b></text>
        <text fg={props.status === "Ready" ? props.ctx.theme.text.feedback.success.base : props.active ? props.ctx.theme.text.feedback.warning.base : props.ctx.theme.text.muted}>{props.status}</text>
      </box>
      <text fg={props.ctx.theme.text.muted} wrapMode="word">{props.description}</text>
      <Show when={props.action}>{(action) => (
        <SetupActionLink id={action().id} ctx={props.ctx} label={action().label} onPress={action().run} />
      )}</Show>
    </box>
  )
}

export function SyncOnboardingModal(props: {
  ctx: TuiContext
  loadPreflight?: (ctx: TuiContext) => Promise<StandardizationPreflight>
  onBack(): void
}) {
  const dimensions = useHostDimensions(props.ctx)
  const [reviewing, setReviewing] = createSignal(false)
  const [preflight, setPreflight] = createSignal<StandardizationPreflight>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string>()
  createEffect(() => {
    let active = true
    setLoading(true)
    void (props.loadPreflight ?? loadStandardizationPreflight)(props.ctx)
      .then((value) => { if (active) { setPreflight(value); setError() } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    onCleanup(() => { active = false })
  })
  const firstStatus = () => loading() ? "Checking…" : preflight() ? preflightStatus(preflight()!) : "Unavailable"
  return (
    <box
      id="sidebar-sync-onboarding-modal"
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
        <text fg={props.ctx.theme.text.base}><b>Set up sync</b></text>
        <text fg={props.ctx.theme.text.muted}>{props.ctx.app?.version ? `v${props.ctx.app.version}` : ""}</text>
      </box>
      <text flexShrink={0} fg={props.ctx.theme.text.muted}>Back up your global OpenCode profile to a private GitHub repository.</text>

      <scrollbox
        id="setup-sync-onboarding-scroll"
        flexGrow={1}
        minHeight={1}
        marginTop={1}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ ...nativeScrollbar(props.ctx.theme), position: "absolute", right: 0, top: 0, height: "100%" }}
      >
        <box flexDirection="column" gap={1} paddingRight={1}>
          <Show when={reviewing()} fallback={(
            <>
              <SyncStep
                ctx={props.ctx}
                number={1}
                title="Standardize setup"
                description="Move global files into OpenCode's canonical layout and resolve portability or secret warnings."
                status={firstStatus()}
                active
                action={{ id: "setup-sync-review", label: "Review plan →", run: () => setReviewing(true) }}
              />
              <SyncStep ctx={props.ctx} number={2} title="Connect GitHub" description="Sign in through the GitHub CLI account that will own the profile." status="Not started" />
              <SyncStep ctx={props.ctx} number={3} title="Private repository" description="Create or connect a private opencode-profile repository." status="Not started" />
              <SyncStep ctx={props.ctx} number={4} title="Automatic sync" description="Commit, merge, and push profile changes without overwriting conflicts." status="Not started" />
            </>
          )}>
            <PreflightView ctx={props.ctx} preflight={preflight()} loading={loading()} error={error()} back={() => setReviewing(false)} />
          </Show>
        </box>
      </scrollbox>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} marginTop={1}>
        <text fg={props.ctx.theme.text.muted}>Esc to close</text>
        <box flexDirection="row" gap={1}>
          <SetupActionLink id="setup-sync-setup-back" ctx={props.ctx} label="← Setup" onPress={props.onBack} />
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
    </box>
  )
}
