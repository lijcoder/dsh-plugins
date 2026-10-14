# dsh-plugins

日常使用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合。

## 插件

| 包 | 说明 |
| --- | --- |
| [`@lijcoder/dsh-notify-wecom`](./packages/dsh-notify-wecom) | 顶层会话空闲、或需要用户授权时，通过企业微信智能机器人（aibot）长连接推送 markdown 通知：会话标题、工作目录、状态、回合耗时、最后回复或授权原因。同时支持 `/list`、`/help` 等企微内命令 |

## 安装

每个插件都是独立的 dsh bundle，按需装进某个 profile：

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
  dsh-notify-wecom/     插件：一个包 = 一个可发布的 bundle
  dsh-plugin-testkit/   共享测试工具（真实 cordis Context 挂载、dsh 领域夹具）
```

约定见 [AGENTS.md](./AGENTS.md)。

## 开发

需要 Node ≥ 22 与 pnpm。

```sh
pnpm install
pnpm check        # typecheck + build + test
```

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 全仓构建（`lib/`） |
| `pnpm test` | 全仓测试 |
| `pnpm check` | 上面三步按顺序跑一遍 |

`@deepseek-ai/*` 依赖的版本集中在根 `pnpm-workspace.yaml` 的 `dsh` catalog 里，
升级 harness 只改那一处。
