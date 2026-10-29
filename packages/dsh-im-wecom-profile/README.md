# @lijcoder/dsh-im-wecom-profile

## 概要

企微全家桶：企业微信通道 + 任务完成 / 授权 / 提问通知 + `/` 命令，一条命令装齐 [`dsh-im`](../dsh-im)、[`dsh-im-wecom`](../dsh-im-wecom)、[`dsh-notify`](../dsh-notify)、[`dsh-im-commands`](../dsh-im-commands) 四个包，外加一个**在 DSH Web 的插件页里填凭证与字节预算**的配置页（[`dsh-client-im-wecom-profile`](../dsh-client-im-wecom-profile)）。

这是本仓库唯一的安装入口。它自己不含任何代码：运行时内容就是那份 [`cordis.patch.yml`](cordis.patch.yml)，`src/index.ts` 只有一行 `export {}`（与 dsh 自己的 `agent-team-profile` 同形）。

## 目录

- [使用](#使用)
- [配置](#配置)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

### 装进 profile

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
dsh plugin --profile web remove @lijcoder/dsh-im-wecom-profile
```

本地 checkout 把包名换成 `./packages/dsh-im-wecom-profile`（先 `pnpm build`）。装完重启该 profile 的进程——插件模块代码不参与热重载。

成员包里任何一个单独 `add` 都不生效：`dsh plugin add` 一个不带 `dsh.bundle` 的包只把它作为普通依赖装进 profile，打一句 `declares no dsh.bundle` 的警告，不激活任何行。

### 它插哪五行

| row id | 包 | 作用 |
| --- | --- | --- |
| `im` | `@lijcoder/dsh-im` | 接缝：`ctx.im` 通道注册表 |
| `im-wecom` | `@lijcoder/dsh-im-wecom` | 企微 aibot 长连接 |
| `notify` | `@lijcoder/dsh-notify` | 完成 / 授权 / 提问通知（`channel` 钉成 `wecom`） |
| `im-commands` | `@lijcoder/dsh-im-commands` | `/list`、`/help` |
| `im-wecom-config-ui` | `@lijcoder/dsh-client-im-wecom-profile` | 插件页里的配置表单（浏览器半侧，宿主 `apply` 是空的） |

行序不影响激活顺序（见 [AGENTS.md](../../AGENTS.md) 的「行序不决定激活顺序」）；按「接缝 → 通道 → 功能 → 配置页」排只是读起来清楚。五行一律启用：**缺凭证不再停用整行**——停用的行在设置里根本不存在，用户就没地方把凭证填进去。

### 装完先配凭证

装完重启该 profile 的进程，然后**在 Web 里配**：侧栏「插件 → `@lijcoder/dsh-im-wecom-profile`」，填机器人 ID、Secret、通知目标与三段 UTF-8 字节预算，保存即生效（企微通道会按新凭证当场重连，字节预算下一次发送就生效，都不用重启）——每个字段的含义见[配置页包 README](../dsh-client-im-wecom-profile)。

三段预算里，通知那两段决定正文放多少，通道那段是整条消息的兜底：**要让正文更长，三者得一起调大**（中文一个字约 3 字节）。企微被动回复（`/list`、`/help`）的平台上限本来就是 20480 字节，调大兜底不会让那些回复变长。

没配齐之前插件照常挂载，只是通道保持空闲、通知不发。

### 装完能看到什么

```
## ✅ DSH 任务通知

> **会话**：修复登录超时
> **状态**：成功
> **目录**：`~/work/ai/dsh-plugins`
> **回合**：#3 · 耗时 2m13s · 10-13 15:05
> **Session**：`sess-abc123`

**问题**
帮我把登录超时改大一点

**回复**
已把登录超时从 3s 调到 30s，并补了单测。
```

```
## 🔐 DSH 授权通知
> **会话**：修复登录超时
> **工具**：`write`
> **Session**：`sess-abc123`

**原因**
允许本次操作使用 danger-full-access 权限：要在主目录创建 xxx.md，该路径超出工作区白名单。

DSH 正在等你的授权，请回到会话里处理。
```

```
## ❓ DSH 提问通知
> **会话**：修复登录超时
> **目录**：`~/work/ai/dsh-plugins`
> **Session**：`sess-abc123`

**问题**
先改哪个方案？
选项：
1. A
2. B：更稳

DSH 正在等你的回答，请回到会话里处理。
```

在企微里发 `/list`：

```
## 🖥 DSH 会话（3）· 🏃 2 个运行中

**~/work/ai/dsh-plugins**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| 修复登录超时 | 🏃 运行中 | session-1a4cd73a-… |
| 随手问问 | 💤 空闲 | session-2ffacbca-… |

**~/work/ai/test/chat**

| 会话 | 状态 | sessionId |
| --- | --- | --- |
| Greeting | 🏃 运行中 | session-92bfcaee-… |
```

`/help` 列出所有命令；不是命令的普通聊天不回复；未知命令回一条带 `/help` 的提示。

## 配置

三条路，任选：

1. **配置页（推荐）**：Web 侧栏「插件 → `@lijcoder/dsh-im-wecom-profile`」，见上。
2. **环境变量**：组合层给的默认值，页面里清空某个字段就回落到它。

   ```sh
   export WECOM_BOT_ID=...
   export WECOM_BOT_SECRET=...
   export IM_NOTIFY_TARGET=chatid或userid
   ```

   这些名字也能写进 `<启动目录>/.env` 或 `$DSH_HOME/.env`，两者都会生效。变量名不能以保留前缀（`DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_`）开头，否则会让 dsh 报错退出。

3. **手写 profile 补丁**：想写死凭证或改默认值，在自己 profile 的 `cordis.patch.yml` 里按 id 覆盖。

   ```yaml
   - id: im-wecom
     config:
       botId: 'your-bot-id'
       secret: 'your-bot-secret'
       maxContentBytes: 20480   # 整条消息的 UTF-8 字节兜底
       # wsUrl: 'ws://...'   # 私有化部署
   - id: notify
     config:
       channel: wecom
       target: 'your-chatid'
       maxQuestionBytes: 400    # 「问题」段的 UTF-8 字节预算
       maxOutputBytes: 2000     # 「回复」段的 UTF-8 字节预算
   ```

   补丁整块替换 `config`，覆盖时要写全该行需要的键。要整套关掉，给行写 `disabled: true`。

配置页写的就是第 3 条那份文件：它编辑 `im-wecom` 与 `notify` 两行的设置，保存时由 dsh 的配置编辑器原子写入，注释与其它行都保留。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 只做一件事：往 profile 里插五行。它**不**按环境变量开关行：设置只暴露活着的条目（`describe` 只收 ACTIVE 的 fiber），停用的行连表单都不会出现，所以「缺配置就停用」会让配置页无从下手——那正是这个包要解掉的死结。缺凭证的代价改成「插件挂着、通道空闲」，由插件自己说清楚。

五个成员包是纯库，不带 `dsh.bundle`。理由与代价见 [AGENTS.md](../../AGENTS.md) 的「安装入口只能是组合包」；`tests/patch.test.ts` 把 patch 当结构断言，其中几条是「成员不得带 `dsh.bundle`」「五行都不许有 `disabled` 闸门」「配置页盯着的 namespace 就是这里插的 row id」——这些错了都只有运行时才炸。

</details>

## 延伸阅读

- 仓库取向与包表：[README](../../README.md)
- 接缝契约：[`@lijcoder/dsh-im`](../dsh-im)
- 企微通道的渲染与配置：[`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)
- 插件页里的配置表单：[`@lijcoder/dsh-client-im-wecom-profile`](../dsh-client-im-wecom-profile)
- 跨包端到端用例（四个包挂在同一个 Context 上对 Mock 企微服务端跑）：[`dsh-im-wecom/tests/e2e.test.ts`](../dsh-im-wecom/tests/e2e.test.ts)

## 已知限制与待办

成员包各自的行为细节（触发时机、渲染降级、命令语义）写在它们的 README 里；这里只列装完会碰到的边界：

- 配置页要在 **loopback** 打开的 Web 里才写得进去（dsh 的设置在非 loopback 页面是 memory 模式）；远程访问时仍得靠环境变量或手写补丁。
- 页面一次保存跨两行（`im-wecom` 与 `notify`），两个 namespace 各自原子，并非整体原子。
- 同一个 botId 的长连接只能有一个：企微会把旧连接踢掉。别让第二个进程或第二个 profile 用同一个 `botId`。
- 授权与提问通知只是提醒，不能在企微里批准或作答，得回会话处理。
- 状态只用 emoji 表达、表格能画到什么程度，取决于这条通道的 markdown 子集（见[通道 README](../dsh-im-wecom)）。
- 插件加载前已结束的回合不会补发通知。
- `/list` 只覆盖当前进程内存里的会话：没加载进内存的历史会话、其它进程看不到。
