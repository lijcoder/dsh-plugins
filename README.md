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
| profile | [`@lijcoder/dsh-im-wecom-profile`](./packages/dsh-im-wecom-profile) | 企微全家桶：一条命令把上面四个装齐 |
| 工具 | [`@lijcoder/dsh-plugin-testkit`](./packages/dsh-plugin-testkit) | 插件测试工具；不是 bundle，只给开发用 |

## 安装

**只要企微这一套**——一条命令：

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

**要混搭多个平台**（企微 + 飞书，或只想要通知不要命令）——单独装：

```sh
dsh plugin --profile web add \
  @lijcoder/dsh-im \
  @lijcoder/dsh-im-wecom \
  @lijcoder/dsh-notify \
  @lijcoder/dsh-im-commands
```

本地 checkout 时把包名换成路径（如 `./packages/dsh-im`），顺序不变。

> ⚠️ **组合包与单装是二选一。** 它们插的是同样的 row id，而 cordis 的 `insert` 是
> 无条件追加、不按 id 去重——同一个包走两条路径装 = 该插件**挂载两次**
> （通知发两遍、企微两条长连接互相踢线）。dsh 自己也是这个规矩
> （`sdk-minimal` 写明 "does not layer over dsh-base"，`inspector` 的本地 overlay
> 与 `inspector-profile` 二选一）。

装完**重启该 profile 的进程**——插件模块代码不参与热重载。

依赖关系上的注意点：

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

组合包与单装**共用同一套变量名**，所以两种装法之间切换不用改环境。
缺凭证只是**对应那行停用**，不会让 profile 起不来。

> ⚠️ 光在自己 profile 的 `cordis.patch.yml` 里手写这些行是**不够的**：bundle 提供的行
> 才会被启动器认；手写的行找不到 bundle 会被直接丢掉，只打一句警告。必须走 `dsh plugin add`。
> 也不要对着正在运行的 profile 跑 `--dump-config`——它会重写该 profile 的 `cordis.yml`。

## 仓库结构

```
packages/
  dsh-im/                   接缝：ImChannel / ImDocument / ctx.im
  dsh-im-wecom/             通道：企微 aibot 长连接 + ImDocument → 企微 markdown
                            （tests/ 里还有跨包端到端用例与 Mock 企微服务端）
  dsh-notify/               功能：完成/授权通知
  dsh-im-commands/          功能：/list、/help
  dsh-im-wecom-profile/     profile 组合包：一条命令装齐上面四个
  dsh-plugin-testkit/       测试工具（真实 Context 挂载、patch 结构解析、dsh 夹具）
```

组合包**不含代码**，运行时内容就是一份 `cordis.patch.yml`（`src/index.ts` 只有 `export {}`），
与 dsh 自己的 `agent-team-profile` 同形。它与单装二选一的原因见上面「安装」。

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
