# Changelog

## 0.6.0

A redesigned sidebar.

- **Session header.** OpenCode's title row is replaced by a header with the
  session title, a live status chip (`⠋ working`, `▲ needs you` while a
  permission waits, `● idle`), the cost, the model, a context meter, the tokens
  used, and the folder with its branch. Each fact has its own row, so nothing
  important is truncated. The Session card is gone; its information lives here.
- **Tiles like the prompt box.** Cards are flat raised surfaces with a row of
  padding above and below and a thin coloured edge on the left, like OpenCode's
  input box. The header uses the theme's higher raised surface and its accent.
- **A colour per card.** Each card gets a colour from the theme's categorical
  palette, chosen by its ID, for its edge, its title dot and its meters.
- **A baseline kit for custom cards.** `chrome.Card` draws its own header from
  `title`, `icon` and `meta`. New `Item`, `Stat`, `Pill` and `Empty` join
  `Meter`, so a card built from them looks finished with little work. Existing
  `apiVersion: 1` cards keep working.
- **Account line instead of the novaSpace card.** The bottom of the sidebar
  shows your GitHub username and sync status; click it for the cards folder,
  sync and updates. The `account` and `session-info` card IDs are ignored in
  `cli.json` and saved layouts.
- **Dynamic scrollbars.** The middle of the sidebar, bottom cards and the
  dialog show a scrollbar only when their content doesn't fit.
- **Drag by the title.** The `⠿` grip is gone; a card's title is its handle,
  and its dot turns into a grip under the pointer.
- **Fix the sidebar host adapter on OpenCode 2.2.** OpenTUI 0.6 changed how a
  scrollbox reports its children, so since OpenCode 2.2 the adapter silently
  skipped bounding the sidebar. It now recognises both layouts, and each host
  adjustment applies and restores on its own, so a future change in OpenCode
  can't take the sidebar down.
- Options: `surfaceStrength` and `hoverStrength` now range from 0 to 1 and
  default to 1; `pinnedSurfaceStrength` has no effect.

## 0.5.0

novaSpace is now about custom cards. This release removes profile sync and the
setup inventory.

- **Cards folder.** Custom cards now live in
  `~/.config/opencode/novaspace/cards/`. Every folder with an `index.js` is a
  card named `custom:<folder>`. New cards load without a restart, and removed
  ones unload. The `customCards` option is gone: copy your card files into the
  folder instead.
- **Card sync.** Sign in with the GitHub CLI and connect a private repository
  to sync your cards and their layout across machines. Cards are stored in
  `.novaspace/cards.json`. Layout settings merge one by one, while card files
  that changed on both machines pause sync until you choose a version. Files
  with credentials, linked files and large files stay local, together with the
  rest of their card.
- **Synced layout.** Card order, pins and hidden cards move from OpenCode's
  plugin storage to `novaspace/layout.json`, so they sync too. Your current
  arrangement is copied over on first start. The selected bottom page stays
  per machine.
- **Removed profile sync.** novaSpace no longer reads or syncs OpenCode
  settings, appearance, skills, instructions, agents, commands or plugin files.
  Your existing repository and `.novaspace/profile.json` are left as they are,
  and so is the old local state in `~/.local/state/novaspace/sync.json`.
- **Removed the setup inventory.** The Profile & setup card and its settings
  dialog are replaced by the **novaSpace** card: your GitHub account, card count
  and sync status, with one dialog for the cards folder, sync and updates. Its
  ID is `account`; the old `setup` ID still works in `cli.json` and saved
  layouts.
- **Redesign.** Following OpenCode's own surface language, cards are an
  elevated surface with a single left edge that lights up on hover, instead of
  a full box. Titles line up with the card content. Sync status always shows a
  glyph and a word (`● Synced`, `▲ Conflict`), never colour alone.
- **Session card.** "Session info" is now "Session". It adds a context meter
  that turns amber at 80% and red at 90%, and shows the branch in its own
  column.
- **New card chrome.** Custom cards get `chrome.Meter` for usage and progress
  bars, and an `accent` prop on `chrome.Card` to colour its edge. Existing
  `apiVersion: 1` cards keep working unchanged.
- Drop the `jsonc-parser` dependency.

## 0.4.5

- Fix the sidebar crash on OpenCode 2.1.2 (`host.content.getLayoutNode is not a
  function`). Its OpenTUI moved layout into the native scene and removed
  `getLayoutNode()`; the sidebar host adapter now reads height and padding from
  the renderable itself and still uses `getLayoutNode()` on older OpenCode.

## 0.4.4

- Find the global `AGENTS.md`, settings and skills folders on Windows. The setup
  inventory and preflight read the home folder only from `HOME`, which Windows
  does not set, so Profile & setup showed 0 instructions there. They now fall
  back to the operating system's home folder, as profile sync already did.

## 0.4.3

- Remove the sidebar's solid background. OpenCode paints the sidebar with the
  theme's raised surface; novaSpace now keeps it transparent, including after
  theme changes, so the terminal background shows between the cards. Cards keep
  their own surfaces. Disabling novaSpace restores OpenCode's background.

## 0.4.2

- Draw the card border on cell edges so the background meets the line on every
  side. Mid-cell box-drawing characters either leaked half a cell of background
  outside the line or, since 0.4.1, left a gap inside it. Card corners are now
  square.

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
