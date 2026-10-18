# P0 install review — dsh-approval-ledger 0.1.0-beta.1

> Status: **installed in the temporary `approval-p0` profile and in `desktop` for P0; unpublished.** This sheet records the approval gate and the executed actions. The desktop install was explicitly approved by the user.

## 1. What would be installed

| Item | Value |
|---|---|
| Package | `dsh-approval-ledger` |
| Version | `0.1.0-beta.1` (local, unpublished) |
| Source | `D:\AIworkspace\dsh-approval-ledger` |
| Install spec | `link:D:\AIworkspace\dsh-approval-ledger` |
| Target DSH | `0.2.1-rc.2` (currently installed desktop build) |
| Publisher/account | local checkout, author `yingcai233333`; no registry/Git fetch |

`package.json` facts:
- `dependencies`: none.
- `peerDependencies` / `optionalDependencies`: none.
- Install lifecycle scripts: **none** (`preinstall` / `install` / `postinstall` / `prepare` / `prepublishOnly` absent).
- Other scripts (`build`, `typecheck`, `test`, `lint`) are development-only and are not run by a dependency install.
- `devDependencies` are not installed for a dependency.
- `lib/` is already built (180 files, ~567 KB); the entry is `lib/index.js`.
- Bundle patch `cordis.patch.yml` inserts row `approval-ledger` / package `dsh-approval-ledger`.

## 2. Two possible targets

### A. Current `desktop` profile (real GUI, affects all sessions)

The current running profile is `C:\Users\36288\.dsh\profiles\desktop`, with existing deps `dsh-context`, `dsh-cost-meter`, `dsh-ops` and bundles `dsh-base`, `dsh-web-app`, `dsh-ops`, `dsh-cost-meter`, `dsh-context`.

Install action: `plugin_manager` → `install_bundle` with `target = link:D:\AIworkspace\dsh-approval-ledger`.

Expected changes:
- `profiles\desktop\package.json`: add dependency `dsh-approval-ledger: link:...`; add bundle to `dsh.profile.bundles`.
- `profiles\desktop\pnpm-lock.yaml`: link dependency entry.
- `profiles\desktop\node_modules\dsh-approval-ledger`: symlink to this checkout.
- `.plugin-manager/run.json` transient during the run; removed after.
- `cordis.patch.yml`: expected unchanged (bundle install enables via `package.json`); if the manager writes an enable override, it will be listed before/after.
- Running composition recomposes (or asks for restart). All sessions in this profile are affected while mounted.

Why this is the only fully representative live P0: it uses the current Electron GUI and official approval/plan cards, so `displayReason` and plan-review rendering are real.

### B. New `approval-p0` profile (isolated, but needs a separate Web UI)

The bundled CLI can be run with Electron-as-Node:
`DeepSeek Harness.exe` + `app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js`.
A temp profile can be created with `dsh plugin --profile approval-p0 add link:D:\AIworkspace\dsh-approval-ledger` (pnpm must be exposed through a process-local shim; no system PATH change). It would write only `C:\Users\36288\.dsh\profiles\approval-p0`.

Limitations:
- `plugin_manager` manages only the current desktop profile, so this path needs the bundled CLI.
- Live UI would be a separate `dsh --profile approval-p0 web` server in a browser, not the Electron GUI; it tests plan-review/approval cards but not Electron-only behavior.
- The current agent cannot drive a browser's clicks; the user would open the URL and interact.

## 3. Runtime behavior and risks

- The plugin is Host code and runs in-process with full Node access. It registers `request_approvals`, `/approvals`, and a prepended `approval/request` listener; it reads session/tool metadata and keeps an in-memory per-call ledger.
- Default config is **observe-only**: it never returns `allowed-once`; it rewrites the card's `displayReason` to a real mode + target summary and records `would-allow`.
- No network requests, telemetry, native dependencies, new session event types, or official-UI replacement.
- No system environment changes; no writes outside the selected profile except the existing workspace checkout.
- **Uncertainties that only live P0 can answer:** actual card text after `displayReason` rewrite; plan-review rendering outside plan mode; `tool/result.meta` client round-trip; subagent `DELEGATED_CALLER` behavior; sibling `approval/request` prepend ordering; HMR/recompose behavior.
- Local `link:` acceptance by the installed profile/plugin manager is not yet proven. If the manager rejects it, nothing is installed.

## 4. Backup and rollback

Before install (for target A):
- Copy `profiles\desktop\package.json`, `pnpm-lock.yaml`, and `cordis.patch.yml` to
  `D:\AIworkspace\dsh-approval-ledger\.p0-backup\desktop-*` (workspace-only writes).

After P0:
1. `plugin_manager` → `remove_bundle` with `dsh-approval-ledger`.
2. Confirm `profiles\desktop\package.json` no longer lists the dependency/bundle and `node_modules\dsh-approval-ledger` is gone.
3. If removal fails, restore the three backup files and restart DSH; the plugin adds no persistent data of its own.

For target B: leave or remove `profiles\approval-p0` with a separate explicit approval; no desktop changes.

## 5. Approval gate

Required before execution:
- [ ] Choose target A (desktop) or B (approval-p0).
- [ ] Approve the exact local `link:` spec and the target profile.
- [ ] Confirm the backup/rollback plan.

No install has been performed by this review.

## 6. Execution log (temporary profile path)

User selected the isolated temporary-profile path. Executed:

- Created `C:\Users\36288\.dsh\profiles\approval-p0` via the bundled DSH CLI (Electron-as-Node) with a process-local pnpm shim; no system PATH change.
- Installed `dsh-approval-ledger@0.1.0-beta.1` as `link:D:/AIworkspace/dsh-approval-ledger`; profile manifest now lists the dependency and bundles:
  - `@deepseek-ai/dsh-base`
  - `@deepseek-ai/dsh-web-app`
  - `dsh-approval-ledger`
- `node_modules\dsh-approval-ledger` is a junction to the workspace checkout.
- `desktop` profile was re-read after install and still has no `dsh-approval-ledger` entry.
- Started the isolated Web UI on `http://127.0.0.1:3080/` (one-time access token is not recorded here); the browser was opened automatically.
- `--dump-config` confirmed the `approval-ledger` row is composed in this profile.

Still pending: human interaction in that Web UI (plan card, approval card summary, `/approvals audit`); the temporary server process must be stopped after the test.

### First live attempt (failed registration, fixed)

The first 3080 boot did not expose `request_approvals`. Root cause found in the tool parameter schema: `scope.args` declared `type: "object"` without the `additionalProperties` boolean that the DSH tool compiler requires, so `ctx.tools.register` threw and the plugin's `apply` catch only warned.

Fixed in `src/plan/tool-schema.ts` (`additionalProperties: true`), added a regression test that every object schema node declares `additionalProperties`, rebuilt `lib/`, and restarted the temp Web UI.

A second registration error surfaced after that fix: the output schema's `decision` and item `risk` enums had no `type`, which the DSH JSON-schema compiler also rejects (`enum requires type or oneOf`). Added `type: "string"` to both, plus a regression test for enum nodes.

A third error appeared when the model API received the tool definition: `Invalid schema for function 'request_approvals': true is not of type "array"`. Root cause: `ctx.tools.register()` expects a **raw JSON Schema** for `parameters` (unlike `defineTool`, which compiles an author DSL), so the author-style `required: true` reached the model. Rewrote the parameter schema with `required` arrays and explicit `additionalProperties` booleans.

After rebuild/restart the temporary diagnostic log reports:

```
apply start
registerRuntime ok
```

The tool schema is now raw JSON Schema with two `required` arrays and no boolean `required`. The `src/index.ts` diagnostics were temporary and have been removed; the P0 test server was stopped after the run.

### Second live attempt: plan card works; control gap found

The plan-review card rendered, `request_approvals` was callable, and the plan was approved. The user correctly pointed out a control gap: the official plan-review card only offers whole-plan approve/revise, and a workspace-write may not produce a separate approval card, so there was no per-item choose/veto step before A executed.

Added a second official **multi-select** question after plan approval (`buildPlanSelectionQuestion`): only checked items install grants; unchecked items stay manual; selecting none cancels the batch. The plan card's description now states that the selection question follows. The plan card itself still cannot be multi-select (official plan-review constraint), so this is a separate question, not a replacement of the card.

Rebuilt and restarted 3080; retest done with the two-step flow below.

### Automated live run (no manual clicks)

Added a temporary headless harness under `.p0-test/` (gitignored): the bundled CLI starts `approval-p0` with `--no-open`, a headless Chrome instance loads the token URL, and a small CDP client clicks/types in the real Web UI. It does not touch `desktop` and does not install anything else.

Verified automatically:

1. plan-review card renders with A/B, risk, dependency, stages, and the "selection follows" note;
2. clicking "同意执行" opens the second multi-select card with A/B options and a disabled 提交 button;
3. selecting only A and submitting produces plan meta `approved: ["A"]`, `manual: ["B"]`;
4. A is written, B is absent; the agent does not execute B;
5. `/approvals grants` after turn end reports no active grants (turn-scoped revocation is by design).

**P0 result (automated, final build):** plan `P-6451e5af` approved with only A selected; A written, B absent. Audit matches A to plan item A by the plan item's `targetHash` and shows it once in the plan table with status `无法验证` (no `approval/asked` event); other ordinary calls stay `未归属`. The plan metadata stores only the target hash, not the path/command.

Also verified automatically:

- high-risk `danger-full-access` write produced the official approval card with rewritten title `write · …\p0-approval-test.md · danger-full-access`; rejecting it left the file absent and audit recorded a verified rejected row attached to plan `P-536e4a5d`;
- plan-card `要求修改` returned `cancelled`, created no file, and audit showed plan `P-73b32c5a` cancelled;
- a subagent calling `request_approvals` received `request_approvals requires the main session; include the plan in your final result instead` (`DELEGATED_CALLER`).

Only sibling `approval/request` prepend ordering remains untested live (it needs a second approval plugin in the same profile). The FakeContext suite now asserts that the plugin's prepended listener rewrites `displayReason` before an earlier sibling listener.

## 8. Sprint 2 client slice

Added `client.js` plus `dsh.client` metadata and the header slot registration. In the isolated Web UI, the session header shows the localized “审批详情” button with a red dot; opening it produced a read-only modal with the pending tool, callId, Host-rewritten summary (`write · …\p0-a.md · danger-full-access`), original reason, and a close action. While pending, the document title was prefixed with `● `. The modal has no allow/reject controls. Not yet implemented: Windows flash and active medium-by-default policy.

The earlier `p0-test/a.md` write in the desktop session was a **manual/conversational** write, not a plugin grant; it is not accepted as P0 evidence.

## 7. Desktop install (executed)

The user explicitly approved the reviewed desktop install. Executed via `plugin_manager` → `install_bundle` with target `link:D:\AIworkspace\dsh-approval-ledger`.

| Item | Value |
|---|---|
| Target profile | `C:\Users\36288\.dsh\profiles\desktop` |
| Install spec | `link:D:\AIworkspace\dsh-approval-ledger` |
| Package/version | `dsh-approval-ledger@0.1.0-beta.1` (local build) |
| Dependencies / peer deps | none in the package |
| Install lifecycle scripts | none |
| Network | none (local link; no new registry package) |
| Defaults | `mode: observe`, `allowHighRiskGrants: false`, `requireSecondConfirmForHigh: true`; no automatic approvals |

Result:
- `profiles\desktop\package.json` now has the dependency and `dsh-approval-ledger` in `dsh.profile.bundles`;
- `node_modules\dsh-approval-ledger` is a junction to the workspace;
- `cordis.patch.yml` was unchanged; `cordis.yml` recomposed with `- id: approval-ledger / name: dsh-approval-ledger`;
- the current session's tool schema now exposes `request_approvals`;
- `pnpm peers check` reports existing missing peers from `dsh-context` and `dsh-cost-meter`; this package declares no peers/deps and adds none of those warnings.

Backup (workspace-only): `.p0-backup\desktop-preinstall\` with `package.json`, `pnpm-lock.yaml`, `cordis.patch.yml`, `cordis.yml`.

Rollback:
1. `plugin_manager` → `remove_bundle` target `dsh-approval-ledger`; verify manifest/node_modules.
2. If removal fails, restore the four backup files and restart DSH.
3. The plugin stores no persistent data outside session logs.

Live P0 evidence from the isolated profile: plan card, per-item selection, A execution/B non-execution, high-risk approval card with rewritten `displayReason`, reject fail-closed, plan cancel, subagent `DELEGATED_CALLER`, and audit attribution. The only untested item is sibling prepend ordering.
