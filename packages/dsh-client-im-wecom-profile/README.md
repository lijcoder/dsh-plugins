# @lijcoder/dsh-client-im-wecom-profile

## 概要

企微全家桶组合包 [`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile) 的**配置页**：在 DSH Web 的「插件」页打开那个组合包的详情，直接填机器人 ID、Secret、通知目标与三段字节预算——不用再 export 环境变量，也不用去手写 profile 的 `cordis.patch.yml`。

保存写进**当前 profile** 的补丁文件（由 dsh 的配置编辑器完成原子写、revision 栅栏与注释保留）。这六个字段都是 volatile，改完 loader 只就地更新引用、不重挂插件，所以企微通道会按新凭证**当场重连**、新的字节预算下一次发送就生效，不需要重启进程。

## 目录

- [使用](#使用)
- [页面上有什么](#页面上有什么)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

本包是纯库（不带 `dsh.bundle`），不能单独装；装组合包：

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

组合包会把本包插成第五行（`id: im-wecom-config-ui`），页面随之出现在「插件 → `@lijcoder/dsh-im-wecom-profile`」的详情页上，描述与「包含的组件」之间。

## 页面上有什么

| 字段 | 落在哪一行 | 说明 |
| --- | --- | --- |
| 机器人 ID | `im-wecom` | 普通文本框；留空保存 = 清掉覆盖，回落到组合层（例如环境变量） |
| 机器人 Secret | `im-wecom` | 写一次就不回显（值根本不回浏览器），留空保存 = **不修改** |
| 单条消息字节上限 | `im-wecom` | 整条卡片（正文含在内）的 UTF-8 字节兜底，默认 20480 |
| 通知目标 | `notify` | 群聊填 chatid，单聊填 userid |
| 「问题」字节预算 | `notify` | 通知里「问题」段的 UTF-8 字节上限，默认 400 |
| 「回复」字节预算 | `notify` | 通知里「回复」段的 UTF-8 字节上限，默认 2000（约 666 个汉字） |

单位统一是 **UTF-8 字节**（中文一个字约 3 字节）。通知那两段预算决定正文放多少，通道那段是整条消息的兜底，所以**要让正文更长，两段预算与兜底得一起调大**；只调大兜底不会让正文变长，只调大两段预算则可能被兜底再切一刀。企微被动回复（`/list`、`/help`）的平台上限本来就是 20480 字节，调大兜底不会让那些回复变长。

凭证没配齐时表单顶上直说「通道不会建连」——这是唯一需要让人知道的中间状态。Secret 旁边的徽标只回答「配没配」，因为 `role('secret')` 的值从 Host 出来时就被摘掉了。

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

```
浏览器半侧（lib/client.js）
  ctx.configForms.whileServed(['im-wecom', 'notify'], …)
        │
        ├─ ctx.configForms.get('im-wecom') ──┐
        ├─ ctx.configForms.get('notify')  ───┤ SettingsFormModel（暂存草稿，保存才写）
        └─ 设置镜像的 secrets 边车 ───────────┘   └─ 一个保存按钮 → 两次 mutate
                                                     │
Host 半侧（空的 apply，只占一条 Loader 行）           ▼
                        配置编辑器 → profile 的 cordis.patch.yml → loader 更新 volatile 引用
                                                                        → 通道重连
```

### 为什么挂在组合包详情页

dsh 的插件页就是「一个组合包一页」：行的启停、装/卸、配置都在同一页。页面注册进 `plugins.bundle.config`（以**组合包的包名**为 key），是 dsh 给「组合包自己的配置」留的那个位置；产品自带的那几个官方配置页也各占一个伴生包，走的是同一套 slot。

### 为什么必须有一条行

客户端模块系统只把包的浏览器半侧挂在「`name` 恰好是裸包名」的那条 Loader 行上。所以本包有宿主半侧（`src/index.ts`），内容是空的 `apply` —— 它存在的唯一理由是让本包在 profile 里占一行。

页面编辑的是组合包插的那两行的设置 namespace，所以只在 Host 服务其中任一期间注册（`whileServed`）：没装这套组合、或两行都被停用的部署看不到任何痕迹。

### 两个 namespace，一个保存按钮

设置里的写入单位是**一个 profile 条目**：一个 namespace、一个 revision、一次原子写。凭证与整条消息预算属于 `im-wecom`，通知目标与两段正文预算属于 `notify`，两个条目分不开，所以页面按下两个表单分别暂存，保存时依次提交（一边被拒另一边照写，页面会亮失败提示）。

Secret 走「写一次」的那条路：草稿为空时 `SettingsFormModel` 不产出任何写操作，所以留空保存不会把已存的密钥删掉。

### 产物是手搓的构建

dsh 生成客户端 bundle 的 `clientBundle` 预设没随包发布（它只活在 dsh 仓库里，还会 glob 自己的 `packages/*`），所以 [`scripts/build-client.mjs`](scripts/build-client.mjs) 用 esbuild 复刻了这一步，只有三件事但必须逐字一致：登记 `window.__ModuleLoader__.load({id, factory})` 闭包工厂、平台模块表留成 `require()`、其余相对 import 内联。

`lib/client.js` 必须**先构建**再装进 profile：缺它时 dsh 在启动阶段就会报激活失败（不是页面空着）。别在这个包里用 `import()` 拆 chunk——同级 chunk 走同步 `require`，拿不到。

</details>

## 延伸阅读

- 安装路径、五行与覆盖语义：[`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)
- 被编辑的两行：[`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)、[`@lijcoder/dsh-notify`](../dsh-notify)
- 设置与表单的契约（dsh）：`@deepseek-ai/dsh-client-ui-settings` 的 README

## 已知限制与待办

- **只在 loopback 的 Web 上能写**：dsh 的设置在非 loopback 页面是 memory 模式（写不进去），这是设置层的取舍，不是本页面的。
- 一次保存跨两个 namespace，不是原子的：一边被拒时另一边已经写下去了，表单只统一报「没保存成功」。
- 只有 `src/client/page-state.ts` 能在 Node 里单测：其余代码 import 的 `@deepseek-ai/dsh-client-ui-primitives` 是给 Vite 用的静态链接产物（index 里几十个 CSS module 与 katex / shiki 之类的大依赖树），Node 加载不了。字段归属、凭证齐不齐、两个表单怎么合并、字节预算怎么解析这几件事因此都被挪进了那个纯模块（`bytesField` 是那里自己实现的，不用 UI 包的 `settingsNumberField`——它对下界没有要求，而 `truncateUtf8` 的省略号自己占 3 字节，预算 ≤3 时正文会被截得一个字不剩，等于静默把正文发没；页面因此只收 ≥4 的整数，与宿主 schema 的 `.min(4)` 一致）。
- 页面只编辑这六个字段；`scene` / `wsUrl` / 通知标题之类的仍在 `cordis.patch.yml` 里配。
