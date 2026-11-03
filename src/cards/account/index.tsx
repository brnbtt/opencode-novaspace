/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Card, faint, novaMark, toneColor } from "../../ui"
import { defineCard, type CardProps } from "../../card"
import { novaPaths } from "../../paths"
import { customCards } from "../registry"
import { githubAccountStamp, loadGitHubLogin } from "../../sync/account"
import { cardSync, type CardSync, type SyncState } from "../../sync/engine"
import { showAccountDialog, type UpdateHooks } from "./dialog"
import { summary, syncBadge } from "./status"

export function AccountCard(props: CardProps & {
  loadLogin?: (signal?: AbortSignal) => Promise<string | undefined>
  accountStamp?: () => Promise<number | undefined>
  accountPollMs?: number
  engine?: CardSync
  cardsDirectory?: string
  open?: (path: string) => Promise<void>
  update?: UpdateHooks
}) {
  const engine = props.engine ?? cardSync()
  const [login, setLogin] = createSignal<string>()
  const [state, setState] = createSignal<SyncState>()
  const [now, setNow] = createSignal(Date.now())
  let disposed = false
  let lookup = 0
  let abort: AbortController | undefined
  let stamp: number | undefined

  // The signed-in account can change at any time (`gh auth switch`), so this
  // has to be re-runnable rather than a one-shot mount effect.
  const refreshLogin = async () => {
    const current = ++lookup
    abort?.abort()
    const controller = abort = new AbortController()
    const value = await (props.loadLogin ?? loadGitHubLogin)(controller.signal).catch(() => undefined)
    if (!disposed && current === lookup) setLogin(value)
  }
  const refreshState = () => engine.state().then((value) => { if (!disposed) setState(value) }).catch(() => {})

  onMount(() => {
    void refreshLogin()
    void refreshState()
    onCleanup(engine.subscribe((value) => { if (!disposed) setState(value) }))
    const accountStamp = props.accountStamp ?? githubAccountStamp
    void accountStamp().then((value) => { stamp = value })
    const accountWatch = setInterval(() => {
      void accountStamp().then((value) => {
        if (disposed || value === stamp) return
        stamp = value
        void refreshLogin()
      })
    }, props.accountPollMs ?? 5_000)
    // Other OpenCode windows sync through the same state file.
    const stateWatch = setInterval(() => { setNow(Date.now()); void refreshState() }, 5_000)
    onCleanup(() => { clearInterval(accountWatch); clearInterval(stateWatch) })
  })
  onCleanup(() => { disposed = true; abort?.abort() })

  const badge = createMemo(() => syncBadge(login(), state()))
  const open = () => {
    if (props.dragging) return
    showAccountDialog({
      ctx: props.ctx,
      get login() { return login() },
      cardsDirectory: props.cardsDirectory ?? novaPaths().cards,
      engine,
      open: props.open,
      update: props.update,
    })
    void refreshLogin()
  }
  const theme = () => props.ctx.theme

  return (
    <Card
      theme={theme()}
      strength={props.pin ? props.options.pinnedSurfaceStrength : props.options.surfaceStrength}
      hoverStrength={props.options.hoverStrength}
      hoverDuration={props.options.hoverDuration}
      onPress={open}
    >
      <box id="account-header" flexDirection="row" justifyContent="space-between" gap={1} height={1} flexShrink={0}>
        <box flexDirection="row" gap={1} minWidth={0} flexShrink={1}>
          <text selectable={false} flexShrink={0} fg={theme().text.feedback.info.base}>{novaMark}</text>
          <text selectable={false} minWidth={0} flexShrink={1} wrapMode="none" truncate fg={theme().text.base}><b>{login() ? `@${login()}` : "novaSpace"}</b></text>
        </box>
        <text id="account-sync" selectable={false} flexShrink={0} fg={toneColor(theme(), badge().tone)}>{`${badge().glyph} ${badge().label}`}</text>
      </box>
      <box flexDirection="row" justifyContent="space-between" gap={1} height={1} flexShrink={0}>
        <text id="account-summary" selectable={false} minWidth={0} flexShrink={1} wrapMode="none" truncate fg={theme().text.muted}>{summary(login(), state(), customCards().length, now())}</text>
        <text selectable={false} flexShrink={0} fg={faint(theme())}>›</text>
      </box>
    </Card>
  )
}

export const account = defineCard({
  id: "account",
  title: "novaSpace",
  render: (props) => <AccountCard {...props} />,
})
