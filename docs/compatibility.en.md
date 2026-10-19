> Language: [English](compatibility.en.md) · [中文](compatibility.md)

# Compatibility

## DSH

- Primary target: `0.2.1-rc.2` (Windows desktop).
- The current install package was statically checked against `0.2.1-rc.2`; before release, re-verify the interfaces in `docs/runtime-spike.md` with a live P0 run on the target version.
- For now, `dsh.compatibility.dshReleases` in `package.json` lists only `0.2.1-rc.2`.
- After upgrading DSH, run the P0 spike + a manual smoke test first, then update the compatibility table.

## Tests

- Node 22.8+ / 24; `pnpm test` first compiles to `lib-test/`, then runs with `node --test --test-isolation=none`.
- No esbuild subprocess is used, so the tests also run under the DSH sandbox (which forbids named pipes).

## OS

- Windows: full functionality (including taskbar flashing).
- macOS / Linux: approval/plans/audit work; flashing degrades to an in-page alert.
- Path matching is per platform: Windows is case-insensitive + `realpath` of the nearest ancestor; POSIX is case-sensitive.

## Known conflicts

- Other `approval/request` answerers (`dsh-approval-gate`, `dsh-approval-review`, `dsh-approval-llm`, `dsh-experimental-auto-review`): they contend for auto-approval; do not stack them.
- Notification plugins (`dsh-approval-chime`, `dsh-approval-alert`, `dsh-approval-voice`): may alert twice; set `notifications:false`.
- Hotkey/detail plugins (`dsh-approval-hotkeys`, `dsh-approval-explain`): may overlap with title rewriting/popovers; document this clearly in the README.
- Command/tool name clashes: check `/approvals`, `request_approvals`, and `ask_choices` before registering; on conflict, fall back to `ledger_*` / `/ledger`.

## Smoke checklist

- Single approval: title summary, detail popover, allow/deny, raw reason visible.
- Plans: plan-review card, full text in the sidebar, approve/discuss, grants take effect, expire at turn end.
- Risk: critical red dot/recommend denial; high defaults to manual; medium data writes are automatic.
- Audit: `/approvals audit` has records; unattributed count is 0.
- Uninstall: official approval behavior is restored; no leftover processes/state.
