# Security Policy

> Language: [English](SECURITY.md) · [中文](SECURITY.zh.md)

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Advisories → Report a vulnerability) instead of a public issue.

Include:

- Plugin version and DSH version.
- Operating system.
- Minimal reproduction steps.
- Impact assessment (what an attacker could do).
- Any relevant logs, with tokens, paths, and user data redacted.

## Scope

This plugin is a Host Cordis plugin with full Node.js access. It reads session/tool metadata, registers `request_approvals`, an `/approvals` command, and an `approval/request` listener, and keeps a metadata-only in-memory per-call ledger. The durable evidence remains the session log and plan-level `tool/result.meta`.

It does **not** (as of 0.1.0-beta.1):

- add new session event types;
- replace the official approval/question/plan UI;
- modify the Electron main process;
- modify system environment variables;
- install native dependencies;
- send telemetry or network requests;
- spawn a PowerShell/notification helper (planned for Sprint 2).

## Design principles

- Fail closed: any unexpected state falls back to the official approval path.
- Critical operations are never auto-approved.
- Unknown operations are manual.
- Grants are turn-scoped, in-memory, and never inherited by child sessions.
- Logs and the audit store never contain full commands, arguments, reasons, or secrets.

See [docs/threat-model.md](docs/threat-model.md) for the full threat model.
