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

3. **插件账本（每次调用）**：Sprint 1 使用**内存** `MemoryAuditStore`，按 session 分区；记录只活到 session 卸载/重启。`ctx.storageDomain` 是 schema 校验的 KV（`put/delete/entries`），**不是** append-only 日志；跨会话持久化推迟，避免为了 KV 引入 `zod` 运行时依赖。

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

4. **`approval-audit` 投影**：join 1–2 层 + 内存账本，按 `callId`/`seq` 关联；缺失的每次调用记录从持久 `tool/call.arguments` + 当前 risk policy 派生，标 `derived-session-log`；无法解析则 `unattributed`。`/approvals audit [--json]` 输出；不猜。

## Replay states

| 状态 | 含义 |
|---|---|
| `verified` | 审批事实、账本记录、版本、结果、工具一致 |
| `unattributed` | 有审批决定，但找不到对应的账本记录；不猜归属 |
| `unverifiable` | 记录存在，但版本不匹配/缺失、session 不符、或缺计划元数据 |
| `mismatch` | 账本结果或工具与审批事实不一致 |
| `orphan` | 账本有记录，但 session log 里没有对应审批事实 |
| `pending` | 有 `approval/asked`，但没有 `approval/decided` |

- 版本字段（`schemaVersion` / `matcherVersion` / `riskPolicyVersion`）不匹配或缺失，一律 `unverifiable`。
- 重启后由 `tool/call` 参数派生的记录 `matchedBy = derived-session-log`；风险用当前 policy 重算，是解释性证据，不是历史策略的证明。
- 报告只展示摘要和 hash 前缀；原始 reason、参数、命令不进入报告。
- 解析失败的事实/账本行记为 issue 并跳过，不让整份报告崩溃。

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
