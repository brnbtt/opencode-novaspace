export type ProfileState = {
  login?: string
  connection: "signed-out" | "connected"
  sync: "unconfigured" | "syncing" | "synced" | "pending" | "error"
  lastSyncedAt?: number
  error?: string
}

export async function loadGitHubProfile(signal?: AbortSignal): Promise<ProfileState> {
  const executable = Bun.which("gh")
  if (!executable) return { connection: "signed-out", sync: "unconfigured" }
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const process = Bun.spawn([executable, "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...Bun.env, GH_PROMPT_DISABLED: "1" },
      signal,
    })
    timer = setTimeout(() => { timedOut = true; process.kill() }, 5_000)
    const [stdout, code] = await Promise.all([new Response(process.stdout).text(), process.exited])
    const login = stdout.trim()
    if (signal?.aborted) throw new Error("Profile lookup cancelled")
    if (timedOut) throw new Error("GitHub profile lookup timed out")
    if (code !== 0 || !login) return { connection: "signed-out", sync: "unconfigured" }
    return { login, connection: "connected", sync: "unconfigured" }
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      connection: "signed-out",
      sync: "unconfigured",
      error: error instanceof Error ? error.message : "GitHub profile unavailable",
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
