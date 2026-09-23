/** @jsxImportSource @opentui/solid */
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { JSX } from "solid-js"
import type { CardProps } from "./card"
import { resolveOptions, type CustomCardID } from "./config"
import { registerCustomCard } from "./cards/registry"
import type { TuiContext } from "./types"
import { Card, CardAction, CardTitle, cardHeader, metricRow } from "./ui"

// Shared card chrome handed to custom cards so they match built-in cards
// without importing novaSpace internals.
export const cardChrome = { Card, CardAction, CardTitle, cardHeader, metricRow }
export type CardChrome = typeof cardChrome
export type CustomCardProps = CardProps & { chrome: CardChrome }
export type CustomCardModule = {
  apiVersion: 1
  title: string
  render(props: CustomCardProps): JSX.Element
}

export const customCardApiVersion = 1

function expand(path: string) {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

function isModule(value: unknown): value is CustomCardModule {
  const candidate = value as Partial<CustomCardModule> | undefined
  return !!candidate && candidate.apiVersion === customCardApiVersion
    && typeof candidate.title === "string" && typeof candidate.render === "function"
}

// Copies property descriptors so reactive getters on the host props stay live.
function withChrome(props: CardProps): CustomCardProps {
  return Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(props),
    chrome: { value: cardChrome, enumerable: true },
  }) as CustomCardProps
}

export async function loadCustomCard(id: CustomCardID, path: string) {
  const module = await import(pathToFileURL(expand(path)).href)
  const definition = module.default
  if (!isModule(definition)) throw new Error(`expected a default export { apiVersion: ${customCardApiVersion}, title, render }`)
  return registerCustomCard({ id, title: definition.title, render: (props) => definition.render(withChrome(props)) })
}

// Loads in the background; cards appear once registered. A failing module is
// skipped with a toast so one broken card cannot take the sidebar down.
export function loadCustomCards(ctx: TuiContext) {
  const stops: (() => void)[] = []
  let disposed = false
  for (const [id, path] of Object.entries(resolveOptions(ctx.options).customCards)) {
    loadCustomCard(id as CustomCardID, path).then((stop) => {
      if (disposed) stop()
      else stops.push(stop)
    }).catch((error) => {
      if (disposed) return
      ctx.ui.toast.show({ title: "novaSpace", message: `Could not load custom card ${id}: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
    })
  }
  return () => {
    disposed = true
    for (const stop of stops.splice(0)) stop()
  }
}
