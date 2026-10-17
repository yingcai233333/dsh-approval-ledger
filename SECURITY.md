# Security Policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Advisories → Report a vulnerability) instead of a public issue.

Include:

- Plugin version and DSH version.
- Operating system.
- Minimal reproduction steps.
- Impact assessment (what an attacker could do).
- Any relevant logs, with tokens, paths, and user data redacted.

## Scope

This plugin is a Host Cordis plugin with full Node.js access. It reads session/tool metadata, registers an `approval/request` listener, writes a metadata-only audit store, and may spawn a fixed PowerShell helper for Windows taskbar flashing.

It does **not**:

- add new session event types;
- replace the official approval/question/plan UI;
- modify the Electron main process;
- modify system environment variables;
- install native dependencies;
- send telemetry or network requests.

## Design principles

- Fail closed: any unexpected state falls back to the official approval path.
- Critical operations are never auto-approved.
- Unknown operations are manual.
- Grants are turn-scoped, in-memory, and never inherited by child sessions.
- Logs and the audit store never contain full commands, arguments, reasons, or secrets.

See [docs/threat-model.md](docs/threat-model.md) for the full threat model.
