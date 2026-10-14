# dsh-plugins

日常使用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合：在即时通讯软件里收 dsh 的通知，并用 `/` 命令查它的状态。

## 包

按「接缝 / 实现 / 功能」三层组织，约定见 [AGENTS.md](./AGENTS.md)。只有组合包能被安装，成员都是纯库。

| 层 | 包 | 说明 |
| --- | --- | --- |
| 接缝 | [`@lijcoder/dsh-im`](./packages/dsh-im) | 即时通讯通道的命名注册表（`ctx.im`）+ 平台中立的文档模型 |
| 实现 | [`@lijcoder/dsh-im-wecom`](./packages/dsh-im-wecom) | 企业微信智能机器人（aibot）长连接；把中立文档渲染成企微 markdown |
| 功能 | [`@lijcoder/dsh-notify`](./packages/dsh-notify) | 任务完成、或需要用户授权时推送通知 |
| 功能 | [`@lijcoder/dsh-im-commands`](./packages/dsh-im-commands) | 在 IM 里用 `/` 命令查询 dsh 状态（`/list`、`/help`） |
| 组合包 | [`@lijcoder/dsh-im-wecom-profile`](./packages/dsh-im-wecom-profile) | 安装入口：企微通道 + 通知 + 命令，一条命令装齐上面四个 |
| 工具 | [`@lijcoder/dsh-plugin-testkit`](./packages/dsh-plugin-testkit) | 插件测试工具；不是插件，只给开发用 |

以后接飞书 = 新增一个 `dsh-im-feishu` 库 + 一个把两个通道一起插进去的组合包，功能包一行不改。加平台的成本落在组合包上，见 [AGENTS.md](./AGENTS.md) 的「安装入口只能是组合包」。

## 安装

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

本地 checkout 把包名换成路径 `./packages/dsh-im-wecom-profile`（先 `pnpm build`）。装完重启该 profile 的进程——插件模块代码不参与热重载。

成员包不能单独装：`dsh plugin add` 一个不带 `dsh.bundle` 的包不激活任何行。原因见 [AGENTS.md](./AGENTS.md) 的「安装入口只能是组合包」。

### 环境变量

| 变量 | 属于 | 必填 |
| --- | --- | --- |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 企微通道 | 是（缺则那几行停用） |
| `IM_NOTIFY_TARGET` | 通知功能 | 是（缺则那几行停用） |

缺凭证只是对应行停用，不会让 profile 起不来。这三个变量也可以写进 `<启动目录>/.env` 或 `$DSH_HOME/.env`。变量名不能以 `DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_` 开头——启动器把它们保留给引导变量，写进 `.env` 会让 dsh 报错退出，不是忽略。

> 光在自己 profile 的 `cordis.patch.yml` 里手写这些行是不够的：只有 bundle 提供的行才被启动器认，手写的行找不到 bundle 会被丢掉，只打一句警告。也不要对着正在运行的 profile 跑 `--dump-config`——它会重写该 profile 的 `cordis.yml`。

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

`@deepseek-ai/*` 依赖的版本集中在根 `pnpm-workspace.yaml` 的 `dsh` catalog 里，升级 harness 只改那一处。
