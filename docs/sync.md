# How card sync works

Card sync keeps the novaSpace folder the same on every machine you use:

```text
~/.config/opencode/novaspace/
├── cards/        your card folders and shared helper files
└── layout.json   card order, pins and hidden cards
```

Nothing outside this folder is read or written. OpenCode settings, skills,
instructions and other configuration are not synced.

## Where the data goes

Sync uses the GitHub CLI (`gh`) and the account it's signed in to. The whole
folder is stored as one file, `.novaspace/cards.json`, in a private repository
that you own. Each sync that changes something is one commit, so the repository
history keeps every previous version.

novaSpace refuses a repository that isn't private or that you can't push to.

Machine-local bookkeeping lives in `~/.local/state/novaspace/`:

- `cards-sync.json`: the connected repository and account, the last agreed
  snapshot (the merge base) and the current status;
- `lease.sqlite`: a lock so only one OpenCode window syncs at a time;
- `backups/`: the previous version of every local file that sync replaced or
  deleted, in timestamped folders.

## When it runs

After you connect a repository, novaSpace syncs straight away and then every
minute while OpenCode is open. All windows share one schedule, so several open
windows still sync about once a minute. **Sync now** runs it immediately, and
**Auto** turns the schedule off and on.

## How changes merge

Each sync compares three versions of every file: the last agreed snapshot, this
machine, and the repository.

- A file changed on one side only takes that side's version. This covers new
  cards, edits and deletions.
- A file changed differently on both sides is a **conflict**. Sync pauses, the
  novaSpace card shows **▲ Conflict**, and nothing is overwritten until you
  choose **Keep this machine's** or **Use repository's**.
- `layout.json` merges setting by setting, and pins merge card by card, so
  reordering on one machine and hiding a card on another both survive. If both
  machines changed the same setting, the machine that is syncing keeps its own
  choice, without a prompt.

Local files only change after the repository write succeeds. Every replaced or
deleted file is backed up first, all new files are staged before any live file
changes, and a failure part-way through restores what was there. If a card file
changes while sync is running, sync stops and retries on the next run.

## What stays on this machine

These files are never uploaded:

- files that look like they contain a credential, such as a GitHub token, an
  API key or a private key;
- symbolic links and hard-linked files;
- files over 500 KB.

If a card folder has any of these, the whole card stays local, because another
machine can't run half a card. The novaSpace dialog shows how many entries were
kept local. A card that needs a secret should read it from the environment at
runtime.

The whole snapshot is limited to 500 KB and 1,000 files.

## Loading synced cards

A card that sync brings in loads within a few seconds without a restart, and a
card that sync deletes is removed from the sidebar. When sync updates a card
that's already loaded, the new version loads the next time OpenCode starts.

## Switching accounts

Sync is tied to the GitHub account that connected it. If `gh` is signed in to a
different account, sync shows **‖ Paused** until you switch back with
`gh auth switch` or disconnect and connect again.
