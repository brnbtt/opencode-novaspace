# Changelog

## 0.4.1

- Keep the card background inside the rounded border. The surface filled the
  border cells too, so half a cell of background showed outside the line on
  every side. Custom cards get the fix through the shared card chrome.

## 0.4.0

- Add local custom cards. Declare compiled card modules under the `customCards`
  option with `custom:` IDs; they get the same card frame, drag grip, pins and
  saved layout as the built-in cards. A card that fails to load is skipped with a
  message.
- **Breaking:** remove the Subagents, Working Set, Memory and Copilot cards from
  the package. novaSpace now ships only Profile & setup and Session info. Recreate
  any of the removed cards as custom cards.

## 0.3.1

- Rewrite the README for users, with screenshots of the sidebar, settings,
  profile sync and card arrangement. Move development, packaging and release
  notes to CONTRIBUTING.md and the full sync reference to docs/sync.md.
- No functional changes.

## 0.3.0

- Prepare a portable sync copy automatically, without moving files, rewriting
  local paths, replacing links or requiring a standardization review.
- Preserve machine-specific configuration and credentials locally while syncing
  portable settings from the same JSON/JSONC file. Keep original comments and
  formatting when applying portable setting changes.
- Keep linked sources and machine-dependent file bundles local automatically.
  Show their names in optional details instead of asking for approval.
- Connect, perform the first sync and enable automatic sync in one flow. Preserve
  an existing connection's paused preference when changing its selection.
- Stage all restore writes and backups before applying changes, roll back an
  interrupted apply when possible, and preserve concurrent user edits.
- Use profile format 2. Older novaSpace versions stop at the format check before
  applying a profile written by this release; update all syncing machines.

## 0.2.2

- Fix private-repository creation for enterprise-managed GitHub usernames such as
  `person_company`. Trim repository input before validating and connecting.
- Simplify settings to file/folder links and remove individual item lists and
  nested scrolling.
- Split profile sync into compact Files, Repository and Sync views. Keep detailed
  file review separate and show errors near the header.
- Add a small theme-aware `✧` mark and rename the main action to **novaSpace settings**.
- Reveal the sync status label only when its dot is hovered. Remove the main
  card's icon sweep and whole-card hover animation.

## 0.2.1

The first published release of the changes below. The `v0.2.0` workflow stopped
before publishing because a UI test used a fixed delay between asynchronous
actions. The test now waits for the modal to become ready.

- Add subtle, theme-derived rounded card borders and a consistent scrollbar gutter.
- Refine the settings modal with compact update status, clearer sections, terminal
  preferences and Tab/Shift+Tab/Enter navigation. Clip scrolling panel borders so
  they cannot draw over the header or footer.
- Implement profile sync to a private GitHub repository. Choose whole-file groups,
  review the exact files, connect or create a repository, and sync in both directions.
- Add opt-in automatic sync every minute while OpenCode is open, with shared
  cross-process coordination, revision checks, offline recovery and account binding.
- Pause on same-file conflicts and offer explicit local/remote resolution. Keep
  local backups before replacement or deletion and preserve script executability.
- Include configured default models, terminal preferences, custom themes, skills,
  instructions, agent/command files and optional local plugin scripts. Shared
  config files travel once; sign-in stores, sessions and project files stay local.
- Document the sync boundary, first-machine setup and second-machine restore flow.

Verification includes light/dark and narrow-terminal UI tests, two-machine sync
tests, and a live GitHub round trip with synthetic profiles and the production
automatic-sync interval.
