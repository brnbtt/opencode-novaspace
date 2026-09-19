/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { TuiContext } from "../../types"
import { cardSurface } from "../../ui"
import { displaySetupPath, SetupActionLink } from "./action"
import { preflightStatus, type PreflightPath, type StandardizationPreflight } from "./preflight"

function PreflightGroup(props: {
  ctx: TuiContext
  title: string
  items: PreflightPath[]
  color?: "info" | "warning" | "error"
}) {
  const color = () => props.color === "error"
    ? props.ctx.theme.text.feedback.error.base
    : props.color === "warning"
      ? props.ctx.theme.text.feedback.warning.base
      : props.ctx.theme.text.feedback.info.base
  return (
    <Show when={props.items.length > 0}>
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={cardSurface(props.ctx.theme, props.color ? 0.14 : 0.1)}
      >
        <text fg={color()}><b>{`${props.title} · ${props.items.length}`}</b></text>
        <For each={props.items}>{(item) => (
          <box flexDirection="column" paddingLeft={1}>
            <text fg={props.ctx.theme.text.base}>{`• ${item.name}`}</text>
            <text fg={props.ctx.theme.text.muted} wrapMode="word">{displaySetupPath(props.ctx, item.path)}</text>
            <Show when={item.detail}><text fg={props.ctx.theme.text.muted} wrapMode="word">{item.detail}</text></Show>
          </box>
        )}</For>
      </box>
    </Show>
  )
}

export function PreflightView(props: {
  ctx: TuiContext
  preflight?: StandardizationPreflight
  loading: boolean
  error?: string
  back(): void
}) {
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text fg={props.ctx.theme.text.base}><b>Standardization preflight</b></text>
        <SetupActionLink id="setup-sync-back" ctx={props.ctx} label="← Back" onPress={props.back} />
      </box>
      <Show when={!props.loading} fallback={<text fg={props.ctx.theme.text.muted}>Inspecting global and project setup…</text>}>
        <Show when={props.preflight} fallback={<text fg={props.ctx.theme.text.feedback.error.base}>{props.error ?? "Could not inspect setup"}</text>}>
          {(preflight) => (
            <>
              <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={cardSurface(props.ctx.theme, 0.18)}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={props.ctx.theme.text.base}><b>Global profile</b></text>
                  <text fg={preflight().blockers.length ? props.ctx.theme.text.feedback.error.base : preflight().moves.length || preflight().warnings.length ? props.ctx.theme.text.feedback.warning.base : props.ctx.theme.text.feedback.success.base}>
                    <b>{preflightStatus(preflight())}</b>
                  </text>
                </box>
                <text fg={props.ctx.theme.text.muted}>{displaySetupPath(props.ctx, preflight().root)}</text>
                <text fg={props.ctx.theme.text.muted}>Read-only preview — no files have been moved.</text>
              </box>

              <Show when={preflight().moves.length > 0}>
                <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={cardSurface(props.ctx.theme, 0.14)}>
                  <text fg={props.ctx.theme.text.feedback.warning.base}><b>{`Proposed moves · ${preflight().moves.length}`}</b></text>
                  <For each={preflight().moves}>{(move) => (
                    <box flexDirection="column" paddingLeft={1}>
                      <text fg={props.ctx.theme.text.base}>{`• ${displaySetupPath(props.ctx, move.from)}`}</text>
                      <text fg={props.ctx.theme.text.muted}>{`  → ${displaySetupPath(props.ctx, move.to)}`}</text>
                      <text fg={props.ctx.theme.text.muted} wrapMode="word">{`${move.files} files · ${move.detail}`}</text>
                    </box>
                  )}</For>
                </box>
              </Show>

              <PreflightGroup ctx={props.ctx} title="Blockers" items={preflight().blockers} color="error" />
              <PreflightGroup ctx={props.ctx} title="Portability warnings" items={preflight().warnings} color="warning" />
              <PreflightGroup ctx={props.ctx} title="Already standard" items={preflight().ready} />
              <PreflightGroup ctx={props.ctx} title="Excluded from profile" items={preflight().excluded} />
              <PreflightGroup ctx={props.ctx} title="Project-specific · not synced" items={preflight().project} />
            </>
          )}
        </Show>
      </Show>
    </box>
  )
}
