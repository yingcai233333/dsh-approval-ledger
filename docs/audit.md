# Audit / decision ledger

## Why

DSH 的 session log 已经记录了动作和审批事实：

- `tool/call` / `tool/result`：每一步执行；
- `approval/asked` / `approval/decided`：每次审批（包括自动放行）；
- `user-question-reply`：用户对计划/问题的回答；
- `turn/start` / `turn/end`：边界。

缺的是**归属和理由**：这次自动放行属于哪个计划的哪一项？风险等级是什么？为什么可自动放行？

## Why not a new event type

DSH 不允许 live append 未知事件类型：未知事件只有在存储时带 `ignorable: true` 才能被读取，而 `Session.append()` 无法设置该标记，会话会拒绝重开。所以：

- 不新增 `approval-ledger/decision` 之类的事件；
- 决策内容放在 `tool/result.meta` + 插件账本，再用投影 join。

## Layers

1. **session log（事实）**：已有，不重复。
2. **`tool/result.meta`（计划级）**：

```json
{
  "planId": "P-7f3a",
  "schemaVersion": 1,
  "matcherVersion": 1,
  "riskPolicyVersion": 1,
  "decision": "approved",
  "approved": ["A", "B"],
  "manual": ["C"],
  "items": [{ "id": "A", "tool": "write", "risk": "medium", "uses": 1 }],
  "grants": [{ "item": "A", "uses": 1, "expires": "turn" }]
}
```

3. **插件账本（每次调用）**：`ctx.storageDomain`，按 session 分区，append-only。

```json
{
  "schemaVersion": 1,
  "sessionId": "…",
  "seq": 1234,
  "callId": "call_…",
  "planId": "P-7f3a",
  "itemId": "A",
  "tool": "write",
  "risk": "medium",
  "mode": "danger-full-access",
  "targetHash": "sha256:…",
  "targetSummary": "out/report.md",
  "matchedBy": "plan-scope+risk-gate",
  "outcome": "allowed-once",
  "matcherVersion": 1,
  "time": 1760000000000
}
```

- 不存完整参数/reason/命令；只存 hash/摘要/等级/归属。
- 完整内容在 session log 里，授权读者可查。

4. **`approval-audit` 投影**：join 1–3 层，按 `callId`/`seq` 关联；按 turn/plan 分组；缺失记录标 `unattributed`；`/approvals audit [--json]` 输出；`wire.view` 给客户端。

## Report

```md
## 审批决策记录 · 2026-10-15 10:12

计划 P-7f3a（4 项，批准于 10:12:03，turn 4）
| 项 | 操作 | 风险 | 授权 | 使用 | 结果 |
|---|---|---|---|---|---|
| A | write out/report.md | 中 | 1 次 | 1/1 | 自动放行 10:12:31 |
| B | write out/data.json | 中 | 1 次 | 0/1 | 未使用 |
| C | pwsh npm test | 高 | 手动 | — | 手动允许 10:13:02 |
| D | write C:\...\config.json | 严重 | 手动 | — | 手动拒绝 10:14:10 |

校验：4 条审批事件，4 条审计记录，0 条未归属。
```

## Privacy / lifecycle

- 账本只存元数据；不存密钥/参数/reason。
- 保留期可配（默认 30 天）；`session/disposed` 清理。
- fork/resume：账本按 session id；fork 复制日志，账本只读父会话；新会话重新记。
- 版本字段不匹配时标“无法验证”，不猜。
