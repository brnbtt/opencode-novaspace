// Explicit opt-in only: creates and deletes a temporary PRIVATE GitHub repository.
// Uses synthetic cards in temporary folders; never reads the real novaSpace folder.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathsIn } from "../src/paths"
import { CardSync } from "../src/sync/engine"
import { gh, githubRemote, remotePath } from "../src/sync/remote"

if (!process.argv.includes("--allow-create-delete")) throw new Error("Requires --allow-create-delete and approval to create/delete a private GitHub test repository")
const account = await githubRemote.account()
const stamp = new Date().toISOString().replace(/[-:.]/g, "")
const repository = `${account}/novaspace-cards-e2e-${stamp}`
const home = await mkdtemp(join(tmpdir(), "novaspace-live-sync-"))
let created = false
const report: string[] = []
function check(value: unknown, message: string) { if (!value) throw new Error(message); report.push(message); console.log(`PASS ${message}`) }
const card = (title: string) => `export default { apiVersion: 1, title: ${JSON.stringify(title)}, render() { return null } }\n`

try {
  const machine = async (name: string) => {
    const paths = pathsIn(join(home, name, "novaspace"), join(home, name, "state"))
    await mkdir(join(paths.cards, "hello"), { recursive: true })
    return new CardSync(paths, githubRemote)
  }
  const a = await machine("machine-a"), b = await machine("machine-b")
  await writeFile(join(a.paths.cards, "hello", "index.js"), card("Hello"))
  await writeFile(join(a.paths.cards, "shared.js"), "export const shared = 1\n")
  await writeFile(a.paths.layout, JSON.stringify({ version: 1, cards: ["account", "custom:hello"] }))
  await mkdir(join(a.paths.cards, "secret"), { recursive: true })
  await writeFile(join(a.paths.cards, "secret", "index.js"), 'export const token = "ghp_syntheticsyntheticsynthetic0000"\n')

  // Set before connecting: connect creates the repository and can still fail afterwards.
  created = true
  const first = await a.connect({ repository, create: true })
  check(first.status === "synced", `Machine A creates the repository and uploads (${first.status}${first.message ? `: ${first.message}` : ""})`)
  check(!Object.keys((await githubRemote.read(repository)).files).some((key) => key.startsWith("cards/secret/")), "Cards with credentials stay local")
  check((await b.connect({ repository })).status === "synced", "Machine B connects and restores")
  check((await readFile(join(b.paths.cards, "hello", "index.js"), "utf8")) === card("Hello"), "Card files restored")
  check(JSON.parse(await readFile(b.paths.layout, "utf8")).cards.includes("custom:hello"), "Layout restored")

  await writeFile(join(a.paths.cards, "hello", "index.js"), card("From A"))
  await writeFile(join(b.paths.cards, "hello", "index.js"), card("From B"))
  await a.sync()
  check((await b.sync()).status === "conflict", "Concurrent edits pause without overwriting")
  check((await b.sync("remote")).status === "synced", "Explicit resolution succeeds")
  check((await readFile(join(b.paths.cards, "hello", "index.js"), "utf8")) === card("From A"), "Chosen version applied")

  // Wait for the production one-minute timer and cross-process throttle.
  await writeFile(join(a.paths.cards, "hello", "index.js"), card("Automatic"))
  const stop = a.start()
  try {
    await Bun.sleep(65_000)
    const remote = await githubRemote.read(repository)
    check(Buffer.from(remote.files["cards/hello/index.js"]!, "base64").toString() === card("Automatic"), `Automatic sync publishes a local edit to ${remotePath}`)
  } finally { await stop() }
  console.log(JSON.stringify({ repository, checks: report.length, result: "passed" }))
} finally {
  try {
    if (created) {
      await gh(["repo", "delete", repository, "--yes"])
        .then(() => console.log(`Deleted test repository: ${repository}`))
        .catch((error) => console.error(`Could not delete ${repository}: ${error instanceof Error ? error.message : String(error)}`))
    }
  } finally { await rm(home, { recursive: true, force: true }) }
}
