import type { MemoryContext, MemorySearch, MemoryStatus } from "./types"

const DEFAULT_MEMO = `${process.env.HOME ?? "~"}/.optmem/memo`

export class MemoError extends Error {
  constructor(message: string, readonly code: number) {
    super(message)
    this.name = "MemoError"
  }
}

export type MemoBackendOptions = {
  executable?: string
  env?: Record<string, string | undefined>
}

export function createMemoBackend(options: MemoBackendOptions = {}) {
  const executable = options.executable ?? process.env.OPTMEM_MEMO ?? DEFAULT_MEMO

  async function run(args: string[], signal?: AbortSignal) {
    const child = Bun.spawn([executable, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...options.env },
      signal,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0) throw new MemoError(stderr.trim() || stdout.trim() || `memo exited with code ${code}`, code)
    return stdout.trim()
  }

  async function json<T>(args: string[], signal?: AbortSignal): Promise<T> {
    const output = await run(["api", ...args], signal)
    try {
      return JSON.parse(output) as T
    } catch {
      throw new MemoError("memo returned invalid JSON", 0)
    }
  }

  return {
    activate: (signal?: AbortSignal) => run(["wake"], signal),
    status: (signal?: AbortSignal) => json<MemoryStatus>(["status"], signal),
    context: (scope: string, signal?: AbortSignal) => json<MemoryContext>(["context", scope], signal),
    search: (query: string, limit = 20, signal?: AbortSignal) =>
      json<MemorySearch>(["search", query, String(limit)], signal),
    async note(scope: string, text: string, signal?: AbortSignal) {
      const output = await run(["note", "--scope", scope, text], signal)
      const id = Number(output.match(/Saved as #(\d+)\./)?.[1])
      const status = await json<MemoryStatus>(["status"], signal)
      return { id: Number.isFinite(id) ? id : null, pending: status.pending }
    },
    async supersede(id: number, scope: string | undefined, text: string, signal?: AbortSignal) {
      const args = ["supersede", ...(scope ? ["--scope", scope] : []), String(id), text]
      const output = await run(args, signal)
      const replacement = Number(output.match(/#(\d+) is authoritative\./)?.[1])
      const status = await json<MemoryStatus>(["status"], signal)
      return { id, replacement: Number.isFinite(replacement) ? replacement : null, pending: status.pending }
    },
    async maintenance(block?: string, summary?: string, signal?: AbortSignal) {
      if ((block === undefined) !== (summary === undefined)) {
        throw new MemoError("Provide both block and summary, or neither.", 0)
      }
      return run(block === undefined ? ["nap"] : ["nap", block, summary!], signal)
    },
  }
}

export type MemoBackend = ReturnType<typeof createMemoBackend>
