// Explicit opt-in only: creates and deletes a temporary PRIVATE GitHub repository.
// Uses synthetic fixtures in temporary homes; never reads the real OpenCode profile.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProfileSync } from "../src/cards/setup/sync"
import { gh, githubRemote } from "../src/cards/setup/sync-remote"

if (!process.argv.includes("--allow-create-delete")) throw new Error("Requires --allow-create-delete and approval to create/delete a private GitHub test repository")
const account = await githubRemote.account()
const stamp = new Date().toISOString().replace(/[-:.]/g, "")
const repository = `${account}/novaspace-sync-e2e-${stamp}`
const home = await mkdtemp(join(tmpdir(), "novaspace-live-sync-"))
let created = false
const report: string[] = []
function check(value: unknown, message: string) { if (!value) throw new Error(message); report.push(message); console.log(`PASS ${message}`) }
try {
  await gh(["repo", "create", repository, "--private", "--description", "Temporary novaSpace synthetic sync verification"])
  created = true
  const machine = async (name: string) => {
    const root = join(home, name)
    const engine = new ProfileSync({ home: root, config: join(root, "config"), state: join(root, "state") })
    await mkdir(engine.paths.config, { recursive: true })
    await engine.configure({ repository, selected: ["settings", "terminal", "instructions", "skills"], allowMachinePaths: false })
    return engine
  }
  const a = await machine("machine-a"), b = await machine("machine-b")
  await writeFile(join(a.paths.config, "opencode.jsonc"), '{"model":"example/default-model","plugins":["opencode-novaspace"],"mcp":{"servers":{}}}\n')
  await writeFile(join(a.paths.config, "cli.json"), '{"theme":{"name":"tokyonight"},"keybinds":{"leader":"ctrl+x"}}\n')
  await writeFile(join(a.paths.config, "service.json"), '{"synthetic":"must-stay-local"}')
  await mkdir(join(a.paths.home, ".agents/skills/example"), { recursive: true })
  await writeFile(join(a.paths.home, ".agents/skills/example/SKILL.md"), "# Example synthetic skill\n")
  const first = await a.sync()
  check(first.status === "synced", `Initial upload (${first.status}${first.status === "error" ? `: ${first.message}` : ""})`)
  check((await b.sync()).status === "synced", "Fresh machine restores from GitHub")
  check((await readFile(join(b.paths.config, "opencode.jsonc"), "utf8")).includes("default-model"), "Default model and shared config restored")
  check((await readFile(join(b.paths.config, "cli.json"), "utf8")).includes("ctrl+x"), "Terminal preferences restored")
  check(await Bun.file(join(b.paths.home, ".agents/skills/example/SKILL.md")).exists(), "Compatibility-folder skills restored")
  check(!(await Bun.file(join(b.paths.config, "service.json")).exists()), "Machine-local service settings excluded")
  await writeFile(join(a.paths.config, "AGENTS.md"), "Synthetic machine A instructions\n")
  await writeFile(join(b.paths.config, "cli.json"), '{"theme":{"name":"opencode"}}\n')
  check((await a.sync()).status === "synced" && (await b.sync()).status === "synced" && (await a.sync()).status === "synced", "Independent changes converge across machines")
  await writeFile(join(a.paths.config, "AGENTS.md"), "Changed on A\n")
  await writeFile(join(b.paths.config, "AGENTS.md"), "Changed on B\n")
  await a.sync()
  check((await b.sync()).status === "conflict", "Concurrent same-file edits pause without overwrite")
  check((await readFile(join(b.paths.config, "AGENTS.md"), "utf8")) === "Changed on B\n", "Conflict preserves local data")
  check((await b.sync("remote")).status === "synced", "Explicit remote resolution succeeds")
  await a.automatic(true)
  // Wait for the production one-minute timer and cross-process throttle.
  await writeFile(join(a.paths.config, "AGENTS.md"), "Automatic update\n")
  const stop = a.start()
  try {
    await Bun.sleep(65_000)
    const remote = await githubRemote.read(repository)
    check(Buffer.from(remote.files["config/AGENTS.md"]!, "base64").toString() === "Automatic update\n", "Production automatic timer publishes a local edit")
  } finally { await stop() }
  await a.automatic(false)
  check((await b.sync()).status === "synced" && (await readFile(join(b.paths.config, "AGENTS.md"), "utf8")) === "Automatic update\n", "Second machine receives automatic update")
  console.log(JSON.stringify({ repository, checks: report.length, result: "passed" }))
} finally {
  try {
    if (created) {
      await gh(["repo", "delete", repository, "--yes"])
      console.log(`Deleted test repository: ${repository}`)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
}
