# 参与贡献

> Language: [English](CONTRIBUTING.en.md) · [中文](CONTRIBUTING.md)

## 环境准备

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 基本规则

- 不要替换 `ui-approval`、`ui-user-questions`、`ui-plan` 或 `ui-chat`；请使用官方扩展点。
- 不要新增 session 事件类型。请使用 `tool/result.meta`、session log 以及内存中的逐调用账本。
- 不要自动批准 `critical` 或 `unknown` 操作。
- 任何新增的匹配规则都需要对抗性测试（路径穿越、符号链接、命令串联、大小写、UNC、ADS、8.3）。
- 任何用户可见的字符串都必须经由 `ctx.locale`。
- 不要记录完整的工具参数、命令、原因或密钥。

## Pull Request

- 保持改动聚焦。
- 新增或更新测试。
- 对用户可见的变更请更新 `CHANGELOG.md`。
- 说明运行了哪项 P0 核对（spike）或兼容性检查。

## DSH 软件包的可用性

部分 DSH 内部包（例如 `@deepseek-ai/dsh-type-meta`）并未发布到 npm。不要将 `@deepseek-ai/*` 包加入 `dependencies`、`devDependencies` 或 `peerDependencies`：否则 `pnpm install` 会因 404 失败。在这些包完全发布之前，请改用 `src/types/dsh-runtime.ts` 中的本地结构化类型表面，或以 DSH 代码检出作为参考。
