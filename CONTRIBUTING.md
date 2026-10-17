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
