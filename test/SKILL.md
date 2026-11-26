---
name: veridis-test-scripts
description: Veridis-Rewrite 插件 test/ 目录脚本说明。要量数值、截图、同步装机副本、跑专项审计或对某个 bug 做 9224 端口浏览器回归时读这份。
whenToUse: 用 test/ 或 test/audit/ 下任一脚本前，先查这里的用途、调用方式与验证标准。
---

# test/ 脚本说明

本目录脚本分两层：**根目录**是每次开发的常用工具（从通用库 `sillytavern-extension-dev/scripts/` 拷贝，靠 `drift-check.mjs` 保持同名一致）；**`audit/` 子目录**是按需的专项审计和功能回归脚本。

通用工具参数、CDP 环境、手机模拟、真输入见 `sillytavern-extension-dev/scripts/SKILL.md` 和 `docs/testing/testing.md`；这里只记本项目调用约定。

## 根目录（常用）

| 脚本 | 用途 | 调用 |
|---|---|---|
| `cdp-eval.mjs` | 页面求值、量几何/配色/状态 | `CDP_PORT=9224 node test/cdp-eval.mjs "@dev/q.js"` |
| `st-shot.mjs` | 截图 | `CDP_PORT=9224 NO_NAV=1 node test/st-shot.mjs dev/s.png "@dev/open.js" 600` |
| `st-input.mjs` | 真输入驱动 | `CDP_PORT=9224 node test/st-input.mjs dev/scene.js` |
| `st-mobile.mjs` | 手机模拟（改 UA，390x844 必须用它） | `CDP_PORT=9224 DEVICE=iphone14 node test/st-mobile.mjs dev/m.png "@dev/open.js"` |
| `mobile-frame.mjs` | 手机外壳，st-mobile 的 FRAME=1 调用 | — |
| `prelude.js` | 查询脚本公共头 | `cat test/prelude.js dev/q.js > dev/run.js` |
| `evidence-proof.mjs` | `EXPECT_CONTENT` 的解析/判定真源，与通用库逐字节一致 | `node ../sillytavern-extension-dev/scripts/drift-check.mjs` |
| `sync.mjs` | 同步到装机副本（本项目写死源码直连语义） | `node test/sync.mjs <源> <装机副本>` |
| `link-extension.ps1` | 联接源码到酒馆 extensions | `powershell -File test/link-extension.ps1 -Name Veridis-Rewrite -Source <源>` |
| `pre-commit-size.js` | 体积门禁 | `node test/pre-commit-size.js` |
| `check-imports.mjs` | 漏 import 闸门，已被 `build-check.mjs` 内含调用 | `node test/check-imports.mjs` |

## 空数据态的测试数据

`fixtures/seed-home.js` 造一条最小规则和存档预设，只补缺失数据、不覆盖已有配置，并用 `await saveSettings()` 落盘。截图前这样用：

```bash
CDP_PORT=9224 NO_NAV=1 \
  SEED_JS=@test/fixtures/seed-home.js \
  EXPECT_CONTENT='#blai-home-rule-grid > .blai-home-card:1' \
  node test/st-shot.mjs shots/home.png "@dev/open.js"
```

`EXPECT_CONTENT` 不通过时 `st-shot` / `st-mobile` 退出码 3，截图不落盘；harness 的 `capture(..., { expectContent })` 同样抛错。

## audit/（按需）

**公共 harness**：`audit/_harness.mjs` 统一 CDP 连接、求值、等待、按需刷新、截图 sidecar、表单快照/恢复、AI 设置快照/归一化/恢复、通用工具（`IPHONE_UA`、`forceSaveSettings`）与源码/装机副本哈希前置。`capture()` 支持 `expectContent: '#blai-home-rule-grid > .blai-home-card'`：面板可见但内容区 0 行时直接失败，避免空 profile 截图当证据。所有 `verify-*.mjs` 都已复用它，不再复制 CDP 客户端。harness 发现源码与装机副本不同步会直接失败。`snapshotAiSettings()` / `normalizeAiSettings()` / `restoreAiSettings()` 内部用 `await saveSettings()` 落盘；`saveSettingsDebounced()` 会在审计立即重载时丢写，不要拿来替代。

| 脚本 | 用途 |
|---|---|
| `audit/_harness.mjs` | verify-* 的公共底座；不单独调用 |
| `audit/_diff-fixture.mjs` | diff 弹窗脚本共用的内存种子/还原、程序改写规则快照与临时规则、设置落盘、统一 UA 与打开表达式；不单独调用 |
| `audit/_diff-stats-unit.mjs` | `collectDiffStats` 手改计数口径的纯 Node 单测，被 stats-legend 调用 |
| `audit/audit.mjs` | 一站式审计调度：`node test/audit/audit.mjs all --strict`；支持 `static/important/layout/align/all` |
| `audit/style-audit.mjs` | 字号/token 静态审计（线索） |
| `audit/important-audit.mjs` | `!important` 数量/分类审计，和 `styles/quality-baseline.json` 对比；`--strict` 只许降，`--update-baseline` 重新记基线 |
| `audit/style-snapshot.mjs` | 双视口 × 双主题 × 五页面的计算样式快照；`--save-baseline` 存摘要基线，`--compare <file> --strict` 验零差异 |
| `audit/layout-audit.mjs` | CDP 裁切/重叠/遮挡启发式（线索，非闸门） |
| `audit/align-audit.mjs` | CDP 控件与文字垂直居中（STRICT 可判错） |
| `audit/dialog-font-audit.mjs` | 弹窗字号层级实测（本项目特有） |
| `audit/verify-diff-menu.mjs` | **功能回归范例**：桌面 + 手机真点 ⋮ 菜单，断言顶栏与菜单镜像严格互斥 |
| `audit/verify-ai-mobile.mjs` | 手机排版回归：五档字号、AI 双开关同排且紧跟文字、关闭态圆点靠左/开启态靠右、轨道 32×18、首页规则卡外边距、底栏上下内边距；必须先点入口开主界面再切 AI，否则祖先 `display:none` 会量到全 0 |
| `audit/verify-batch2.mjs` | r80 回归：手机聚焦/悬停边框、手动模型排序与单项清除、portal 下拉 padding/限高/圆角、FA 图标；含破坏 token 的反证，表单和真实 AI 设置双重恢复 |
| `audit/verify-diff-stats-legend.mjs` | 透视来源图例、筛选、定位高亮、撤回/重新净化、手机四字文案；临时装一条程序规则、用真实引擎算 program 后在内存里种子 diff 消息，结束恢复规则/设置/消息，不依赖用户预设或真实聊天数据；顶栏/工具行排版由 typography 守，本脚本不重复断言 |
| `audit/verify-deep-clean.mjs` | 深度净化程序改写链路无未导入引用、勾选后不强制回顶 |
| `audit/verify-deep-clean-worldbook.mjs` | 纯 Node：cleanse-inside 下世界书条目仍命中并改写、程序/AI 两链路一致、聊天消息仍受标签约束；含旧行为 0 命中反证，不需浏览器 |
| `audit/verify-deep-clean-preview.mjs` | 纯 Node：扫描按条目记录命中来源、预览筛选、取消项不进入正式处理并计入「已跳过」、AI 预览缓存仍按「AI 后程序」执行；含 AI 失败反证，不需浏览器 |
| `audit/verify-copy-preview.mjs` | 9224 端口浏览器回归：规则分组/规则文案、完成页分状态、深度清理预览筛选/逐条导航/取消条目/执行所选计数；桌面 + 手机，截图 `shots/verify-copy-preview.png` |
| `audit/verify-deep-clean-reentry.mjs` | 9224 端口手机回归：深度清理首次/二次进入都显示选择界面、加载态有关闭按钮、悬停不加深按钮底色、更新失败给中文说明而非裸 HTTP 500 |
| `audit/verify-deep-clean-back.mjs` | 浏览器回归：真实 `startDeepCleanRun`/`freezeDeepCleanRun` 产出必须带资源清单；预览→返回→再预览/上一步全链路可用、无脚本报错 |
| `audit/verify-deep-clean-revert.mjs` | 纯 Node：改写项撤销按条目/块索引记账、来源列表带聊天消息信息、撤销块的写入结果保留原文 |
| `audit/verify-deep-clean-ui-revert.mjs` | 浏览器回归：预览顶栏严格两行且右缘对齐、扫描分布同排 chip、改写项复选框默认全勾选、撤销面板左下角带来源、手机端仍紧凑不溢出 |
| `audit/verify-deep-clean-diff-flow.mjs` | 浏览器回归：改写 del/ins 随文连续不独占一行、复选框自绘且尺寸走 token、body 浮层滚动条灰色、导航撤销态色点、上一步无箭头、清理按钮文案 |
| `audit/verify-regex-caret.mjs` | 查找框语法高亮不叠字；显式渲染高亮层后量光标偏差，注入 bold 做反证，截图 `shots/verify-regex-caret.png` |
| `audit/verify-diff-typography.mjs` | 净化对比排版：顶栏/工具行成组、提示块分区、正文不粗体、字号三档循环与重载保持；双视口，种子消息与设置结束恢复 |
| `audit/verify-followup.mjs` | 大弹窗直属 body、主题对比色、导览锚点（桌面/手机双视口）、扫描说明；测试前会清掉残留弹窗态，避免命中检测被打到别的弹窗 |
| `audit/verify-ui-unify.mjs` | UI 统一回归：省略号竖版、切页 fade through（当帧唯一 active + 旧页 leaving + 新页 entering、无 transform）+快速切换竞态、弹窗退场与菜单/弹卡 80/120/140ms 时长、分段控制器在粘滞 `:hover` 下仍有强调底色（手机端多选按钮共用此规则）、toast 酒馆原生四色、弹窗底部按钮双端内边距；含人为缩放反证 |
| `audit/verify-motion-placement.mjs` | 纯 Node：转场接线（fade through、弹卡、菜单方向、toast、分段指示块）与导览提示框/居中卡/portal 菜单在手机尺寸下的视口内定位；含旧算法反证，不需浏览器 |
| `audit/verify-recleanse-baseline.mjs` | 显式重新净化的基线规则：无手改时只刷新 programMes、保留 originalMes；有手改时以手改后的正文重建本次对比基线并显示差异；同时校验未命中提示与 reverted 清除。临时装一条确定性规则（不依赖用户预设），活动聊天为空时补临时助手消息，结束还原规则/消息并 reload |
| `audit/verify-manual-diff.mjs` | 手改差异必须可见：单块/两块不连续手改分别计数 1/2 并在正文标出，手改节点不带撤回 ID；截图存 `shots/verify-manual-diff.png`。脚本会应用预设，Node 侧快照规则/预设/AI 开关与消息，finally 恢复并落盘，不得污染用户设置 |
| `audit/verify-wand-menu.mjs` | 魔法棒菜单「词汇映射」与原生条目的类名、图标盒、换行与文字 x 对齐；桌面 / 手机 / 103px 窄菜单三态，守长期不变量 |

**分层**：静态闸门每次跑（`node build-css.mjs && node build-check.mjs`，后者已含 `check-imports`）；`verify-*.mjs` 只跑本次命中的脚本，全量只在改 harness / 发版前跑（清单以本表为准，不记固定数量）。一次性探针放 `test/tmp/probe|crop|data/`（已忽略），用完删除，不要新写 `verify-*.mjs` 或加进本表。

**页面刷新**：harness 的 `ensurePageFresh()` 只在装机副本比页面更新时刷新，没改代码重跑直接复用页面，不要每次 `reloadAndWait`。需要无条件刷新的只有两类：验证「重载后设置保持」这类语义（typography 的持久化检查），或脚本必须干净重载才能拿到确定前置（stats-legend 传 `{ cleanState: true }`）。消息数据由脚本自己在内存里种子并还原，不得依赖前一脚本留下的聊天状态，也不得用 `saveChat()` 写真实聊天；需要规则命中时临时装规则并恢复，不要求用户先启用预设。强制刷新用 `FORCE_RELOAD=1`。调试浏览器 profile 固定在 `LOCALAPPDATA/VeridisDev/st-cdp-profile`，跨任务复用、不要删、不要关。

## 验证标准（硬性）

**"改了"不算数。功能要真能用起来，布局改完要真的看。**

- 功能类：用 9224 端口浏览器把功能从头用一遍，确认结果真的变了；不靠 grep 源码或只看计算样式。
- 布局类：改完看 9224 端口浏览器截图，不单改完 CSS 就宣称好了。
- 反证：验证结论要能回答"把改动弄坏，这个验证会不会失败？" 不会失败的验证是假验证。
- 状态隔离：verify-* 改过的表单、真实设置对象和 mock 全局对象必须在同一脚本内恢复；设置对象要用 `await saveSettings()` 落盘，不能只看 DOM 快照。截图统一写 sidecar（视口、目标可见性、控制台错误、被测状态）。
- 沉淀门槛：只有用户反复报过、或守住长期不变量的检查才写成 `audit/verify-*.mjs` 并长期保留；一次性验证放 `test/tmp/probe|data/`，用完删除。写法的硬性要求见 `sillytavern-extension-dev/scripts/SKILL.md`「功能回归脚本」，`verify-diff-menu.mjs` 是可直接照抄的范例。

## 本项目专属环境

- 调试 Chrome 端口用 `9224`（不是 9222——那是用户日常浏览器，无调试端口）。
- 浏览器验证一律用 `9224` 调试端口的独立实例，措辞统一写「9224 端口浏览器实测 / 9224 端口回归」，**不再写「真浏览器」**。不是用户已开的日常 Chrome；判断就绪只看 `9224/json/version`。验证任务里由 agent 自行按工作区 `docs/testing/testing.md` §2 启动，不等用户；即使用户此前取消过一次启动，只要仍需验证就按文档重启，不能把「没验证」归因于用户取消。
- 启动用工具的 `run_in_background: true` 直接受管后台任务，**不尾随 `&`、不套 `exec`**（会被 shell 退出误杀）；整个验证期间保持存活，验证结束也不关浏览器、不删 profile（用户会看到反复开关）。
- 装机副本：`D:/Games/SillyTavern/SillyTavern/data/default-user/extensions/Veridis-Rewrite`。
- 改样式后要 `node build-css.mjs` → `node build-check.mjs` → `node test/sync.mjs <源> <装机副本>`，否则装机副本还是旧的，浏览器里看不到改动。
- 样式真源是 `styles/` 下的分文件，根目录 `style.css` 是构建产物，别直接改产物。
- 探针打开外壳时不要写 `shell.style.display = 'flex'`。`.blai-app-shell` 自身是 grid，强设 flex 会让侧栏竖排拉满、内容区塌到下方，截图像「没显示完」；走真实入口或只清掉 inline `display:none`。
