---
name: veridis-test-scripts
description: Veridis-Rewrite 插件 test/ 目录脚本说明。要量数值、截图、同步装机副本、跑专项审计或对某个 bug 做真浏览器回归时读这份。
whenToUse: 用 test/ 或 test/audit/ 下任一脚本前，先查这里的用途、调用方式与验证标准。
---

# test/ 脚本说明

本目录脚本分两层：**根目录**是每次开发的常用工具（从通用库 `sillytavern-extension-dev/scripts/` 拷贝，靠 `drift-check.mjs` 保持同名一致）；**`audit/` 子目录**是按需的专项审计和功能回归脚本。

通用工具参数、CDP 环境、手机模拟、真输入见 `sillytavern-extension-dev/scripts/SKILL.md` 和 `docs/testing.md`；这里只记本项目调用约定。

## 根目录（常用）

| 脚本 | 用途 | 调用 |
|---|---|---|
| `cdp-eval.mjs` | 页面求值、量几何/配色/状态 | `CDP_PORT=9224 node test/cdp-eval.mjs "@dev/q.js"` |
| `st-shot.mjs` | 截图 | `CDP_PORT=9224 NO_NAV=1 node test/st-shot.mjs dev/s.png "@dev/open.js" 600` |
| `st-input.mjs` | 真输入驱动 | `CDP_PORT=9224 node test/st-input.mjs dev/scene.js` |
| `st-mobile.mjs` | 手机模拟（改 UA，390x844 必须用它） | `CDP_PORT=9224 DEVICE=iphone14 node test/st-mobile.mjs dev/m.png "@dev/open.js"` |
| `mobile-frame.mjs` | 手机外壳，st-mobile 的 FRAME=1 调用 | — |
| `prelude.js` | 查询脚本公共头 | `cat test/prelude.js dev/q.js > dev/run.js` |
| `sync.mjs` | 同步到装机副本（本项目写死源码直连语义） | `node test/sync.mjs <源> <装机副本>` |
| `link-extension.ps1` | 联接源码到酒馆 extensions | `powershell -File test/link-extension.ps1 -Name Veridis-Rewrite -Source <源>` |
| `pre-commit-size.js` | 体积门禁 | `node test/pre-commit-size.js` |

## audit/（按需）

| 脚本 | 用途 |
|---|---|
| `audit/audit.mjs` | 一站式审计调度：`node test/audit/audit.mjs all --strict`；支持 `static/important/layout/align/all` |
| `audit/style-audit.mjs` | 字号/token 静态审计（线索） |
| `audit/important-audit.mjs` | `!important` 数量/分类审计，和 `styles/quality-baseline.json` 对比；`--strict` 只许降，`--update-baseline` 重新记基线 |
| `audit/style-snapshot.mjs` | 双视口 × 双主题 × 五页面的计算样式快照；`--save-baseline` 存摘要基线，`--compare <file> --strict` 验零差异 |
| `audit/layout-audit.mjs` | CDP 裁切/重叠/遮挡启发式（线索，非闸门） |
| `audit/align-audit.mjs` | CDP 控件与文字垂直居中（STRICT 可判错） |
| `audit/dialog-font-audit.mjs` | 弹窗字号层级实测（本项目特有） |
| `audit/verify-diff-menu.mjs` | **功能回归范例**：桌面 + 手机真点 ⋮ 菜单，断言顶栏与菜单镜像严格互斥 |

## 验证标准（硬性）

**"改了"不算数。功能要真能用起来，布局改完要真的看。**

- 功能类：真浏览器把功能从头用一遍，确认结果真的变了；不靠 grep 源码或只看计算样式。
- 布局类：改完看真浏览器截图，不单改完 CSS 就宣称好了。
- 反证：验证结论要能回答"把改动弄坏，这个验证会不会失败？" 不会失败的验证是假验证。
- 每个用户报过的具体 bug，修完沉淀一个 `audit/verify-*.mjs` 真浏览器回归脚本，长期保留。写法的硬性要求见 `sillytavern-extension-dev/scripts/SKILL.md`「功能回归脚本」，`verify-diff-menu.mjs` 是可直接照抄的范例。

## 本项目专属环境

- 调试 Chrome 端口用 `9224`（不是 9222——那是用户日常浏览器，无调试端口）。
- 装机副本：`D:/Games/SillyTavern/SillyTavern/data/default-user/extensions/Veridis-Rewrite`。
- 改样式后要 `node build-css.mjs` → `node build-check.mjs` → `node test/sync.mjs <源> <装机副本>`，否则装机副本还是旧的，浏览器里看不到改动。
- 样式真源是 `styles/` 下的分文件，根目录 `style.css` 是构建产物，别直接改产物。
