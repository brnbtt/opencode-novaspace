import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export function githubAccountConfig() {
  const home = Bun.env.HOME ?? homedir()
  const directory = Bun.env.GH_CONFIG_DIR ?? join(Bun.env.XDG_CONFIG_HOME ?? join(home, ".config"), "gh")
  return join(directory, "hosts.yml")
}

/**
 * A change stamp for the active GitHub account. `gh auth switch` and
 * `gh auth login` rewrite this file, so polling its mtime notices an account
 * change without spawning `gh` or spending an API call on every tick.
 */
export async function githubAccountStamp(): Promise<number | undefined> {
  try {
    return (await stat(githubAccountConfig())).mtimeMs
  } catch {
    return undefined
  }
}

/** The signed-in GitHub login from the GitHub CLI, or undefined when signed out. */
export async function loadGitHubLogin(signal?: AbortSignal): Promise<string | undefined> {
  const executable = Bun.which("gh")
  if (!executable) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const child = Bun.spawn([executable, "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...Bun.env, GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" },
      signal,
    })
    timer = setTimeout(() => child.kill(), 5_000)
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (signal?.aborted) throw new Error("GitHub lookup cancelled")
    const login = stdout.trim()
    return code === 0 && login ? login : undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
  }
}
