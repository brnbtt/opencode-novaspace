/** @jsxImportSource @opentui/solid */
import { MouseButton } from "@opentui/core"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { TuiContext } from "../types"
import { cardSurface, toneColor } from "../ui"
import { novaPaths } from "../paths"
import { githubAccountStamp, loadGitHubLogin } from "../sync/account"
import { cardSync, type CardSync, type SyncState } from "../sync/engine"
import { showAccountDialog, type UpdateHooks } from "./dialog"
import { syncBadge } from "./status"

/**
 * One quiet line at the very bottom of the sidebar: who is signed in and
 * whether cards are in sync. Clicking it opens the novaSpace dialog.
 */
export function AccountLine(props: {
  ctx: TuiContext
  dragging?: boolean
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
  const [hovered, setHovered] = createSignal(false)
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
    const stateWatch = setInterval(() => void refreshState(), 5_000)
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
    <box
      id="account-line"
      flexDirection="row" justifyContent="space-between" gap={1} height={1} flexShrink={0}
      paddingLeft={1} paddingRight={1}
      backgroundColor={hovered() ? cardSurface(theme(), 0.18) : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== MouseButton.LEFT || event.isDragging) return
        event.stopPropagation()
        open()
      }}
    >
      <text id="account-login" selectable={false} minWidth={0} flexShrink={1} wrapMode="none" truncate fg={hovered() ? theme().text.base : theme().text.muted}>{login() ? `@${login()}` : "novaSpace"}</text>
      <text id="account-sync" selectable={false} flexShrink={0} fg={toneColor(theme(), badge().tone)}>{`${badge().glyph} ${badge().label}`}</text>
    </box>
  )
}
