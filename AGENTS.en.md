> Language: [English](AGENTS.en.md) · [中文](AGENTS.md)

# Workspace constraints

This file records the hard constraints the user stated verbally in the current workspace. Changes are made only when the user explicitly raises them in conversation.

## Phase constraints (Sprint 1)

- For now do only **Host-side wiring**: `request_approvals`, `/approvals`, the `approval/request` hook, plan-review documents, grants, and the session-log audit projection; observe-only by default. Do not replace the official approval/question/plan UI.
- **Do not install plugins first**: do not run `dsh plugin ... add`, do not change the profile, and do not run `pnpm add` / `npm install` to install new packages.
- **Do not release first**: do not create tags, do not publish, do not trigger the release workflow; do not release before live P0 and the install security review are complete.
- Before installing/publishing, confirm item by item according to the user's security review rules:
  1. Source (npm/GitHub official repository, publisher identity, download counts and update time);
  2. Version and dependency tree, peer dependency compatibility;
  3. List every install script (`preinstall` / `install` / `postinstall`, etc.) one by one;
  4. Write out the risks of each point that cannot be confirmed, without glossing over them with "should be fine";
  5. List "what to install, from where, what scripts will run, which files will be changed, and the scope of impact", and execute only after the user explicitly agrees;
  6. Consent is valid only for that one plugin/version listed at that time, and does not carry over or extend by analogy.
- When a DSH peer version exemption is involved, a separate warning must be given in terms of "may crash, may lose data", and permission must be obtained for that exact plugin + runtime version.

## Implementation constraints

- Do not add session event types; do not replace `ui-approval`; do not occupy `conversation.approval.detail`.
- Do not modify system environment variables, do not install native dependencies, and do not write outside the workspace.
- The ledger/log does not record secrets, full arguments, or the full reason; store only hash/summary/level/attribution.
- Any exception, parse failure, or uncertainty is fail-closed (fall back to the official approval or mark unknown/manual).
- `critical` is never auto-allowed; `unknown` is always manual.

## Tests

- Local tests use Node's built-in test runner + `tsc` precompilation, avoiding the esbuild subprocess restriction in the sandbox.
- Do not relax the above security constraints just to make testing easier.
