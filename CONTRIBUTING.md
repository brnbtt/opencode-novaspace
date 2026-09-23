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

novaSpace ships two built-in cards, active by default on a fresh install:

- **Profile & setup** (`setup`) — pinned local/GitHub profile and setup inventory
  with a compact customization hub.
- **Session info** (`session-info`) — pinned context tokens, context usage, cost,
  and workspace/branch, using the native OpenCode sidebar data.

Every other card is a local custom card that the user declares in the
`customCards` option (see the README). `src/custom-cards.tsx` imports each module
in the background, validates its `apiVersion: 1` default export, and registers it
in `src/cards/registry.tsx` under its `custom:` ID. The registry is a signal, so
the layout picks the card up once it has loaded. A missing or invalid module is
skipped with a toast. Custom cards receive the normal `CardProps` plus `chrome`
(`Card`, `CardTitle`, `CardAction`, `cardHeader`, `metricRow`) so they can match
the built-in cards without importing novaSpace internals.

Do not add personal cards to this repository. Tests that need extra cards
register stand-ins from `tests/custom-cards.fixture.tsx`.

Layout ordering, placement, hidden cards and the selected page are saved through
OpenCode's plugin storage (`sidebar-layout-v1`) and survive reloads/restarts.
Plugin options supply the initial layout; the reset control restores them. Long
bottom cards scroll within a height cap so the middle area remains usable. Card
titles and body text remain selectable; only the `⠿` grip starts a drag.

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

Keep the stable package entry unpinned to use the hub's update check. An explicit
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
  inventory counts stay `0`, the profile stays `Local profile`, and session
  context stays `—`.

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
does not materialize `solid-js` or `@opentui/*`, and that inventory counts, the
GitHub profile, and session context update after mount — a populated count is the
proof that a reactive update landed after the first frame.

The npm page renders `README.md` from the published tarball. Images use absolute
`raw.githubusercontent.com` URLs to `docs/images/` on `main`, so they appear on npm
without shipping the images in the package.

## Screenshots

README screenshots live in `docs/images/` and come from a real OpenCode TUI run
against an isolated demo profile, never a personal one:

- a temporary `HOME` containing only a demo `opencode.json`, `cli.json`, one
  skill, one agent, one command and an `AGENTS.md`;
- a small demo project, with a free OpenCode Zen model doing real work;
- a local stand-in for `gh` reporting a demo account (`octo-dev`) and storing the
  profile in a local file, so sync screens show without contacting GitHub;
- [`ttyd`](https://github.com/tsl0922/ttyd) with the DOM renderer, captured by
  headless Chrome at 1440×860 and a device scale factor of 2.

Keep account names and paths out of new screenshots. Screenshots that need more
than the built-in cards use demo custom cards.

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

- `types.ts` — the host `TuiContext` / `ServerContext` contract and shared data
  types (`Session`, `Theme`).
- `config.ts` — built-in and `custom:` card IDs, default order and pins, and
  option parsing (including `customCards`).
- `card.ts` — the card contract: `CardProps`, `CardDefinition`, and `defineCard`.
- `ui.tsx` — shared card primitives: `Card`, `CardTitle` (the drag grip),
  `CardAction`, `Divider`, and surface/scrollbar helpers.
- `layout.tsx` — persistent layout controller (order, pins, hidden, active page).
- `drag.tsx` — drag-and-drop state machine, drop-target geometry, and auto-scroll.
- `drag-overlay.tsx` — full-screen drag overlay: previews, drop hints, and Esc.
- `card-preview.tsx` — snapshots a mounted card into the floating drag copy.
- `carousel.tsx` — bottom page carousel and the page markers.
- `host.ts` — adapts the native OpenCode sidebar host layout (see below).
- `custom-cards.tsx` — loads local custom card modules and hands them `chrome`.
- `layout.ts` / `drag.ts` — stable re-export entrypoints (see the runtime note
  below).

Cards (`src/cards/`)

- `registry.tsx` — built-in cards plus registered custom cards, the `cards`
  lookup, and `partitionCards` (top/scroll/bottom).
- `<id>/index.tsx` — one subfolder per built-in card, each default-exporting one
  `defineCard(...)`. Cards that need helpers keep them in the same folder:
  `setup/` (inventory, modal, profile, sync).

### Add a card

Most cards belong outside novaSpace as custom cards (see the README). To add a
built-in card:

1. Create `src/cards/<id>/index.tsx` that renders with the shared `Card`
   primitives and default-exports `defineCard({ id, title, render })`. Start the
   file with `/** @jsxImportSource @opentui/solid */`, like every other card.
2. Add the id to `cardIDs` (and a `defaultPins` entry) in `src/config.ts`.
3. Import it and add it to the card list in `src/cards/registry.tsx`.
4. List the id in your `cli.json` `cards` option, then restart the TUI completely
   — a reload does not remount an already-mounted sidebar.

`CardID` and the layout stay type-safe because they derive from `cardIDs`.

Keep reactive helpers on the `.tsx` path even when they contain no JSX; see the
runtime note under "Host integration". New files need no build step while you
develop against a local checkout, and are picked up automatically by
`bun run build` when publishing.

### Publish

This repository only contains the built-in cards (`setup`, `session-info`), so
every build is framework-only. Because plugins are referenced from
`opencode.json(c)` by path or package, this repo is the checkout you own and
edit; installed npm packages live in OpenCode's managed location and are not
hand-edited.

## Host integration

`src/host.ts` adapts the sidebar wrapper observed in OpenCode 2.0.7: it bounds the
native outer scroll area and removes the title/footer's extra padding so only the
middle cards scroll. The public slot API has no host layout controls; the adapter
checks the renderable hierarchy before applying changes and restores the host
styles on disposal. Bottom padding is removed so the footer reaches the sidebar's
lower edge. Recheck this adapter when upgrading OpenCode. It uses structural
checks because the live host and plugins can load separate OpenTUI modules, making
`instanceof ScrollBoxRenderable` fail across that boundary.

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

Scrollbars use a one-cell track with native semantic theme colors. The setup modal
sizes itself from terminal dimensions and applies dialog settings after `show()`,
which resets the host's dialog size and centering.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
