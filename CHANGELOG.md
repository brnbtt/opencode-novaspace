# Changelog

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
