/** @jsxImportSource @opentui/solid */
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createSignal, type JSX } from "solid-js"
import type { CardProps } from "./card"
import { isCustomCardName, type CustomCardID } from "./config"
import { registerCustomCard } from "./cards/registry"
import type { TuiContext } from "./types"
import { Card, CardAction, CardTitle, Empty, Item, Meter, Pill, Stat, cardHeader, metricRow } from "./ui"

// The baseline kit handed to custom cards, so a card built from it looks at
// home in the sidebar without importing novaSpace internals.
export const cardChrome = { Card, CardAction, CardTitle, Empty, Item, Meter, Pill, Stat, cardHeader, metricRow }
export type CardChrome = typeof cardChrome
export type CustomCardProps = CardProps & { chrome: CardChrome }
export type CustomCardModule = {
  apiVersion: 1
  title: string
  render(props: CustomCardProps): JSX.Element
}

export const customCardApiVersion = 1

/** A card is a folder in the cards folder with an `index.js` entry module. */
export type FoundCard = { id: CustomCardID; name: string; path: string; version: number }

export async function discoverCards(directory: string): Promise<FoundCard[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const found: FoundCard[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isCustomCardName(entry.name)) continue
    const path = join(directory, entry.name, "index.js")
    const info = await stat(path).catch(() => undefined)
    if (info?.isFile()) found.push({ id: `custom:${entry.name}`, name: entry.name, path, version: info.mtimeMs })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
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
  const module = await import(pathToFileURL(path).href)
  const definition = module.default
  if (!isModule(definition)) throw new Error(`expected a default export { apiVersion: ${customCardApiVersion}, title, render }`)
  return registerCustomCard({ id, title: definition.title, render: (props) => definition.render(withChrome(props)) })
}

export type CardLibrary = ReturnType<typeof createCardLibrary>

/**
 * Keeps the registry in step with the cards folder: new card folders load as
 * soon as they appear (including ones sync brings in) and removed ones unload.
 * A changed card keeps running its loaded code until restart, because a module
 * and the helpers it imports cannot be reloaded consistently. A failing module
 * is skipped with one toast so a broken card cannot take the sidebar down.
 */
export function createCardLibrary(ctx: TuiContext, directory: string, options: { poll?: number } = {}) {
  const loaded = new Map<CustomCardID, { version: number; stop(): void }>()
  const reported = new Map<CustomCardID, number>()
  const [found, setFound] = createSignal<FoundCard[]>([])
  let disposed = false
  let queue = Promise.resolve()
  const toast = (message: string, variant: "error" | "info") => {
    if (!disposed) ctx.ui.toast.show({ title: "novaSpace", message, variant })
  }

  const scan = async () => {
    const cards = await discoverCards(directory).catch((error) => {
      toast(`Could not read the cards folder: ${error instanceof Error ? error.message : String(error)}`, "error")
      return undefined
    })
    if (!cards || disposed) return
    setFound(cards)
    for (const [id, entry] of loaded) {
      if (cards.some((card) => card.id === id)) continue
      entry.stop()
      loaded.delete(id)
    }
    await Promise.all(cards.map(async (card) => {
      const current = loaded.get(card.id)
      if (current) {
        if (current.version !== card.version && reported.get(card.id) !== card.version) {
          reported.set(card.id, card.version)
          toast(`${card.name} changed. Restart OpenCode to load the new version.`, "info")
        }
        return
      }
      if (reported.get(card.id) === card.version) return
      try {
        const stop = await loadCustomCard(card.id, card.path)
        if (disposed) return stop()
        loaded.set(card.id, { version: card.version, stop })
        reported.delete(card.id)
      } catch (error) {
        reported.set(card.id, card.version)
        toast(`Could not load card ${card.name}: ${error instanceof Error ? error.message : String(error)}`, "error")
      }
    }))
  }
  const refresh = () => (queue = queue.then(scan, scan))
  void refresh()
  const timer = setInterval(() => void refresh(), options.poll ?? 5_000)
  return {
    directory,
    found,
    refresh,
    dispose() {
      disposed = true
      clearInterval(timer)
      for (const entry of loaded.values()) entry.stop()
      loaded.clear()
    },
  }
}
