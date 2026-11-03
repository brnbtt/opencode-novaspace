# novaSpace

**Custom cards for the OpenCode sidebar, on every machine.**

[![npm](https://img.shields.io/npm/v/opencode-novaspace?color=0f766e&label=npm)](https://www.npmjs.com/package/opencode-novaspace)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/brnbtt/opencode-novaspace/blob/main/LICENSE)

novaSpace replaces OpenCode's terminal sidebar with cards you write yourself. A
card is a small JavaScript module in one folder. novaSpace loads it next to the
built-in cards, lets you arrange it, and can sync your cards and their layout
to your other machines through a private GitHub repository.

```text
 ▎                                   
 ▎ ✧ @octo-dev            ● Synced   
 ▎ 3 cards · synced 2m ago        ›  
 ▎                                   

 ▎                                   
 ▎ Subagents ⠿            ● 1  ✓ 4   
 ▎ ✓ Review --days flag change       
 ▎ succeeded · 2m 52s · reviewer     
 ▎                                   
 ─────────────────────────────────── 
 ▎                                   
 ▎ Session ⠿                         
 ▎ Context            52,500 · 5%    
 ▎ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
 ▎ Spent                    $3.42    
 ▎ ~/projects/weather-cli    main    
 ▎                                   
```

## Why novaSpace

- **Your own cards.** Drop a folder with an `index.js` into the cards folder
  and it appears in the sidebar. Delete the folder and the card goes away.
- **The same sidebar on every machine.** Sign in with the GitHub CLI and
  connect a private repository. Your cards and their arrangement follow you.
- **Arrange it your way.** Drag a card's `⠿` grip to reorder it or pin it to
  the bottom. The layout is saved and synced.
- **Fits your theme.** Cards use colours from your current OpenCode theme, in
  light and dark. The sidebar has no background of its own, so a translucent
  terminal shows through between the cards.

## Installation

```sh
opencode plugin add opencode-novaspace
```

Then **quit and reopen OpenCode**. The sidebar is only replaced when OpenCode
starts, so reloading isn't enough. You need OpenCode 2.0.12 or later.

The novaSpace card appears at the top of the sidebar and the Session card at
the bottom. Click the novaSpace card to open its settings.

## Built-in cards

| Card | What it shows |
| --- | --- |
| **novaSpace** | Your GitHub account, how many cards you have, and sync status. Click it to open the cards folder, set up sync and install updates. |
| **Session** | Context used, with a meter that turns amber at 80% and red at 90%, the cost so far, and the folder and branch. |

Everything else is a card you add.

## Custom cards

Cards live in one folder:

```text
~/.config/opencode/novaspace/
├── cards/
│   ├── subagents/
│   │   └── index.js        → custom:subagents
│   ├── working-set/
│   │   ├── index.js        → custom:working-set
│   │   └── git.js
│   └── shared.js           (a helper; not a card)
└── layout.json             (the sidebar arrangement)
```

Every folder in `cards/` that contains an `index.js` is a card. Its ID is
`custom:` followed by the folder name, which must use lowercase letters, digits
and dashes. Other files are helpers that cards can import. Open the folder from
**novaSpace → Cards → Open folder**.

`index.js` default-exports the card's title and a `render` function:

```js title="~/.config/opencode/novaspace/cards/hello/index.js"
export default {
  apiVersion: 1,
  title: "Hello",
  render({ chrome, ctx, drag, options, pin }) {
    // Build the card with chrome.Card, chrome.CardTitle, chrome.CardAction,
    // chrome.Meter, chrome.cardHeader and chrome.metricRow so it matches
    // the built-in cards.
  },
}
```

`render` gets the same props as the built-in cards: `ctx` (the OpenCode plugin
context, including `ctx.data` and `ctx.theme`), `sessionID`, `options`, `pin`,
`drag` and `dragging`, plus `chrome`:

| Chrome | Use |
| --- | --- |
| `Card` | The card surface. Pass `drag` for the grip, `onPress` to make it clickable, and `accent` to colour its left edge. |
| `CardTitle` | The bold title, with the drag grip when you pass `drag`. |
| `CardAction` | A small clickable label. |
| `Meter` | A one-row bar for usage or progress. `value` is a fraction from 0 to 1. |
| `cardHeader`, `metricRow` | Box layouts for a title row and a label/value row. |

Write the card with OpenTUI Solid JSX, then **compile it to JavaScript**. The
compiled file must import `@opentui/solid` and `solid-js` directly, so it uses
the same runtime as OpenCode. Compile with `babel-preset-solid` using
`{ moduleName: "@opentui/solid", generate: "universal" }`, and don't bundle
those packages into the file.

New cards load within a few seconds, without a restart. When you change a card
that's already loaded, novaSpace tells you to restart OpenCode to load the new
version. If a card can't be loaded, novaSpace skips it and shows a message. The
rest of the sidebar still works.

## Sync your cards

Sync copies the novaSpace folder (your cards and `layout.json`) between
machines through a **private** GitHub repository that you own.

1. Install and sign in to the [GitHub CLI](https://cli.github.com/) with
   `gh auth login`. The novaSpace card then shows your account.
2. Click the novaSpace card. Under **Sync**, keep the suggested
   `<you>/novaspace-cards` or edit it.
3. Choose **Create & sync** for a new repository or **Use existing**.

That's it. novaSpace runs the first sync, then syncs every minute while
OpenCode is open. On another machine, install novaSpace and connect the same
repository.

- **Layout:** card order, pins and hidden cards merge setting by setting. When
  both machines changed the same setting, the machine that syncs keeps its own.
  The bottom page you're looking at stays per machine.
- **Conflicts:** when the same card file changed on both machines, sync pauses
  and the novaSpace card shows **▲ Conflict**. Open it and choose which
  version to keep. Replaced local files are backed up, and the repository's
  history keeps old versions.
- **What stays local:** files that look like they contain credentials, linked
  (symlinked) files and files over 500 KB. A card with any such file stays on
  this machine as a whole, so another machine never gets half a card. Read
  secrets from the environment at runtime instead.

> [!NOTE]
> Cards are stored unencrypted in `.novaspace/cards.json` in your repository.
> Keep the repository private.

For the details, see [How card sync works](https://github.com/brnbtt/opencode-novaspace/blob/main/docs/sync.md).

## Arrange your cards

Drag the `⠿` grip next to a card's title to move it. A line shows where it will
land. Drop it at the bottom to pin it there. Several bottom cards become pages
that you switch with the dots underneath. Press **Esc** to cancel. The
novaSpace card always stays at the top.

## Configuration

novaSpace works without any configuration. To change the initial layout or the
look, add an entry to `cli.json`:

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": [
    {
      "package": "opencode-novaspace",
      "options": {
        "cards": ["account", "custom:subagents", "session-info"],
        "pins": { "custom:subagents": "bottom" }
      }
    }
  ]
}
```

> [!IMPORTANT]
> Put novaSpace options in **`cli.json`**, not `opencode.json`. OpenCode doesn't
> pass `opencode.json` options to the sidebar. Keep `opencode-novaspace` in the
> `plugins` list of `opencode.json`, which is what `opencode plugin add` does.

| Option | Default | Description |
| --- | --- | --- |
| `cards` | `["account", "session-info"]` | Cards to show first, in order. Custom cards not listed join at the end. |
| `hidden` | `[]` | Cards to hide. |
| `pins` | account `top`, session-info `bottom` | Set `"top"`, `"bottom"` or `false` for each card. |
| `surfaceStrength` | `0.14` | How strongly card surfaces stand out from the sidebar. |
| `pinnedSurfaceStrength` | `0.08` | The same, for the top and bottom cards. |
| `hoverStrength` | `0.08` | Surface highlight when you hover over a card. |
| `hoverDuration` | `120` | Hover animation length in milliseconds. |
| `gap` | `1` | Blank rows between cards. |

These options set the initial layout. Once you drag cards around, the saved
`layout.json` is used instead.

## Troubleshooting

- **The sidebar hasn't changed.** Quit OpenCode completely and start it again.
- **A card doesn't appear.** Check that it's a folder directly in `cards/`, that
  the folder name uses only lowercase letters, digits and dashes, and that it
  contains a compiled `index.js`.
- **My `customCards` cards disappeared after updating.** From 0.5.0, novaSpace
  loads cards only from its cards folder. Copy each card's files into
  `~/.config/opencode/novaspace/cards/<name>/` and remove `customCards` from
  `cli.json`.
- **Sync shows ‖ Paused.** Sync uses the GitHub account that was signed in when
  you connected. Run `gh auth status`, then switch back or reconnect.
- **Sync shows ▲ Conflict.** Open the novaSpace card and choose a version.
- **I used profile sync before 0.5.0.** novaSpace no longer syncs skills,
  instructions or settings. Your old repository and its `.novaspace/profile.json`
  are left untouched. Connect a repository again to sync cards.

Found a bug or have an idea? [Open an issue](https://github.com/brnbtt/opencode-novaspace/issues).

## Development

Interested in contributing? See
[CONTRIBUTING.md](https://github.com/brnbtt/opencode-novaspace/blob/main/CONTRIBUTING.md).

novaSpace is an independent community project. It isn't affiliated with or
endorsed by Microsoft or the OpenCode project.

## License

MIT © Bruno Bett. See [LICENSE](https://github.com/brnbtt/opencode-novaspace/blob/main/LICENSE).
