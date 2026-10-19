> Language: [English](threat-model.en.md) · [中文](threat-model.md)

# Threat Model

## Assets

- The user's workspace files, system directories, credentials, and DSH's own configuration/plugins.
- Decision records in session logs and the audit ledger.
- The user's attention (avoiding mis-approval caused by approval fatigue).

## Trust boundaries

- **Model output is untrusted**: a plan item's title/note, the justification, and question text can all mislead.
- **Tool arguments are untrusted**: paths, commands, and args may contain bypasses or concealment.
- **Plugin code is trusted only after review**: Host plugins have full Node privileges; installing one must go through the user's plugin security review first.
- **Other plugins may also answer `approval/request`**: multiple auto-approval plugins will contend with each other.

## Threats and controls

| Threat | Impact | Control |
|---|---|---|
| Path escape (`..`/symlink/junction/hardlink/UNC/ADS/8.3) | Writes outside the approved scope | Absolutization + realpath of nearest ancestor + case normalization + special-path rejection + hard links (nlink > 1) as high/manual + dedicated tests |
| Replace-after-check (TOCTOU) | A is approved, B is written | Re-realpath at call time + risk gate; residual races are documented explicitly and zero risk is not promised |
| Command chains (`;`/`&&`/newline/wrapper/script) | Approved A becomes A+B | Exact whole-string match; control characters/scripts/interpreters never automatic; shown in full |
| critical smuggled into a batch | System gets modified | critical is never automatic; sorted by risk; called out separately |
| Risk engine misses a case | A dangerous operation is treated as medium | unknown is always manual; conservative rules; advisory only, never auto-deny |
| Misleading model note | The user approves based on false information | System judgment comes first; model note marked "unverified"; summaries never use model text |
| Title summary hides mode/path | Privileges are underestimated | Summary derived from the actual arguments; must include mode + target; original text available for inspection |
| Child session reuses parent grant | Privilege spread | Grant keyed by session id; no inheritance |
| Turn-boundary race | Stale grant | Grant records turn; revoked at `turn/end`; validated at match time |
| PowerShell flashing | EDR alerts / wrong window / orphan processes | Fixed script, PID + image name, throttling, idle exit, graceful degradation on failure |
| UI injection / secrets on screen | XSS / leakage | React escaping; Markdown strips HTML/links/images; suspected secrets redacted; arguments not logged |
| Upgrade breakage | Plugin errors / approval blockage | Pinned versions; runtime guards; try/catch fallback to `next()`; official UI not replaced |
| Multi-plugin conflict | Double auto-approval / double alerts | `audit-only` mode; `notifications:false`; compatibility matrix; no stacked auto-approval |
| npm supply chain | Malicious packages / tampering | Zero runtime dependencies; 2FA; OIDC provenance; signed tag; branch protection |

## Residual risks

- Path grants are not bound to the written content; code/config-class writes are manual by default, and only data-class writes are batched.
- Hard links cannot be distinguished by path; we can only detect `nlink > 1` and downgrade to manual. The permission to create hard links is decided by the OS.
- A TOCTOU window remains between the check and the actual write; concurrent replacement on the same volume is beyond what a pure matcher can eliminate.
- The semantics of arbitrary shell commands cannot be determined statically; unknown is always manual.
- Model text can social-engineer the user; separating system judgment from the model note can only reduce this.
- Future approval-layer policy may be skipped by upstream pre-approval; the current policy sits further upstream (pre-execute/guard).
- Windows path edge cases, EDR policy, and drift in DSH internal APIs.
- The user may approve without reading; observe mode, risk sorting, the ledger, and second confirmation can only mitigate.

## Hard rules

1. critical is never auto-approved.
2. unknown => manual.
3. Two gates: plan scope + per-call risk eligibility.
4. Fail closed: any exception/parse failure => `next()`.
5. Turn-scoped, in-memory, not inherited by child sessions, not persisted.
6. critical/high come first; never buried.
7. A single decision path: the official card; modal is read-only.
8. No secrets in logs/the ledger.
