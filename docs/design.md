> Language: [English](design.en.md) · [中文](design.md)

# 设计

> 目标：在**不替换官方 UI**、**不新增 session 事件类型**的前提下，为 DSH 提供批量审批、风险提示和可追溯的决策账本。

## 目标

- 一次批准一批已声明的操作，减少串行打断。
- 列表简明，可展开看原因/后果/建议。
- 依赖关系按阶段展示，并在执行时门控。
- 关键操作重点标出；需要审批时桌面提醒。
- 决策内容可追溯、可导出。

## 非目标

- 不做“永久允许”或“全部放行”。
- 不自动推断未声明的因果依赖。
- 不替代官方审批卡/问题卡/计划卡。
- 不保证零风险；只做“有界、可回退、失败关闭”。

## 架构

```
agent
  └─ request_approvals (tool)
       └─ plan-review question (official UI)
            └─ user approves
                 └─ grants (session, turn-scoped)
                      └─ approval/request (prepend listener)
                           ├─ plan gate + risk gate → allowed-once
                           └─ otherwise → official approval UI
```

审计：

```
session log (facts) + tool/result.meta (plan decision) + audit store (per-call rationale)
  └─ approval-audit projection
       ├─ /approvals audit
       └─ wire.view (plan doc / sidebar)
```

## 计划工具

`request_approvals` 的 schema 见 `HANDOFF.md`。校验：

- id 唯一、依赖无环、tool 已注册；
- 路径绝对化、realpath 最近已存在祖先、拒绝 `..` 逃逸/UNC/ADS/8.3/设备名/尾点空格；硬链接（`nlink > 1`）按 high/manual；
- 命令长度上限、控制符/脚本标记；含元字符/解释器/脚本/下载的命令不自动匹配；
- 总数/单项 uses 上限；
- 只允许主会话（子会话没有人类应答方，即 answerer）。

计划文档：

- 第一行标题（含风险计数）；
- 第一段两行摘要；
- 清单表（编号/操作/风险/依赖）；
- 每项详情（是什么/为什么/批准后/系统判断/模型说明/建议）。

## 授权（Grants）

- 按 session、按 turn；内存态；不持久化。
- 字段：`planId`、`itemId`、`tool`、`kind`、`mode`、`scope`、`usesLeft`、`deps`、`state`。
- 匹配成功同步消费一次；依赖全部 used 才 ready。
- `turn/end`、`agent/disposed`、插件卸载、重启全部撤销。

## 风险策略

| 等级 | 自动？ |
|---|---|
| medium | 是（仅数据类文件写入） |
| high | 手动；显式开启（opt-in）+ 二次确认 |
| critical | 从不 |
| unknown | 手动 |

风险引擎是确定性的、仅作建议（advisory）；`unknown` 不猜。详细规则见 `docs/threat-model.md`。

## 审计

见 `docs/audit.md`。核心：不新增事件类型；`tool/result.meta` + 内存账本 + 投影；账本只存元数据，不存参数/reason。`ctx.storageDomain` 是 KV 而不是仅追加（append-only）日志，Sprint 1 的持久事实来自 session log，跨会话留存推迟。

## 界面（UI）

- 单条：官方卡 + 标题摘要 + 头部详情弹窗；不改 `conversation.approval.detail`。
- 批量：官方 plan-review + 侧栏全文。
- 多选：官方 question + `ask_choices` 结构化内容。
- 提醒：计划卡、逐项勾选、`ask_choices` 和官方审批卡出现时，Windows 任务栏闪烁 + 合成「叮咚」提示音；范围与两个通道均可配置。
- 完成提醒：每轮对话结束（`turn/end`）另有一次提示——闪烁 + 绿色任务栏 overlay 徽标（`FlashWindowEx` 的颜色不可指定，绿色只能用徽标表达）+ 两声上行「滴滴」；子代理 turn 与 aborted turn 不提醒。
- 两个客户端表层的待审批来源不同：头部「审批详情」严格按当前会话（没有 `sessionId` 就不显示、也不跨会话扫）；右下角「待审批说明」是 frame-wide，先取当前会话，取不到再退回扫描全部会话中 `kind === 'approval'` 的项。

## 发布计划

- 0.1.0-beta.1：observe（只记录本应放行，不实际放行）+ 计划 + 审计（目标 DSH 0.2.1-rc.2；仓库里程碑，未发布到 npm）。
- 0.2 线（`0.2.0-beta.1` → `0.2.0-beta.15`，2026-10-19 → 2026-10-20）：medium 自动放行 + 详情弹窗 + 闪烁；high opt-in + 二次确认、`ask_choices`、跨会话只读列表也在这一线交付。
- 0.3.0（2026-10-21，`latest`）：无新功能，只做版本收口；代码与 `0.2.0-beta.15` 相同。
- 1.0.0（2026-10-21，`latest`）：审计格式 v1 与对外接口进入稳定期（冻结内容见 `docs/audit.md`），此后破坏性变更需按该文档的 major 流程；0.3.0 之后的四项改动（对话完成提醒、`session-log.ts` 收口与三态 fail-closed、`engines.dsh` 安装/启动闸门、客户端空容器修复）都进入本版本。`Session.snapshotEvents()` 已被上游标为 deprecated，本期只把它收口到 `src/plugin/session-log.ts` 并做 fail-closed 降级（不建 grant、不自动放行、回落官方卡）；**触发迁移的条件是上游删除或停止提供该 reader**——届时改为读取投影（投影 state 只放 turn，绝不放 `tool/call` 参数）+ 可选的 `sessionQuery`。
