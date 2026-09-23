# How profile sync works

This page describes profile sync in detail. For setup steps, see
[Sync your setup across machines](../README.md#sync-your-setup-across-machines).

## Views

The sync screen has three views:

- **Files** chooses which groups sync. **Details** lists the portable files and
  the entries kept local. It is read-only and needs no approval.
- **Repository** connects a private GitHub repository. **Connect & sync** uses an
  existing repository and **Create & sync** creates one. Either choice runs the
  first sync and turns on automatic sync after it succeeds.
- **Sync** shows the last sync, runs a manual sync, turns automatic sync on or off
  and disconnects.

Automatic sync checks once a minute while an OpenCode TUI is open. Changing the
selected groups keeps the connection's automatic or paused setting. Errors appear
near the header.

GitHub CLI (`gh auth login`) is required. Enterprise-managed GitHub usernames
with underscores are supported. Sync is bound to the account used when
connecting; switching accounts pauses transfers until you reconnect or switch
back.

## Groups

| Group | Included |
| --- | --- |
| OpenCode settings | Portable settings in global `opencode.json` and `opencode.jsonc`: configured default model, providers, plugins, MCP, permissions, inline agents and commands |
| Appearance & preferences | `cli.json`: theme, keybindings, terminal preferences and novaSpace plugin options; global `themes/` files |
| Skills | Global `skills/`, `~/.agents/skills/` and `~/.claude/skills/`, preserving their locations |
| Instructions | Global `AGENTS.md` |
| Agents & commands | Global `agents/` and `commands/` files |
| Local plugin files | Global `plugins/` scripts, opt-in |

Groups select their source files once, even when Plugins, MCP and Subagents share
one configuration file.

## What stays local

Preparation happens in a separate portable copy. Live files keep their locations,
paths, comments and formatting. Preparation does not migrate a directory layout or
rewrite working settings.

For JSON/JSONC settings, top-level sections containing literal credentials,
machine-specific paths, local executables or loopback endpoints stay local.
Portable sections from that same file still sync. For example, a configured
default model can sync while a local plugin checkout and private MCP credentials
stay exactly as configured on each machine. Incoming portable settings are merged
back into the original document without replacing its local-only sections.
Comments remain on their original machine; the repository holds a canonical
portable JSON representation.

Linked sources and non-config files with detected machine-specific content or
credentials are kept local automatically. If a skill or plugin bundle has a
local-only dependency, the entire bundle stays local rather than exporting an
incomplete copy. **Details** reports these exclusions without requesting action.

Session history, the current session's model choice, sign-ins and OAuth tokens,
environment variables, service settings, caches, project configuration, installed
package caches and saved card drag positions stay local. Initial card layout
options in `cli.json` can sync; drag positions in OpenCode's plugin storage cannot.
Referenced files outside the listed roots are not copied.

Package declarations travel with settings; OpenCode installs the packages on the
destination machine. Source checkouts do not need to exist on a consumer machine.

## Conflicts, backups and recovery

Sync merges edits to different files and independent top-level configuration
sections. Competing changes to the same portable setting or non-config file pause
for a genuine conflict; setup never guesses which existing version to replace.
Choose the local or repository versions explicitly in the sync screen.

Remote revisions remain in GitHub history. Replaced and deleted local files are
backed up under `~/.local/state/novaspace/backups/` before being applied. Restore
writes are staged before any live replacement; a staging failure leaves existing
files untouched. Failed applies roll back completed writes when possible, while
preserving edits made concurrently by the user.

Deletions propagate only after a file has been synced. Existing files on a newly
connected machine cause a conflict if their contents differ from the repository.

## Storage format and privacy

The GitHub repository stores a versioned `.novaspace/profile.json` snapshot with
base64 file contents (an `x:` prefix marks executable scripts). File ownership and
other permission bits stay local. Base64 is **not encryption**; repository access
controls protect the profile.

Detected credentials and machine-specific values are kept local, without changing
their original values to environment references. This detection is best-effort.
Existing `{env:NAME}` references are portable; sign in independently on each
machine. Symlinks and hard-linked files stay local; `.env`, `.git`,
`node_modules` and backup directories are excluded. Profiles are limited to
roughly 500 KB of file content and 1,000 files.

## Local state

State, selection, automation preference and backups are local to each machine,
under `$XDG_STATE_HOME/novaspace` (default `~/.local/state/novaspace`). Global
configuration follows `$XDG_CONFIG_HOME/opencode`. Multiple TUI windows share a
cross-process lease; concurrent remote writes use GitHub's revision check and
retry on the next sync. Offline failures keep local files and the last successful
baseline. Restart OpenCode after restoring plugins or server settings that require
a reload.

## Sync status

The setup card always starts in a usable local state from OpenCode's cached
inventory. GitHub identity lookup runs only as background enrichment. A missing
GitHub CLI, sign-in, or private profile repository is the normal unconfigured
state and shows a muted dot with **Set up sync** on hover; it never blocks local
setup discovery. The profile reports `syncing`, `synced`, `pending`, `paused`,
`conflict` and `error` from the local sync state.

The card re-reads the signed-in account when the settings open and whenever `gh`
rewrites its configuration. It watches that file's change stamp rather than
polling the GitHub API, so account detection spends no API calls and starts no
processes while the sidebar is idle.

## Profile format

Profile format **2** requires novaSpace **0.3.0 or later**. The current client can
read older snapshots and prepares them automatically. Older clients stop before
applying format 2, protecting their existing configuration. Update novaSpace on
each syncing machine.
