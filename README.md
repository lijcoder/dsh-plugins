# dsh-plugins

日常使用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合。

## 插件

按「能力接缝 / 通道实现 / 功能 / 组合包」四层组织，加一个即时通讯平台只需新增一个通道包。

| 层 | 包 | 说明 |
| --- | --- | --- |
| 接缝 | [`@lijcoder/dsh-im`](./packages/dsh-im) | 即时通讯通道的命名注册表（`ctx.im`）+ 平台中立的文档模型 |
| 通道 | [`@lijcoder/dsh-im-wecom`](./packages/dsh-im-wecom) | 企业微信智能机器人（aibot）长连接；把中立文档渲染成企微 markdown |
| 功能 | [`@lijcoder/dsh-notify`](./packages/dsh-notify) | 任务完成、或需要用户授权时推送通知 |
| 功能 | [`@lijcoder/dsh-im-commands`](./packages/dsh-im-commands) | 在 IM 里用 `/` 命令查询 dsh 状态（`/list`、`/help`） |
| 组合包 | [`@lijcoder/dsh-notify-wecom`](./packages/dsh-notify-wecom) | 装一次配齐上面四个（企微场景） |
| 工具 | [`@lijcoder/dsh-plugin-testkit`](./packages/dsh-plugin-testkit) | 插件测试工具：真实 cordis Context 挂载、日志捕获、dsh 领域夹具 |

## 安装

每个插件都是独立的 dsh bundle，按需装进某个 profile。企微场景直接装组合包：

```sh
dsh plugin --profile web add @lijcoder/dsh-notify-wecom
```

装完**重启该 profile 的进程**——插件模块代码不参与热重载。

第一次配置某条 bundle 时，建议先只验证配置层，不启动：

```sh
dsh --profile web --dump-config | grep -A3 dsh-notify-wecom
```

`--dump-config` 会重写 profile 的 `cordis.yml`，别对着正在运行的 profile 执行。

## 仓库结构

```
packages/
  dsh-im/               接缝：ImChannel / ImDocument / ctx.im
  dsh-im-wecom/         通道：企微 aibot 长连接 + ImDocument → 企微 markdown
  dsh-notify/           功能：完成/授权通知
  dsh-im-commands/      功能：/list、/help
  dsh-notify-wecom/     组合包：四行插进 profile；tests/ 放组合端到端用例
  dsh-plugin-testkit/   测试工具（真实 cordis Context 挂载、dsh 领域夹具）
```

约定见 [AGENTS.md](./AGENTS.md)。

## 开发

需要 Node ≥ 22 与 pnpm。

```sh
pnpm install
pnpm check        # build + typecheck + test
```

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 全仓构建（`lib/`） |
| `pnpm test` | 全仓测试 |
| `pnpm check` | 上面三步按顺序跑一遍 |

`@deepseek-ai/*` 依赖的版本集中在根 `pnpm-workspace.yaml` 的 `dsh` catalog 里，
升级 harness 只改那一处。
