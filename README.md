# dsh-plugins

日常使用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合。

## 包

按「接缝 / 通道 / 功能」三层组织。每个包都是**独立的 dsh bundle**，可以单独装，
也可以一次装齐。加一个即时通讯平台 = 新增一个通道包，功能包一行不改。

| 层 | 包 | 说明 |
| --- | --- | --- |
| 接缝 | [`@lijcoder/dsh-im`](./packages/dsh-im) | 即时通讯通道的命名注册表（`ctx.im`）+ 平台中立的文档模型 |
| 通道 | [`@lijcoder/dsh-im-wecom`](./packages/dsh-im-wecom) | 企业微信智能机器人（aibot）长连接；把中立文档渲染成企微 markdown |
| 功能 | [`@lijcoder/dsh-notify`](./packages/dsh-notify) | 任务完成、或需要用户授权时推送通知 |
| 功能 | [`@lijcoder/dsh-im-commands`](./packages/dsh-im-commands) | 在 IM 里用 `/` 命令查询 dsh 状态（`/list`、`/help`） |
| 工具 | [`@lijcoder/dsh-plugin-testkit`](./packages/dsh-plugin-testkit) | 插件测试工具；不是 bundle，只给开发用 |

## 安装

装齐一套（企微 + 通知 + 命令）——`dsh plugin add` 支持一次传多个包：

```sh
dsh plugin --profile web add \
  @lijcoder/dsh-im \
  @lijcoder/dsh-im-wecom \
  @lijcoder/dsh-notify \
  @lijcoder/dsh-im-commands
```

本地 checkout 时把包名换成路径：

```sh
pnpm --dir <dsh-plugins> build
dsh plugin --profile web add \
  <dsh-plugins>/packages/dsh-im \
  <dsh-plugins>/packages/dsh-im-wecom \
  <dsh-plugins>/packages/dsh-notify \
  <dsh-plugins>/packages/dsh-im-commands
```

装完**重启该 profile 的进程**——插件模块代码不参与热重载。

想只装一部分就少传几个包，但注意依赖关系：

- 通道包与功能包都要 `im` 接缝（没装接缝时它们会一直 **PENDING**，不报错）；
- 命令功能**必须**有可用通道（它在挂载时要订阅消息，订阅不到直接报错）。

所以「接缝 + 至少一个通道 + 想用的功能」是最小可用组合。

### 环境变量

| 变量 | 属于 | 必填 |
| --- | --- | --- |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 企微通道 | 是（缺则该行停用） |
| `DSH_NOTIFY_TARGET` | 通知功能 | 是（缺则该行停用） |
| `DSH_NOTIFY_CHANNEL` | 通知功能 | 装了多个通道时必填 |
| `DSH_IM_CHANNEL` | 命令功能 | 装了多个通道时必填 |

缺凭证只是**对应那行停用**，不会让 profile 起不来。

> ⚠️ 光在自己 profile 的 `cordis.patch.yml` 里手写这些行是**不够的**：bundle 提供的行
> 才会被启动器认；手写的行找不到 bundle 会被直接丢掉，只打一句警告。必须走 `dsh plugin add`。
> 也不要对着正在运行的 profile 跑 `--dump-config`——它会重写该 profile 的 `cordis.yml`。

## 仓库结构

```
packages/
  dsh-im/               接缝：ImChannel / ImDocument / ctx.im
  dsh-im-wecom/         通道：企微 aibot 长连接 + ImDocument → 企微 markdown
                        （tests/ 里还有跨包端到端用例与 Mock 企微服务端）
  dsh-notify/           功能：完成/授权通知
  dsh-im-commands/      功能：/list、/help
  dsh-plugin-testkit/   测试工具（真实 cordis Context 挂载、dsh 领域夹具）
```

为什么没有「组合包」：`dsh plugin add` 只激活**被 add 的那个包**自己的 patch，
既不激活它的 bundle 依赖，meta 包（只有 dependencies、没有 `dsh.bundle`）更是什么都不做；
而两个 bundle 各插同一个 row id 会得到**两行**（插件挂载两次）。
所以「一次装齐」由上面那条多包 `add` 命令承担，而不是一个组合包。

约定见 [AGENTS.md](./AGENTS.md)。

## 开发

需要 Node ≥ 22 与 pnpm。

```sh
pnpm install
pnpm check        # build + typecheck + test
```

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 全仓构建（`lib/`） |
| `pnpm typecheck` | 全仓类型检查（需先 build） |
| `pnpm test` | 全仓测试 |
| `pnpm check` | 上面三步按顺序跑一遍 |

`@deepseek-ai/*` 依赖的版本集中在根 `pnpm-workspace.yaml` 的 `dsh` catalog 里，
升级 harness 只改那一处。
