# dsh-approval-ledger

Batch approvals with a risk gate and an auditable decision ledger for **DeepSeek Harness**.

> **Status: Sprint 0 scaffold.** No usable approval feature yet. The first release will be `0.1.0` (observe-only).

## Why

DSH asks for privileged operations one at a time. Because write/command tools are scheduled exclusively, the first approval blocks everything after it: you cannot collect future approvals without letting the agent declare them first.

This plugin adds:

- **One plan for a batch.** The agent submits `request_approvals`; you review a concise list and approve once.
- **Dependency stages.** Plan items can declare `dependsOn`; the matcher only unlocks a dependent item after its dependencies are consumed.
- **Risk gate.** Every actual call is re-classified. Critical operations are never auto-approved; high-risk ones need an explicit opt-in and a second confirmation; unknown ones stay manual.
- **Decision ledger.** Every auto/manual decision is traceable through the session log plus a small metadata-only audit store.
- **Official UI first.** The shipped approval card, question card, and plan card are not replaced.

## Safety model

- `critical` is **never** auto-approved.
- `unknown` is always manual.
- Auto-approval requires **two gates**: the plan scope matches **and** the actual call is risk-eligible.
- Grants are in-memory, session-scoped, and turn-scoped; they disappear on turn end, unload, or restart.
- Any exception, parse failure, or mismatch falls back to the official approval UI.
- The audit store never records full arguments, commands, reasons, or secrets.

## Install

Not yet. `0.1.0` will be published after the observe-only implementation and the first compatibility pass.

```sh
# planned
dsh plugin --profile <profile> add dsh-approval-ledger
```

## Development

Requirements: Node.js 22+, pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The package is a Cordis bundle: `cordis.patch.yml` inserts the `approval-ledger` row; `lib/index.js` is the Host half.

## Documentation

- [Design](docs/design.md)
- [Threat model](docs/threat-model.md)
- [Audit / decision ledger](docs/audit.md)
- [Runtime notes](docs/runtime-notes.md)
- [Compatibility](docs/compatibility.md)
- [Handoff](HANDOFF.md)

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Unofficial community plugin. Not affiliated with DeepSeek. Do not use the DeepSeek name or logo to imply endorsement.
