# Release review — 0.2.0-beta.1

> Language: [English](release-0.2.0-beta.1.en.md) · [中文](release-0.2.0-beta.1.md)

> Status: **published to npm (2026-10-19)**. Tarball: <https://registry.npmjs.org/dsh-approval-ledger/-/dsh-approval-ledger-0.2.0-beta.1.tgz>. Both `next` and `latest` point to `0.2.0-beta.1`; npm forced a `latest` tag on the first publish and refuses to remove it. Move `latest` to a stable version when one is released.
>
> Follow-up: the docs-only `0.2.0-beta.2` is published with `next`/`latest` pointing at beta.2; this page keeps the beta.1 history.

## Package

| Item | Value |
|---|---|
| Name | `dsh-approval-ledger` |
| Version | `0.2.0-beta.1` |
| Target DSH | `0.2.1-rc.2` |
| Node | `>=22` |
| Dependencies / peer deps | none |
| Install lifecycle scripts | none |
| Runtime imports | local modules + Node built-ins only |
| Files | `lib`, `client.js`, `schema`, `locale`, `icon.svg`, `cordis.patch.yml`, READMEs, LICENSE, SECURITY |
| Default mode | `observe`; `mode: active` is explicit opt-in |

## Verified

- 273 unit tests; `pnpm lint` 0 warnings; `pnpm build` passes.
- GitHub Actions: Ubuntu/Windows × Node 22/24 (run `39135436206` for the pre-client commit); latest client/flash commit CI is being checked.
- Live P0 in `approval-p0` and desktop: plan-review, per-item selection, A/B split, high-risk approval card with rewritten `displayReason`, reject fail-closed, plan cancel, subagent `DELEGATED_CALLER`, audit attribution.
- Desktop restart: Host `request_approvals` registered; client slot `approval-ledger-details` active.

## Known gaps / caveats

- Windows `FlashWindowEx` helper is unit-tested but its actual window flash has not been live-verified in Electron.
- Sibling `approval/request` ordering has FakeContext coverage; a live second-approval-plugin test is not done.
- A workspace-write that DSH allows without an `approval/asked` event can only be shown as `无法验证` (attributed by target hash but no approval decision); it is not a verified approval.
- The desktop profile currently uses `link:D:\AIworkspace\dsh-approval-ledger`; moving/deleting that directory breaks the installed profile. Publish/install from npm removes that coupling.

## Publish checklist (requires explicit approval)

1. Confirm final version is `0.2.0-beta.1` and working tree is clean.
2. Confirm npm account/2FA and package ownership; do not paste tokens into logs.
3. `pnpm pack --dry-run` (or `npm pack --dry-run`) and inspect that `lib/`, `client.js`, `schema/`, `locale/`, `cordis.patch.yml`, and docs are included and no `.p0-*`/tests/secrets are included.
4. Publish with the beta tag (`npm publish --tag next`). npm may force `latest` on the first publish; record the resulting dist-tags instead of assuming `latest` is absent.
5. Create the matching GitHub tag/release and verify the published tarball in a clean profile with `dsh plugin add dsh-approval-ledger@0.2.0-beta.1` after security review.
6. Rollback: deprecate/unpublish per npm policy; existing local profiles can remove the bundle or restore `.p0-backup`.

## Publish attempt log

- 2026-10-19: after local login (`pnpm whoami` → `yingcai233`), the first publish returned `E403 ... 2FA required`. Root cause: pnpm preferred the old token in `C:\Users\36288\AppData\Local\pnpm\config\auth.ini` over the new bypass-2FA token in `.npmrc`. After replacing `auth.ini`, publish succeeded: `✅ Published package dsh-approval-ledger@0.2.0-beta.1`.
- npm forced `latest` to `0.2.0-beta.1` on the first publish; `pnpm dist-tag rm ... latest` returns `ERR_PNPM_DIST_TAG_RM_LATEST` (removal is not allowed). `next` also points at this version; move `latest` to the stable version when released.
- Rotate/revoke any leaked or expired token before the next release; never put a token or OTP in chat.

## Do not

- Do not manually mark a beta as `latest`; this first-publish `latest` was forced by npm and cannot be removed, so a stable release must explicitly move `latest`.
- Do not publish without checking the packed file list and the user's explicit release approval.
- Do not install the npm tarball into `desktop` before the published tarball is inspected.
