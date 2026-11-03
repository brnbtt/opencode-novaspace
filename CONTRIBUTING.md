# Contributing to novaSpace

This guide covers development, packaging, releases and the project layout. For
using novaSpace, see the [README](README.md).

The product/display name is **novaSpace**. OpenCode plugin IDs use the lowercase
`novaspace.*` namespace, and the npm package name is `opencode-novaspace` because
npm package names are lowercase.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Cards

novaSpace has no built-in cards. The sidebar frame has two fixed parts:

- **Session header** (`src/header.tsx`): title, status, cost, model, context
  meter, tokens, folder and branch. It replaces OpenCode's own title row, which
  `src/host.ts` hides while novaSpace is mounted.
- **Account line** (`src/account/line.tsx`): the GitHub login and sync status at
  the bottom; it opens the novaSpace dialog (cards folder, sync, updates).

The former built-in IDs `setup`, `account` and `session-info` are ignored
wherever they appear.

Every card is a custom card in the novaSpace cards folder
(`~/.config/opencode/novaspace/cards/<name>/index.js`, see `src/paths.ts`).
`createCardLibrary` in `src/custom-cards.tsx` scans that folder every few
seconds and after each sync, imports new cards, validates their `apiVersion: 1`
default export, and registers them in `src/cards/registry.tsx` under
`custom:<name>`. Removed folders unregister. A changed card is not re-imported:
its helpers would stay cached, so it reports that a restart is needed instead.
A missing or invalid module is skipped with one toast. Custom cards receive the
normal `CardProps` plus `chrome`, the baseline kit (`Card`, `CardTitle`,
`CardAction`, `Item`, `Stat`, `Pill`, `Empty`, `Meter`, `cardHeader`,
`metricRow`), so they look at home without importing novaSpace internals.

Do not add personal cards to this repository. Tests that need extra cards
register stand-ins with `stubCards()` from `tests/custom-cards.fixture.tsx`
and remove them afterwards, because loaded custom cards join the layout.

## Layout

The arrangement (order, pins, hidden cards) is saved in
`~/.config/opencode/novaspace/layout.json` by `src/layout-file.tsx`, so card
sync can carry it. The file is polled for changes from other windows and
reloaded right after a sync changes it. The selected bottom page stays in
OpenCode's plugin storage (`sidebar-layout-v1`) because it is per machine. On
first start the file is seeded from the arrangement saved there by 0.4.x.
Plugin options supply the initial layout; loaded custom cards that the layout
doesn't list join the end. Long bottom cards scroll within a height cap so the
middle area stays usable. Card titles and body text stay selectable; only the
hatched title rule starts a drag.

## Card sync

`src/sync/` syncs the novaSpace folder through a private GitHub repository; see
[docs/sync.md](docs/sync.md) for the user-facing behaviour.

- `files.ts` — reads the folder into a snapshot (`cards/...` and `layout.json`
  keys, base64 content), decides what stays local, and applies a new snapshot
  with backups, staging and rollback.
- `merge.ts` — three-way merge: whole files for cards, field by field for
  `layout.json`.
- `remote.ts` — `gh` calls for `.novaspace/cards.json`.
- `engine.ts` — `CardSync`: state file, cross-process SQLite lease, the
  one-minute schedule, and `subscribe()` for in-process listeners.
- `account.ts` — the signed-in GitHub login and the `hosts.yml` change stamp.

`scripts/sync-e2e.ts` runs the engine against a real temporary private
repository. It creates and deletes that repository, so run it only with
approval: `bun run scripts/sync-e2e.ts --allow-create-delete`.

## Development and installation model

Keep plugin source, development loading, and stable installation separate:

```text
~/DEV/labs/plugins/novaspace/                 # source checkout
~/DEV/labs/plugin-hosts/novaspace/            # disposable dev workspace
└── .opencode/opencode.jsonc                  # loads the source checkout

~/.config/opencode/opencode.jsonc             # stable package plugins only
~/.config/opencode/plugins/                   # tiny profile-owned scripts only
```

- **Source checkout:** edit and test novaSpace in its own checkout. Do not copy
  installed package contents into the checkout or config directory.
- **Development host:** disable the exact stable IDs, then load a tiny wrapper
  with `novaspace.dev.*` IDs that imports the checkout. This avoids package
  deduplication while keeping mutable source confined to the dev workspace.
- **Stable installation:** configure `opencode-novaspace` in the global profile.
  OpenCode owns its managed package cache; do not edit it.
- **Config plugins:** reserve `~/.config/opencode/plugins/` for small personal
  scripts intentionally versioned with the profile, not cloned package repos.

Example development-host override (the relative path is resolved from this
`.opencode/opencode.jsonc` file):

```jsonc
{
  "plugins": [
    "-novaspace",
    "-novaspace.tui",
    "./plugins/novaspace-dev"
  ]
}
```

Card options for the development host go in `cli.json` like any other CLI plugin
option, keyed by the same package path. OpenCode delivers options declared in
`opencode.json(c)` to a plugin's server half only; the TUI half receives an empty
object.

Keep the stable package entry unpinned to use the dialog's update check. An explicit
`@version` stays on that version and cannot offer later releases. Active feature
work should use the development host.

## Packaging

An installed plugin always lands under `node_modules`, and that single fact
decides how this package must be built.

OpenCode shares its own Solid and OpenTUI runtime with a plugin by rewriting the
import specifiers it finds in a module's **source text**. The Solid JSX transform
that would normally produce those specifiers is skipped for anything under
`node_modules`, so a published `.tsx` module never gets rewritten. It then fails
one of two ways:

- with peers optional, nothing resolves `@opentui/solid` and the TUI half fails to
  load with `Cannot find package '@opentui/solid'`;
- with peers materialized beside the plugin, they resolve to a **second** Solid
  runtime, so the sidebar paints one frame and no reactive update ever lands —
  the status line stays `✧ novaSpace`, custom cards never appear, and session
  context stays `No context yet`.

`bun run build` (`scripts/build.ts`) compiles `src/**` ahead of time using the
same Babel pipeline `@opentui/solid` ships. The compiled modules carry literal
`@opentui/solid`, `solid-js`, and `@opentui/core` imports, which is the form the
host rewrite recognises, so an installed package binds the host's runtime exactly
like a local checkout does. `package.json` therefore publishes `dist/` only, and
peers stay optional in `peerDependenciesMeta` so no second runtime is ever
installed.

`tests/package.test.ts` guards this: the compiled output must contain literal
runtime imports, no JSX, no surviving `@jsxImportSource` pragma, and only
`.js`-suffixed relative specifiers.

Local-path development is unaffected and still loads the `.tsx` sources directly
through OpenCode's JSX loader.

## Releases

Peer dependencies must stay optional in `peerDependenciesMeta`, and the published
tarball must contain compiled `dist/` output rather than `.tsx` sources. Both are
covered by "Packaging" and enforced by the test suite.

Before publishing `opencode-novaspace`:

1. Verify CI, typecheck, tests, `bun run build`, and `bun pm pack --dry-run`.
2. Configure npm 2FA and GitHub trusted publishing for this repository. Publish
   from CI: a local `npm publish` can target a corporate registry proxy.
3. Tag the matching `vX.Y.Z` commit.
4. Publish with provenance and create release notes from the same tag.
5. Verify the managed installation and leave its package entry unpinned for
   future updates.

npm versions are immutable, so verify a risky install-path change with a
`X.Y.Z-rc.N` prerelease on the `next` dist-tag first. Confirm the managed cache
does not materialize `solid-js` or `@opentui/*`, and that custom cards, the
GitHub account, and session context update after mount — a populated value is
the proof that a reactive update landed after the first frame.

The npm page renders `README.md` from the published tarball. Links use absolute
GitHub URLs so they work on npm. If you add images, put them in `docs/images/`
and link them with absolute `raw.githubusercontent.com` URLs on `main`, so they
appear on npm without shipping the images in the package.

## Screenshots

The README shows text previews instead of screenshots, so they never drift from
the real design and render the same on GitHub and npm. Update them when the card
chrome changes. If you add screenshots, take them from a real OpenCode TUI run
against an isolated demo profile (a temporary `HOME`, a demo `gh` account such
as `octo-dev`, and demo custom cards), never a personal one.

## Project structure

Two entry points and a two-tier layout: the top-level `src/` files are the sidebar
**framework**, and `src/cards/` holds one subfolder per **card**. Each file has a
single owner.

Entry points

- `index.ts` / `tui.tsx` (repo root) — thin re-export facades named by the
  `package.json` exports. Published builds expose their compiled counterparts,
  `dist/index.js` and `dist/tui.js`.
- `src/index.ts` — minimal package entrypoint used to load the TUI extension;
  novaSpace registers no server tools.
- `src/tui.tsx` — TUI plugin; mounts the sidebar, footer, and drag-overlay slots
  and composes cards through `RenderCard`.
- `scripts/build.ts` — publish-time compilation into `dist/`; see "Packaging".

Framework (`src/`)

- `types.ts` — the host `TuiContext` contract and shared data types (`Session`,
  `Theme`).
- `config.ts` — built-in and `custom:` card IDs, default order and pins, the
  `setup` alias, and option parsing.
- `paths.ts` — the novaSpace folder, cards folder, layout file and state folder.
- `card.ts` — the card contract: `CardProps`, `CardDefinition`, and `defineCard`.
- `ui.tsx` — the palette (`scale`, `ink`, `raised`, `identity`), `Tile`, and
  the card kit: `Card`, `CardTitle`, `CardAction`, `Item`, `Stat`, `Pill`,
  `Empty`, `Meter`.
- `dialog.tsx` — dialog primitives: keyboard-navigable `ActionLink`s inside
  `DialogActions`, and opening paths.
- `layout.tsx` — layout controller (order, pins, hidden, active page).
- `layout-file.tsx` — the synced `layout.json` store.
- `custom-cards.tsx` — the card library: discovery, loading, and `chrome`.
- `drag.tsx` — drag-and-drop state machine, drop-target geometry, and auto-scroll.
- `drag-overlay.tsx` — full-screen drag overlay: previews, drop hints, and Esc.
- `card-preview.tsx` — snapshots a mounted card into the floating drag copy.
- `carousel.tsx` — bottom page carousel and the page markers.
- `host.ts` — adapts the native OpenCode sidebar host layout (see below).
- `update.ts` — plugin version and update state from the host.
- `sync/` — card sync (see "Card sync").
- `layout.ts` / `drag.ts` — stable re-export entrypoints (see the runtime note
  below).

Cards (`src/cards/`)

- `registry.tsx` — registered custom cards, the `cards` lookup, and
  `partitionCards` (top/scroll/bottom).

Frame

- `header.tsx` — the session header.

Account (`src/account/`)

- `line.tsx` — the `✧` status line at the bottom of the sidebar.
- `dialog.tsx` — the novaSpace dialog.
- `status.ts` — the sync status wording shared by both.

### Design

Tiles follow OpenCode's own prompt box: a flat raised surface with a row of
padding above and below and a thin `┃` edge on the left. Terminal cells can't
draw true rounded corners, so tiles are square. Every colour comes from the
theme: surfaces from `background.raised`, tones from the nine-step `hue`
scales (step 200 is a strong ink and 800 a soft tint in either mode), and each
card's colour from `categorical`, chosen by its ID (`identity()` in `ui.tsx`).
Themes without hues fall back to colours synthesised from the feedback tokens.
The edge is a column of text cells because text respects scroll clipping in
the host while native box borders do not. Status always pairs a glyph with a
word. Prefer one fact per row over sharing a row with a chip, so nothing
important truncates. Meters measure their own width and appear one frame after
layout. Dialog actions use `ActionLink` variants: `primary` for the main
action, `link` for others, and `quiet` for dismissive ones.

### Previewing the design

Rendering the sidebar with `testRender` and a theme dumped from a live OpenCode
(`context.theme`, with colours serialised) gives faithful previews in any theme
without a terminal. Convert the captured spans to an HTML grid, drawing block
glyphs as cell quadrants, and screenshot it with headless Chrome.

## Host integration

`src/host.ts` adapts the native OpenCode sidebar: it hides the host's title row
(novaSpace draws its own header), bounds the native outer scroll area so only
the middle cards scroll, and removes the title and footer padding. The public
slot API has no host layout controls, so the adapter checks the renderable
hierarchy first and restores everything on disposal. Each adjustment applies
and restores on its own inside a `try`, so a host change that breaks one
cannot block the others or crash the sidebar. Recheck it when upgrading
OpenCode. It uses structural checks because the live host and plugins can load
separate OpenTUI modules, making `instanceof` fail. OpenTUI 0.6 (OpenCode 2.1.2)
removed `Renderable.getLayoutNode()`; `layout()` reads the Yoga style getters on
either version. Since OpenCode 2.2, a scrollbox reports itself as the parent of
its content's children and its inner boxes no longer expose a parent chain;
`isScrollBox` and the slot check accept both layouts.

Reactive state lives in `drag.tsx` and `layout.tsx`; their `.ts` files are stable
re-export entrypoints. OpenCode 2.0.7 rewrites Solid imports through its JSX
loader, but ordinary `.ts` helpers resolve the local Solid package. Signals from
that second runtime do not notify the rendered components. Keep reactive helpers
on the `.tsx` path, even when they contain no JSX. Same-runtime headless tests
alone do not catch this; the fix was checked with a cancelled gesture in the live
TUI. These shims matter only for local-path development; `bun run build` compiles
every module the same way, so it drops them from the published output.

`card-preview.tsx` copies public box/text paint properties from the mounted card.
JSX text comes from `textNode.gatherWithInheritedStyle`; `.chunks` only describes
manually assigned content. The preview uses `style.content` to preserve StyledText
because the renderer's direct JSX `content` prop stringifies objects.

Scrollbars use a one-cell track with native semantic theme colors. The novaSpace
dialog sizes itself from terminal dimensions and applies dialog settings after
`show()`, which resets the host's dialog size and centering.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
