import { createMemoBackend } from "./backend"
import { compactBytes, formatContext, formatSearch, scopeCount, statusSummary } from "./format"
import type { ServerContext, ToolDefinition } from "../../types"

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const string = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra })
const integer = (description: string, extra: Record<string, unknown> = {}) => ({ type: "integer", description, ...extra })

function text(input: unknown, key: string) {
  const value = (input as Record<string, unknown>)[key]
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`)
  return value.trim()
}

function optionalText(input: unknown, key: string) {
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function memoryText(scope: string, fact: string) {
  const bytes = new TextEncoder().encode(`[${scope}] ${fact}`).length
  if (bytes > 280) throw new Error(`Scoped memory is ${bytes} bytes; OptMem allows 280.`)
  return fact
}

function tool(definition: ToolDefinition) {
  return { ...definition, options: { namespace: "memory", codemode: true } }
}

export default {
  async setup(ctx: ServerContext) {
    const memo = createMemoBackend()
    const registration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "memory",
        description: "Read and deliberately update durable cross-session OptMem facts. Use handoffs, not memory, for progress or temporary state.",
      })

      editor.add(tool({
        name: "activate",
        description: "Load the complete compressed OptMem context at primary-session startup. Run once before other work; do not run from subagents.",
        input: object({}),
        async execute(_input, call) {
          await call.progress({ status: "Activating memory" })
          return { content: await memo.activate() }
        },
      }))

      editor.add(tool({
        name: "status",
        description: "Show compact OptMem health, size, scope, and context-budget information.",
        input: object({}),
        async execute(_input, call) {
          await call.progress({ status: "Checking memory" })
          const status = await memo.status()
          return { content: [
            "Memory status",
            statusSummary(status),
            `${scopeCount(status)} explicit scopes · ${status.legacyUnscoped} legacy/unscoped`,
            `${status.summaries} summaries · ${status.superseded} superseded · ${status.redacted} redacted`,
            `${compactBytes(status.storeBytes)} on disk · wake budget ${status.wake.lines}/${status.wake.budget} lines`,
          ].join("\n") }
        },
      }))

      editor.add(tool({
        name: "context",
        description: "Read active raw memories for one project/service scope plus global memories.",
        input: object({ scope: string("Exact repository, project, or service scope.", { maxLength: 64 }) }, ["scope"]),
        async execute(input, call) {
          const scope = text(input, "scope")
          await call.progress({ status: `Reading ${scope} memory` })
          return { content: formatContext(await memo.context(scope)) }
        },
      }))

      editor.add(tool({
        name: "search",
        description: "Search all raw memories for literal text. Results include inactive historical claims so corrections remain auditable.",
        input: object({
          query: string("Literal text to find."),
          limit: integer("Maximum newest matches to return.", { minimum: 1, maximum: 100, default: 20 }),
        }, ["query"]),
        async execute(input, call) {
          const record = input as Record<string, unknown>
          const limit = typeof record.limit === "number" ? record.limit : 20
          await call.progress({ status: "Searching memory" })
          return { content: formatSearch(await memo.search(text(input, "query"), limit)) }
        },
      }))

      editor.add(tool({
        name: "remember",
        description: "Save one verified final durable fact. Never use for progress, changing status, intermediate designs, or facts cheaply recovered elsewhere.",
        input: object({
          scope: string("Repository/service/project scope; use global only for cross-project facts.", { maxLength: 64 }),
          fact: string("One concise durable fact, including caveat or source pointer when useful.", { maxLength: 240 }),
        }, ["scope", "fact"]),
        async execute(input, call) {
          const scope = text(input, "scope")
          const fact = memoryText(scope, text(input, "fact"))
          await call.progress({ status: `Saving ${scope} memory` })
          const saved = await memo.note(scope, fact)
          return { content: `Memory saved${saved.id === null ? "" : ` · #${saved.id}`} · ${scope}${saved.pending ? `\n${saved.pending} compression pending; call memory_maintain before continuing.` : "\nMemory is settled."}` }
        },
      }))

      editor.add(tool({
        name: "correct",
        description: "Append an authoritative correction and mark one exact prior memory inactive.",
        input: object({
          id: integer("Raw memory ID to supersede.", { minimum: 0 }),
          correction: string("Corrected final durable fact.", { maxLength: 220 }),
          scope: string("Optional replacement scope; otherwise preserve the original explicit scope.", { maxLength: 64 }),
        }, ["id", "correction"]),
        async execute(input, call) {
          const record = input as Record<string, unknown>
          if (!Number.isInteger(record.id) || (record.id as number) < 0) throw new Error("id must be a non-negative integer")
          await call.progress({ status: `Correcting memory #${record.id}` })
          const saved = await memo.supersede(record.id as number, optionalText(input, "scope"), text(input, "correction"))
          return { content: `Memory corrected · #${saved.id} → #${saved.replacement ?? "?"}${saved.pending ? `\n${saved.pending} compression pending; call memory_maintain before continuing.` : "\nMemory is settled."}` }
        },
      }))

      editor.add(tool({
        name: "maintain",
        description: "Read the next required compression prompt, or settle that exact block with a concise faithful summary. Call without arguments first.",
        input: object({
          block: string("Exact pending block, such as 92-93."),
          summary: string("One faithful summary no longer than 280 bytes.", { maxLength: 280 }),
        }),
        async execute(input, call) {
          const block = optionalText(input, "block")
          const summary = optionalText(input, "summary")
          await call.progress({ status: block ? `Settling memory ${block}` : "Checking memory maintenance" })
          const output = await memo.maintenance(block, summary)
          return { content: output || "Memory is settled." }
        },
      }))
    })
    return () => registration.dispose()
  },
}
