import type { Snapshot } from "./sync-files"
import { validateSnapshot } from "./sync-files"

export type RemoteSnapshot = { files: Snapshot; revision?: string }
export interface SyncRemote {
  account(): Promise<string>
  create?(repository: string): Promise<void>
  verify(repository: string): Promise<void>
  read(repository: string): Promise<RemoteSnapshot>
  write(repository: string, files: Snapshot, revision?: string): Promise<string>
}
export async function gh(args: string[], input?: unknown) {
  const child = Bun.spawn(["gh", ...args], {
    stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" },
  })
  const timer = setTimeout(() => child.kill(), 30_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(err.trim() || "GitHub request failed or timed out")
    return out.trim()
  } finally { clearTimeout(timer) }
}
export function validRepository(repository: string) {
  const value = repository.trim()
  // Enterprise-managed GitHub usernames include an underscore and enterprise
  // suffix (for example, person_company).
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("Use an owner/repository name")
  return value
}
export const githubRemote: SyncRemote = {
  account: () => gh(["api", "user", "--jq", ".login"]),
  async create(repository) {
    await gh(["repo", "create", validRepository(repository), "--private", "--description", "Personal OpenCode profile synced by novaSpace"])
  },
  async verify(repository) {
    validRepository(repository)
    const result = JSON.parse(await gh(["api", `repos/${repository}`]))
    if (!result.private || !result.permissions?.push) throw new Error("Choose a private repository you can push to")
  },
  async read(repository) {
    validRepository(repository)
    let out: string
    try { out = await gh(["api", `repos/${repository}/contents/.novaspace/profile.json`]) }
    catch (error) {
      if (error instanceof Error && /HTTP 404|Git Repository is empty/.test(error.message)) return { files: {} }
      throw error
    }
    const file = JSON.parse(out)
    if (file.type !== "file" || file.encoding !== "base64" || file.size > 1_000_000) throw new Error("Unsupported remote profile file")
    const data = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))
    if (data.version !== 1) throw new Error("Unsupported profile format")
    return { files: validateSnapshot(data.files), revision: file.sha }
  },
  async write(repository, files, revision) {
    validRepository(repository)
    const result = JSON.parse(await gh(["api", "--method", "PUT", `repos/${repository}/contents/.novaspace/profile.json`, "--input", "-"], {
      message: "Sync OpenCode profile with novaSpace",
      content: Buffer.from(JSON.stringify({ version: 1, files }, null, 2) + "\n").toString("base64"),
      ...(revision ? { sha: revision } : {}),
    }))
    return result.content.sha
  },
}
