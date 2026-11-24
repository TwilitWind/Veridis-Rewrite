---
name: veridis-test-scripts
description: Veridis-Rewrite 插件 test/ 目录脚本说明。要量数值、截图、同步装机副本、跑专项审计或对某个 bug 做真浏览器回归时读这份。
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

**公共 harness**：`audit/_harness.mjs` 统一 CDP 连接、求值、等待、可靠重载、截图 sidecar、表单快照/恢复、AI 设置快照/归一化/恢复、源码与装机副本哈希前置。`capture()` 支持 `expectContent: '#blai-home-rule-grid > .blai-home-card'`：面板可见但内容区 0 行时直接失败，避免空 profile 截图当证据。新写或修改 `verify-*.mjs` 时复用它，不再复制 CDP 客户端。harness 发现源码与装机副本不同步会直接失败。`snapshotAiSettings()` / `normalizeAiSettings()` / `restoreAiSettings()` 内部用 `await saveSettings()` 落盘；`saveSettingsDebounced()` 会在审计立即重载时丢写，不要拿来替代。

| 脚本 | 用途 |
|---|---|
| `audit/_harness.mjs` | verify-* 的公共底座；不单独调用 |
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
| `audit/verify-diff-stats-legend.mjs` | 透视来源图例、筛选、定位高亮、撤回/重新净化、手机四字文案；归一化 AI 为程序改写基线，结束恢复原设置，并用 harness `reloadAndWait()` 规避旧 DOM 竞态 |
| `audit/verify-deep-clean.mjs` | 深度净化程序改写链路无未导入引用、勾选后不强制回顶 |
| `audit/verify-regex-caret.mjs` | 查找框语法高亮不叠字；注入 bold 做反证 |
| `audit/verify-followup.mjs` | 大弹窗直属 body、主题对比色、导览锚点、扫描说明 |
| `audit/verify-ui-unify.mjs` | 四项 UI 统一：省略号竖版、顺序淡出淡入（同一时刻只一页参与布局，动画期间几何/transform 恒定）+快速切换竞态与 80/120/140ms 时长断言、分段切换后选中项内联强调色、toast 酒馆原生四色与纯透明度过渡、弹窗底部按钮双端内边距；含人为缩放反证 |

**分层**：静态闸门每次跑（`node build-css.mjs && node build-check.mjs`，后者已含 `check-imports`）；`verify-*.mjs` 只跑本次命中的脚本，全量 8 个只在改 harness / 发版前跑。一次性探针放 `test/tmp/`（已忽略），用完删除，不要新写 `verify-*.mjs` 或加进本表。

## 验证标准（硬性）

**"改了"不算数。功能要真能用起来，布局改完要真的看。**

- 功能类：真浏览器把功能从头用一遍，确认结果真的变了；不靠 grep 源码或只看计算样式。
- 布局类：改完看真浏览器截图，不单改完 CSS 就宣称好了。
- 反证：验证结论要能回答"把改动弄坏，这个验证会不会失败？" 不会失败的验证是假验证。
- 状态隔离：verify-* 改过的表单、真实设置对象和 mock 全局对象必须在同一脚本内恢复；设置对象要用 `await saveSettings()` 落盘，不能只看 DOM 快照。截图统一写 sidecar（视口、目标可见性、控制台错误、被测状态）。
- 每个用户报过的具体 bug，修完沉淀一个 `audit/verify-*.mjs` 真浏览器回归脚本，长期保留。写法的硬性要求见 `sillytavern-extension-dev/scripts/SKILL.md`「功能回归脚本」，`verify-diff-menu.mjs` 是可直接照抄的范例。

## 本项目专属环境

- 调试 Chrome 端口用 `9224`（不是 9222——那是用户日常浏览器，无调试端口）。
- "真浏览器 / 真浏览器回归"= 带 `9224` 调试端口的独立实例，不是用户已开的日常 Chrome；判断就绪只看 `9224/json/version`。验证任务里由 agent 自行按工作区 `docs/testing/testing.md` §2 启动，不等用户、不因用户已开浏览器而停下询问。
- 启动用工具的 `run_in_background: true` 直接受管后台任务，**不尾随 `&`、不套 `exec`**（会被 shell 退出误杀）；整个验证期间保持存活，只在验证全部完成后由 agent 主动停掉该任务。
- 装机副本：`D:/Games/SillyTavern/SillyTavern/data/default-user/extensions/Veridis-Rewrite`。
- 改样式后要 `node build-css.mjs` → `node build-check.mjs` → `node test/sync.mjs <源> <装机副本>`，否则装机副本还是旧的，浏览器里看不到改动。
- 样式真源是 `styles/` 下的分文件，根目录 `style.css` 是构建产物，别直接改产物。
- 探针打开外壳时不要写 `shell.style.display = 'flex'`。`.blai-app-shell` 自身是 grid，强设 flex 会让侧栏竖排拉满、内容区塌到下方，截图像「没显示完」；走真实入口或只清掉 inline `display:none`。
