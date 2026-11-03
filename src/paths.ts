import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Everything novaSpace owns on disk. The `root` folder holds the user's cards
 * and their layout, and is exactly what card sync copies between machines.
 * Sync bookkeeping (base snapshot, lease, backups) stays machine-local in
 * `state`.
 */
export type NovaPaths = {
  root: string
  cards: string
  layout: string
  state: string
}

export function novaPaths(): NovaPaths {
  // Windows does not set HOME; fall back to the operating system's home folder.
  const home = process.env.HOME ?? homedir()
  const root = join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode", "novaspace")
  return {
    root,
    cards: join(root, "cards"),
    layout: join(root, "layout.json"),
    state: join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "novaspace"),
  }
}

export function pathsIn(root: string, state = join(root, ".state")): NovaPaths {
  return { root, cards: join(root, "cards"), layout: join(root, "layout.json"), state }
}
