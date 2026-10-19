> Language: [English](HANDOFF.en.md) · [中文](HANDOFF.md)

# HANDOFF — dsh-approval-ledger

> Handoff document migrated from the design session. A new session should read this one first, then `docs/design.md`, `docs/runtime-spike.md`, and `docs/runtime-notes.md`.

## 0. Current status

- Phase: **Sprint 2 code freeze + Chinese approval text** (Sprint 1 Host/audit + client "approval details" panel + Windows flash + desktop restart verification; 273 unit tests). `0.2.0-beta.3` is published: Chinese tool/mode/risk labels, English model copy hidden, and "How to read this approval" added; desktop is upgraded to npm `0.2.0-beta.3`. Default observe-only; active mode requires explicit configuration.
- Runtime basis: `docs/runtime-spike.md` (static verification against DSH 0.2.1-rc.2; target has been changed to 0.2.1-rc.2).
- live P0: the temporary profile `approval-p0` has already been auto-verified with headless Chrome + CDP: plan-review → multi-select grant (only A checked) → A executes / B does not execute; a high-risk `danger-full-access` write pops up the official approval card, the title is rewritten as `write · …\p0-approval-test.md · danger-full-access`, and after rejection it fails closed and the file is not created; the plan "request changes" returns cancelled with no writes; the subagent call returns a `DELEGATED_CALLER` error. audit can already attribute the A with no approval event to the plan item by targetHash (marked "cannot verify"), and attribute the rejected high-risk write to the plan item (marked "verified/rejected").
- desktop installation: switched to npm `dsh-approval-ledger@0.2.0-beta.3`; `package.json` uses the version, `node_modules` is a real package directory (not a junction), and `request_approvals` plus the client header `approval-ledger-details` are loaded. The old link junction is backed up as `node_modules\dsh-approval-ledger.link-bak-20261019` for later deletion. The missing peers from `pnpm peers check` come from the existing `dsh-context`/`dsh-cost-meter`; this plugin has no dependencies/peers. Sibling prepend ordering is covered by FakeContext unit tests; the live dual-plugin scenario is untested.
- Repository: <https://github.com/yingcai233333/dsh-approval-ledger>
- Package name / Loader row id: `dsh-approval-ledger` / `approval-ledger`
- License: MIT
- Author: `yingcai233333`
- Target DSH: `0.2.1-rc.2` (Windows desktop; macOS/Linux only guarantee non-flashing functionality)
- Workspace: `D:\AIworkspace\dsh-approval-ledger`

## 1. The problem to solve

DSH's file-write/command-run approvals pop up one at a time serially: while the first approval is stuck, the later tool calls have not even started. The user wants:

1. To see the whole batch of operations needing approval at once, instead of clicking through them one by one;
2. A concise list where each item can be expanded to see "what it is / why / what happens after approval / recommendation";
3. Approvals with clear dependency relations to be shown by phase/dependency;
4. Key/dangerous operations to be highlighted, so they are not missed;
5. The desktop icon to flash as a reminder when approval is needed;
6. All decisions to be traceable, as traceable as DSH's session log.

## 2. Non-negotiable hard constraints

- **Do not add new session event types**. DSH's live `Session.append()` cannot set `ignorable: true`; new events will make the session refuse to reopen. Decision auditing can only be based on existing events + `tool/result.meta` + plugin ledger + derived projections.
- **Do not replace `ui-approval`**. Use the official approval card; this has the lowest upgrade risk.
- **Do not occupy `conversation.approval.detail`**. It is a single slot already occupied by `ui-chat`'s `ApprovalCommand`; registering again throws an error.
- **Do not modify the Electron main process**, do not change system environment variables, do not install native dependencies.
- **Logs/ledger must not record secrets, full arguments, or the full reason**; store only hash/summary/level/attribution.
- Any uncertainty, parse failure, or exception **always falls back to the official approval** (fail-closed).
- `critical` is never auto-allowed; `unknown` is always manual.

## 3. Agreed design (quick reference)

| Item | Decision |
|---|---|
| Name | `dsh-approval-ledger` |
| License | MIT |
| Official UI | Do not replace `ui-approval` |
| Batch approval | Official **plan-review card** + sidebar full text |
| Single approval | Official card untouched; summarized title + "approval details" dialog in the session header |
| Grants | Dual-gate matching; critical never; high defaults to manual; medium only for data-type writes |
| Audit | `tool/result.meta` + plugin ledger + `approval-audit` projection |
| Reminder | Host-side Win32 `FlashWindowEx` + page red dot/title |
| Version | 0.1 observe → 0.2 grants → 0.3 high/ask_choices → 1.0 stable |

### 3.1 Batch plan: `request_approvals`

Tool parameters (draft):

```ts
{
  summary: string,
  items: Array<{
    id: string,              // A/B/C, short and unique
    tool: string,            // write / edit / pwsh / plugin_manager …
    title: string,           // one line, human-readable
    mode?: string,           // target mode of the escalation
    scope?: {
      paths?: string[],      // absolute paths or relative to cwd; defaults to exact file
      commands?: string[],   // whole-string equality after normalization
      args?: Record<string, unknown> // exact subset, as a fallback
    },
    uses?: number,           // default 1, max 5
    dependsOn?: string[],    // declared dependency relations
    note?: string            // model explanation (unverified)
  }>
}
```

Flow:

1. Validate that ids are unique, dependencies are acyclic, paths/commands are valid, and the tool is registered.
2. Use `ctx.userQuestions.ask` to send a **plan-review** question:
   - `detail` = plan Markdown (concise checklist + details for each item);
   - `intent = { kind: 'plan-review', approve: '<label>' }`;
   - Only 1–2 options; no `callId` (this way clicking "Discuss" cancels the request instead of leaving a hanging card);
   - `multiSelect` cannot be true (plan-review would fall back to a normal question).
3. After the user approves, generate grants; cancel/close generates none.
4. The first line of the plan document is the title, the first paragraph is a two-line summary; the remaining content goes into the sidebar full text.
5. Dependencies are displayed as phases; matching is gated by phase.

### 3.2 Dual-gate matching

`approval/request` pre-listener (`{ prepend: true }`):

```ts
ctx.on('approval/request', async (req, next) => {
  try {
    const grant = matchGrant(req)      // plan gate + risk gate
    if (grant) return 'allowed-once'
  } catch { /* fall through */ }
  return next()
}, { prepend: true })
```

**First gate: plan gate**
- Same session, same tool, same kind, same mode, uses remaining, dependencies satisfied;
- paths use `realpath` of the nearest existing ancestor + case normalization + rejection of UNC/ADS/8.3/device names/trailing dot or space; hard links (nlink > 1) are always treated as high/manual;
- commands must match the whole string exactly; anything containing control characters/newlines/scripts/interpreters is not auto-allowed;
- args must match as an exact subset.

**Second gate: risk gate**
- Re-assess risk for **this actual call**;
- Only medium can be automatic; high requires opt-in + second confirmation; critical never; unknown always manual;
- This way, even if "the granted plan covers a directory", a `.ps1` inside that directory will not be auto-allowed.

### 3.3 Risk levels

| Level | Default | Typical |
|---|---|---|
| medium | May be batch auto-allowed | Data-type file writes that are not system/credential/code config (`.md`/`.txt`/`.csv`/ordinary `.json`) |
| high | Manual by default; second confirmation once `allowHighRiskGrants` is enabled | Deletion, package installation, commands/scripts, network downloads, environment variables, permission changes, code/config writes |
| critical | **Never automatic** | System directories, credentials, DSH's own config/plugins, disk/boot/services/registry, force push, publish, recursive force deletion outside the workspace |
| unknown | manual | Tools/commands that cannot be classified, or parse failures |

The risk engine only gives recommendations and never auto-rejects; it shows the reasons that were hit; `critical` uses a red dot/red bar/"recommend reject".

### 3.4 Audit ledger

Four layers:

1. **session log (facts)**: `tool/call`, `tool/result`, `approval/asked`, `approval/decided`, `user-question-reply`, `turn/end`. Auto-allows also leave asked/decided.
2. **`tool/result.meta` (plan-level decision)**: when `request_approvals` returns, it writes planId, approved/manual, items, grants, `schemaVersion`/`matcherVersion`/`riskPolicyVersion`. Does not enter the model context and costs no tokens.
3. **Plugin audit ledger (reason for each call)**: Sprint 1 uses an **in-memory** `MemoryAuditStore` partitioned by session; it stores only `callId`, `planId`, `itemId`, `tool`, `risk`, `mode`, `targetHash`, `targetSummary`, `outcome`, `matchedBy`, versions, and time. **It does not store full arguments/reason/commands.** After a restart, it is derived by layer 4 from the persistent session log.
4. **`approval-audit` projection + report**: joins layers 1–2 + the in-memory ledger; `/approvals audit [--json]` output. Missing per-call records are derived by recomputing risk from `tool/call.arguments` and marked `derived-session-log`; when they cannot be parsed they become `unattributed`, without guessing. `ctx.storageDomain` is a schema-validated KV store, not append-only; cross-session retention is deferred to a later version.

Optional layer 5: `auditNotices: "plan"` gives one in-conversation notice per plan; `"all"` gives one per auto-allow (off by default, to avoid noise and tokens).

### 3.5 UI

- **Single approval**: the official `ui-approval` card is completely untouched.
  - In `approval/request`, the Host rewrites the escalation's `displayReason` into a one-sentence summary (including the real mode + target); the original `reason` is kept in the log and in the dialog.
  - The session header `conversation.session.header.utilities` gets an "approval details" button (red dot) that opens a `shell.overlay` read-only dialog: what it is / why / after approval / risk basis / recommendation / original reason+JSON.
  - The dialog has no allow/reject; decisions are made only on the official card.
- **Batch**: official plan-review card; title + two-line summary; "view full text" is opened by `ui-plan` as sidebar Markdown; buttons "Approve/Discuss". Discuss = cancel and rewrite, not per-item checkboxes.
- **Multi-select question**: official question card; use the `ask_choices` tool to generate a structured `detail` + option `description` + recommendation marker (the `（推荐）` suffix), without changing the question UI.
- **Do not touch**: the code of `conversation.approval.detail`, `ui-approval`, `ui-chat`, `ui-plan`, `ui-user-questions`.

### 3.6 Reminders

- The Host maintains a pending count: begin/end when `approval/request` does not match a grant; begin/end around asking the plan question.
- Windows: lazily start a resident PowerShell, `Add-Type` once, find the window by `process.ppid` (the Electron main process) and call `FlashWindowEx` with `FLASHW_TIMERNOFG`; on failure degrade to title/favicon.
- Page: red dot/title prefix; do not make the chat list grow longer.
- Non-Windows: no flashing, page reminders only.

## 4. Runtime facts (verified)

- Approval entry: `ctx.approval.request()`; `approval/asked` is appended before the waterfall and `approval/decided` after it; auto-allows also leave a trace.
- escalation reason: `escalate sandbox to <mode>: <justification>`; `displayReason` is `{en, zh}`.
- `approval/request` is a waterfall, and plugins may `{ prepend: true }`; returning `allowed-once` allows it.
- `dsh-agent-loop` schedules tools that are not `isConcurrencySafe` one by one; the first approval blocks the following ones, so "wait until all approvals arrive" is impossible — the agent must submit a plan first.
- `conversation.approval.detail` is a single slot occupied by `dsh-client-ui-chat`'s `ApprovalCommand`; registering again throws `single slot ... already has a registration`.
- `conversation.input.dock` is in the default composer; it is not rendered when the approval card takes over the composer, so approval details cannot go in the dock.
- `ui-user-questions`' plan-review requires: 1 question, non-empty `detail`, `multiSelect !== true`, `options.length <= 2`, `intent.kind === 'plan-review'`, `option.label === intent.approve`.
- `conversation.plan-review.actions` provides "view full text" via `ui-plan`; without `callId` it opens a temporary review document, with `callId` it opens `submitted-plan`.
- `ctx.uiSession.sessionStatus` exposes each session's `pendingInteraction` (approval/question/plan-review).
- `tool/result` supports `meta?: JsonValue`, which can hold structured decisions and does not enter model content.
- `dsh-desktop-host` is `spawn`ed as a child process by the Electron main process; the host's `process.ppid` is the Electron main process, so the window can be found by PID.
- `dsh-experimental-auto-review` uses `tools/pre-execute` `{prepend:true}`; our `approval/request` also prepends, so multiple auto-approval plugins will contend with each other and compatibility documentation/detection is needed.

## 5. P0 spike checklist (verify before implementation)

1. If `displayReason` is rewritten in the `approval/request` pre-listener, does the client card show the new text; is the object frozen. **Statically likely; not verified live.**
2. Whether plan-review intent renders in **non-plan mode**; whether `查看全文` ("view full text") opens the sidebar temporary document. **Statically verified; not verified live.**
3. The `conversation.approval.detail` single-slot conflict (known to throw; just confirm). **Statically verified.**
4. Whether the client `useChat` can get `argsRaw` by callId; whether `useSessionStatus` can get the pending approval. **Statically likely; not verified live.**
5. Whether `tool/result.meta` is persisted and whether the projection is readable; `ctx.storageDomain` is KV, not append-only. **Statically verified; Sprint 1 switched to session log + in-memory ledger.**
6. Whether `request_approvals` / `ask_choices` / `/approvals` collide with existing plugins. **Statically verified: the first two/the command are available.**
7. The behavior of `approval/request` prepend + `next()`; whether `allowed-once` still writes asked/decided. **Statically verified.**
8. Windows flash helper: resident PowerShell, whether it fails under EDR/ConstrainedLanguage, and failure degradation. **Sprint 2.**

## 6. Directory and next steps

```
dsh-approval-ledger/
  AGENTS.md
  package.json / tsconfig.json / tsconfig.test.json
  cordis.patch.yml
  README.md / README.en.md
  LICENSE / SECURITY.md / CONTRIBUTING.md / CHANGELOG.md
  HANDOFF.md
  icon.svg
  locale/{en,zh}.json
  docs/{design,threat-model,audit,runtime-notes,runtime-spike,compatibility}.md
  schema/audit-v1.json
  src/{core,path,command,args,risk,plan,audit}/
  test/
  .github/workflows/ci.yml
```

Next steps:

1. ~~**Sprint 0**: pure matchers (path/command/args), risk engine, plan schema/validation, audit schema/replay + unit tests. No UI, no installation.~~ **Done (0.0.2)**.
2. **Sprint 1**: observe mode, `request_approvals`, plan-review document, audit ledger/projection, `/approvals` command. **Host code is done (0.1.0-beta.1)**; remaining live P0 (card text, plan-review rendering, meta read-back, subagent behavior) and the install security review must be done before release.
3. **Sprint 2**: medium auto-allow, header details button/dialog, Windows flashing; release `0.2.0`.
4. **Sprint 3**: high opt-in + second confirmation, `ask_choices`, cross-session read-only list; release `0.3.0`.
5. **1.0.0**: API/audit format freeze, compatibility matrix.

## 7. Environment

- Git: `C:\Program Files\Git\cmd\git.exe` (2.55.0.5)
- GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe` (2.102.0)
- Logged-in account: `yingcai233333`
- Repository: <https://github.com/yingcai233333/dsh-approval-ledger>
- Previous session workspace: `D:\AIworkspace\LocalModel`; `.dsh-research` is read-only research output and was **not migrated into the repository**.
- Node/pnpm: use the ones bundled with the DSH runtime; do not install a new environment and do not change the system PATH.
- Release: 2FA + GitHub Actions OIDC trusted publishing + `--provenance`; do not print tokens in CI logs.

## 8. Not doing

- Do not replace the official approval/question/plan UI.
- Do not add new session event types.
- Do not do "always allow" or "allow for the whole tool".
- Do not auto-allow critical / unknown.
- Do not do cross-session grant inheritance.
- Do not persist grants.
- Do not write full arguments/reason/secrets into the ledger or logs.
- Do not modify system environment variables and do not install native dependencies.

## 9. First sentence for a new session

> Read `HANDOFF.md`, `docs/design.md`, `docs/runtime-spike.md` first; Sprint 1 Host code is done (observe by default), the next step is live P0 + install security review, do not install the plugin first. Before installing/publishing, confirm item by item according to the user's plugin security review rules.

## 10. Build notes (important)

- DSH's internal packages are not fully published to npm: `pnpm install` resolving `@deepseek-ai/dsh-type-meta` returns 404.
- Therefore `package.json` does **not** put `@deepseek-ai/*` into devDependencies/peerDependencies; the plugin uses the minimal structural declarations in `src/types/dsh-runtime.ts`, and its value imports are only local modules and Node built-in modules.
- When DSH types are needed during implementation, prefer:
  1. Write minimal local declarations in `src/types/`; or
  2. Use the `.d.ts` from the DSH checkout as a read-only reference;
  3. Do not add unpublished `@deepseek-ai/*` back to the dependencies, otherwise CI will fail.
- Tests: `pnpm test` first runs `tsc -p tsconfig.test.json` outputting to `lib-test/`, then executes with Node's built-in test runner (`--test-isolation=none`); this way it does not depend on the esbuild subprocess and can also run inside a sandbox. `vitest` is still in devDependencies, reserved for later client tests.
- Local verification: 273 tests, `pnpm lint` 0 warnings, `pnpm build` succeeds; GitHub Actions passes all four combinations of Ubuntu/Windows × Node 22/24 (run 39135436206).
- **Version note**: both the static verification and the repository target are the installed package `0.2.1-rc.2`; before release, the interfaces in `docs/runtime-spike.md` must still be re-verified against that target version.
