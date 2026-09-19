export type Quota = {
  login: string
  used: number
  limit: number | null
  remaining: number | null
  resetAt: string | null
  fetchedAt: number
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function parseQuota(value: unknown, now = Date.now()): Quota {
  const user = record(value)
  const quota = record(record(user.quota_snapshots).premium_interactions)
  if (user.token_based_billing !== true && quota.token_based_billing !== true) {
    throw new Error("This account does not report AI-credit billing")
  }
  const limit = number(quota.entitlement)
  const remaining = number(quota.quota_remaining) ?? number(quota.remaining)
  const unlimited = quota.unlimited === true
  if ((!unlimited && (limit === undefined || limit <= 0 || remaining === undefined)) || typeof user.login !== "string") {
    throw new Error("Copilot did not return a usable credit allowance")
  }
  // GitHub's "Usage this cycle" displays entitlement minus remaining.
  // credits_used can differ from allowance consumption; do not substitute it.
  const used = unlimited ? number(quota.credits_used) : Math.max(0, limit! - remaining!)
  if (used === undefined || used < 0) throw new Error("Copilot did not return credit usage")
  const reset = user.quota_reset_date_utc ?? user.quota_reset_date
  const resetAt = typeof reset === "string" && Number.isFinite(Date.parse(reset))
    ? new Date(reset).toISOString()
    : null
  return {
    login: user.login,
    used,
    limit: unlimited ? null : limit!,
    remaining: unlimited ? null : remaining!,
    resetAt,
    fetchedAt: now,
  }
}

export async function fetchQuota(signal?: AbortSignal): Promise<Quota> {
  // gh owns authentication. No tokens are copied into config or plugin storage.
  const executable = Bun.which("gh") ?? "/opt/homebrew/bin/gh"
  const process = Bun.spawn([executable, "api", "--hostname", "github.com", "/copilot_internal/user"], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...Bun.env, GH_PROMPT_DISABLED: "1" },
  })
  let timedOut = false
  const kill = () => process.kill()
  const timer = setTimeout(() => { timedOut = true; kill() }, 15_000)
  signal?.addEventListener("abort", kill, { once: true })
  if (signal?.aborted) kill()
  try {
    const [output, code] = await Promise.all([new Response(process.stdout).text(), process.exited])
    if (signal?.aborted) throw new Error("Refresh cancelled")
    if (timedOut) throw new Error("Copilot usage request timed out")
    if (code !== 0) throw new Error("Check your GitHub CLI sign-in, then refresh")
    try {
      return parseQuota(JSON.parse(output))
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Copilot returned an invalid usage response")
      throw error
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", kill)
  }
}

type CostSession = { id: string; parentID?: string; cost?: number }

export function sessionCredits(sessionID: string, sessions: readonly CostSession[]) {
  const included = new Set([sessionID])
  let added = true
  while (added) {
    added = false
    for (const session of sessions) {
      if (session.parentID && included.has(session.parentID) && !included.has(session.id)) {
        included.add(session.id)
        added = true
      }
    }
  }
  const costs = new Map(sessions.filter(s => included.has(s.id)).map(s => [s.id, s.cost]))
  const usd = [...costs.values()].reduce<number>((sum, cost) => sum + (typeof cost === "number" && Number.isFinite(cost) ? Math.max(0, cost) : 0), 0)
  const ownCost = costs.get(sessionID)
  return { credits: usd * 100, workers: Math.max(0, costs.size - 1), available: typeof ownCost === "number" && Number.isFinite(ownCost) }
}

export function progress(used: number, limit: number | null, width = 24) {
  const fraction = limit && limit > 0 ? Math.max(0, used / limit) : 0
  const filled = Math.round(Math.min(1, fraction) * width)
  return { percent: fraction * 100, filled: "━".repeat(filled), empty: "─".repeat(width - filled) }
}

export function resetLabel(resetAt: string | null, now = Date.now()) {
  if (!resetAt) return "Reset date unavailable"
  const delta = Date.parse(resetAt) - now
  if (delta <= 0) return "Period ended · refresh pending"
  const date = new Date(resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `Resets ${date} · ${Math.ceil(delta / 86_400_000)}d`
}
