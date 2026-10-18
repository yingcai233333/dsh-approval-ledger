# Threat model

## Assets

- 用户的工作区文件、系统目录、凭据、DSH 自身配置/插件。
- 会话日志和审计账本里的决策记录。
- 用户的注意力（避免审批疲劳导致误批）。

## Trust boundaries

- **模型输出不可信**：plan item 的 title/note、justification、问题文案都可能误导。
- **工具参数不可信**：路径、命令、args 可能包含绕过/隐藏。
- **插件代码可信的前提是经过审查**：Host 插件有完整 Node 权限；安装前必须走用户的插件安全审查。
- **其他插件可能也在 `approval/request` 上作答**：多个自动审批插件会互相抢占。

## Threats and controls

| Threat | Impact | Control |
|---|---|---|
| 路径逃逸（`..`/symlink/junction/hardlink/UNC/ADS/8.3） | 写到批准范围外 | 绝对化 + realpath 最近祖先 + 大小写归一 + 拒绝特殊路径 + 硬链接（nlink > 1）按 high/manual + 专项测试 |
| 检查后替换（TOCTOU） | 审批的是 A、落盘到 B | 调用时重新 realpath + 风险门；残余竞态明确记录，不承诺零风险 |
| 命令链（`;`/`&&`/换行/wrapper/脚本） | 批准的 A 变成 A+B | 整串精确；控制符/脚本/解释器不自动；完整展示 |
| critical 夹带在批量里 | 系统被改 | critical 永不自动；按风险排序；单独标注 |
| 风险引擎漏判 | 危险操作被当 medium | unknown 一律 manual；保守规则；只建议不自动拒绝 |
| 模型说明误导 | 用户基于假信息批准 | 系统判断在前、模型说明标“未验证”；摘要不用模型文本 |
| 标题摘要隐藏 mode/路径 | 低估权限 | 摘要从实际参数推导；必须含 mode + 目标；原文可查 |
| 子会话复用父授权 | 权限扩散 | grant 按 session id；不继承 |
| turn 边界竞态 | 过期授权 | grant 记录 turn；`turn/end` 撤销；匹配时校验 |
| PowerShell 闪烁 | EDR/错窗口/孤儿进程 | 固定脚本、PID+镜像名、节流、空闲退出、失败降级 |
| UI 注入/密钥上屏 | XSS/泄漏 | React 转义；Markdown 去 HTML/链接/图片；疑似密钥打码；日志不记参数 |
| 升级破坏 | 插件报错/审批阻塞 | pin 版本；运行时守卫；try/catch 回退 `next()`；不替换官方 |
| 多插件冲突 | 双重自动审批/提醒 | `audit-only` 模式；`notifications:false`；兼容矩阵；不叠 auto-approval |
|  npm 供应链 | 恶意包/篡改 | 零运行时依赖；2FA；OIDC provenance；signed tag；分支保护 |

## Residual risks

- 路径授权不绑定写入内容；代码/配置类默认 manual，数据类才批量。
- 硬链接无法通过路径区分目标；只能检测 `nlink > 1` 并降为 manual。创建硬链接的权限由 OS 决定。
- 检查与实际写入之间仍有 TOCTOU 窗口；同一卷上的并发替换不在纯匹配器能消除的范围内。
- 任意 shell 命令语义无法静态判定；unknown 一律 manual。
- 模型文本可社会工程；系统判断和模型说明分离只能降低。
- 未来审批层策略可能被前置放行跳过；当前策略在更上游（pre-execute/guard）。
- Windows 路径边角、EDR 策略、DSH 内部 API 漂移。
- 用户可能不看就批；观察模式、风险排序、台账、二次确认只能缓解。

## Hard rules

1. critical never auto.
2. unknown => manual.
3. two gates: plan scope + per-call risk eligibility.
4. fail closed: any exception/parse failure => `next()`.
5. turn-scoped, in-memory, no child inheritance, no persistence.
6. critical/high sorted first; never bury.
7. single decision path: official card; modal is read-only.
8. no secrets in logs/ledger.
