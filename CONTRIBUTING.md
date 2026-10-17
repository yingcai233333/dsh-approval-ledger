# Contributing

## Setup

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Ground rules

- Do not replace `ui-approval`, `ui-user-questions`, `ui-plan`, or `ui-chat`; use official extension points.
- Do not add new session event types. Use `tool/result.meta` and the plugin audit store.
- Do not auto-approve `critical` or `unknown` operations.
- Any new matcher rule needs an adversarial test (path traversal, symlink, command chaining, case, UNC, ADS, 8.3).
- Any user-visible string goes through `ctx.locale`.
- Do not log full tool arguments, commands, reasons, or secrets.

## Pull requests

- Keep changes focused.
- Add or update tests.
- Update `CHANGELOG.md` for user-visible changes.
- State which P0 spike or compatibility check was run.

## DSH package availability

Some internal DSH packages (for example `@deepseek-ai/dsh-type-meta`) are not published to npm. Do not add `@deepseek-ai/*` packages to `dependencies`, `devDependencies`, or `peerDependencies` in this scaffold: `pnpm install` will fail with a 404. Use a local minimal type surface in `types/` or a DSH checkout for reference until the packages are fully published.
