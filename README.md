# dsh-plugins

日常使用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合。

## 包

按「接缝 / 通道 / 功能」三层组织。**只有 profile 组合包能装**——四个成员包是纯库，
各自不带 `dsh.bundle`，单独 `add` 只会作为普通依赖躺进 profile 而不激活任何行。
加一个平台 = 加一个通道库 + 一个新的组合包，功能包一行不改。

| 层 | 包 | 说明 |
| --- | --- | --- |
| 接缝 | [`@lijcoder/dsh-im`](./packages/dsh-im) | 即时通讯通道的命名注册表（`ctx.im`）+ 平台中立的文档模型 |
| 通道 | [`@lijcoder/dsh-im-wecom`](./packages/dsh-im-wecom) | 企业微信智能机器人（aibot）长连接；把中立文档渲染成企微 markdown |
| 功能 | [`@lijcoder/dsh-notify`](./packages/dsh-notify) | 任务完成、或需要用户授权时推送通知 |
| 功能 | [`@lijcoder/dsh-im-commands`](./packages/dsh-im-commands) | 在 IM 里用 `/` 命令查询 dsh 状态（`/list`、`/help`） |
| profile | [`@lijcoder/dsh-im-wecom-profile`](./packages/dsh-im-wecom-profile) | **安装入口**：企微全家桶，一条命令装齐上面四个 |
| 工具 | [`@lijcoder/dsh-plugin-testkit`](./packages/dsh-plugin-testkit) | 插件测试工具；不是插件，只给开发用 |

## 安装

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

本地 checkout 时把包名换成路径：`dsh plugin --profile web add ./packages/dsh-im-wecom-profile`
（先 `pnpm build`）。

装完**重启该 profile 的进程**——插件模块代码不参与热重载。

### 为什么不提供「只装一部分」

组合包插的是四个固定 row id。如果成员包各自也带 patch，那么「组合包 + 成员」同时装就会
让同一个 id 被插两次——cordis 的 `insert` 是无条件追加、不按 id 去重，结果是插件
**挂载两次**（通知发两遍、企微两条长连接互相踢线）。让成员保持纯库，这个组合就不存在。

代价是「一套配置」的粒度落在组合包上：以后接飞书，就是新增 `dsh-im-feishu` 库 +
一个「企微 + 飞书」的组合包。详见[组合包 README](./packages/dsh-im-wecom-profile)。

### 环境变量

| 变量 | 属于 | 必填 |
| --- | --- | --- |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 企微通道 | 是（缺则该行停用） |
| `IM_NOTIFY_TARGET` | 通知功能 | 是（缺则该行停用） |

缺凭证只是**对应行停用**，不会让 profile 起不来。这三个变量也可以写进
`<启动目录>/.env` 或 `$DSH_HOME/.env`。

> ⚠️ 变量名不能以 `DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_` 开头——启动器把这些前缀
> 保留给引导变量，写进 `.env` 会让 dsh **直接报错退出**（不是忽略）。
> 组合包的 patch 测试会守住这条。

> ⚠️ 光在自己 profile 的 `cordis.patch.yml` 里手写这些行是**不够的**：bundle 提供的行
> 才会被启动器认；手写的行找不到 bundle 会被直接丢掉，只打一句警告。必须走 `dsh plugin add`。
> 也不要对着正在运行的 profile 跑 `--dump-config`——它会重写该 profile 的 `cordis.yml`。

## 仓库结构

```
packages/
  dsh-im/                   接缝：ImChannel / ImDocument / ctx.im        （纯库）
  dsh-im-wecom/             通道：企微 aibot 长连接 + ImDocument → markdown（纯库）
                            （tests/ 里还有跨包端到端用例与 Mock 企微服务端）
  dsh-notify/               功能：完成/授权通知                          （纯库）
  dsh-im-commands/          功能：/list、/help                          （纯库）
  dsh-im-wecom-profile/     安装入口：唯一的 bundle，插四行
  dsh-plugin-testkit/       测试工具（真实 Context 挂载、patch 结构解析、dsh 夹具）
```

组合包**不含代码**，运行时内容就是一份 `cordis.patch.yml`（`src/index.ts` 只有 `export {}`），
与 dsh 自己的 `agent-team-profile` 同形；成员是纯库的原因见上面「安装」。

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
