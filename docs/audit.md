> Language: [English](audit.en.md) · [中文](audit.md)

# 审计 / 决策账本

## 为什么

DSH 的 session log 已经记录了动作和审批事实：

- `tool/call` / `tool/result`：每一步执行；
- `approval/asked` / `approval/decided`：每次审批（包括自动放行）；
- `user-question-reply`：用户对计划/问题的回答；
- `turn/start` / `turn/end`：边界。

缺的是**归属和理由**：这次自动放行属于哪个计划的哪一项？风险等级是什么？为什么可自动放行？

## 为什么不新增事件类型

DSH 不允许在线追加（live append）未知事件类型：未知事件只有在存储时带 `ignorable: true` 才能被读取，而 `Session.append()` 无法设置该标记，会话会拒绝重开。所以：

- 不新增 `approval-ledger/decision` 之类的事件；
- 决策内容放在 `tool/result.meta` + 插件账本，再用投影 join（关联）。

## 分层

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

4. **`approval-audit` 投影**：join（关联）1–2 层 + 内存账本，按 `callId`/`seq` 关联；缺失的每次调用记录从持久 `tool/call.arguments` + 当前 risk policy 派生，标 `derived-session-log`；无法解析则 `unattributed`。`/approvals audit [--json]` 输出；不猜。

## 重放状态

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
- 会话历史读不到时，`/approvals audit` 的文本报告顶部会标注 degraded 原因码（`no-snapshot-reader` / `snapshot-threw` 等），结论只基于内存账本；因此回落官方卡的调用记录 `matchedBy = degraded-no-turn`（历史可读但无 turn 边界时为 `no-turn-boundary`），字段里仍然不含任何参数/路径。`--json` 的 v1 导出结构不变，只在 logger 里告警。
- 报告只展示摘要和 hash 前缀；原始 reason、参数、命令不进入报告。
- 解析失败的事实/账本行记为 issue 并跳过，不让整份报告崩溃。

## 报告

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

## 格式稳定性 / v1 冻结

从 **0.3.0** 起，审计记录格式 v1（[`schema/audit-v1.json`](../schema/audit-v1.json)）**已冻结**：不再做破坏性改动；确需破坏性变更时只能发布 v2，并继续读 v1。

- **版本标识**：`$id` 以 `/schema/audit-v1.json` 结尾，`properties.schemaVersion.const` 为 `1`，`src/core/version.ts` 的 `SCHEMA_VERSION` 为 `1`；这三者必须一致。schema 顶层 `$comment` 另外标注 `FROZEN`，作为格式已冻结的显式标记。
- **v1 字段**：顶层必填 `schemaVersion`、`sessionId`、`callId`、`tool`、`risk`、`outcome`、`time`；可选 `seq`、`planId`、`itemId`、`mode`、`targetHash`、`targetSummary`、`matchedBy`、`matcherVersion`、`riskPolicyVersion`。未知字段一律拒绝（`additionalProperties: false`）。
- **`target.kind`**：v1 记录不保存 `target` 对象，只保存 `targetHash` 与 `targetSummary`；`target.kind` 的枚举（`path` / `command` / `args` / `unknown`）只参与 `targetHash` 的规范化，但同样属于冻结契约——改动它会令所有历史 hash 失效。
- **`decision` 与 `outcome`**：账本记录的字段名是 `outcome`，枚举为 `allowed-once` / `rejected` / `cancelled` / `unavailable`；回放行与导出的 `decision` 就是这个值。v1 记录没有独立的 `decision` 字段。
- **护栏**：`test/audit-freeze.test.ts` 钉住上述 required 集合、枚举、`$id` 与版本常量；改动这些必须同步修改该测试，并按下面的 major 流程处理。

### 兼容变更（minor）

- 新增**可选**字段：旧记录缺少该字段仍然合法、可读，无需迁移。
- 放宽校验，或补充不改变既有字段语义的元数据。
- 升级读取方时保持对旧记录解释不变；不回写、不重写历史记录。

### 破坏性变更（major，需要 v2）

- 删除或重命名字段（包括把 `outcome` 改名为 `decision`）。
- 改变字段语义或单位（例如 `time` 从毫秒改成秒、`outcome` 的含义变化）。
- 新增必填字段，或把可选字段改成必填。
- 收紧校验：缩小枚举、降低长度/数值上限、拒绝以前合法的记录。
- 改变 `targetHash` 的规范化算法或 `target.kind` 的取值。

以上任一项都必须发布 v2 schema，并**保留读取 v1 记录的能力**；不得在 `schemaVersion: 1` 下悄悄改变含义。

### 旧记录可读性

- v2 出现后，读取方仍须能解析 `schemaVersion: 1` 的记录，并按 `schemaVersion` 选择校验/解释路径。
- v1 记录不得被静默重解释为 v2；升级只能显式、单向，历史记录保持原样。
- 版本无法识别或字段超出已知契约时仍然 fail-closed：记为 issue / `unverifiable`，不猜测、不丢弃。

## 隐私 / 生命周期

- 账本只存元数据；不存密钥/参数/reason。
- 保留期可配（默认 30 天）；`session/disposed` 清理。
- fork/resume：账本按 session id；fork 复制日志，账本只读父会话；新会话重新记。
- 版本字段不匹配时标“无法验证”，不猜。
