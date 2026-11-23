# 本项目协作规则

## 交差前必须做的事

改了用户看得见的行为（界面、交互）时，「我改了 CSS / 写了代码」不算数，必须有真浏览器跑过的证据。

```
做了什么：一句话
测试：<命令> → 通过 N，失败 0
截图：shots/ 下的路径
没验证到的：哪些、为什么；没有就写「无」
```

验证要测「用户看到的结果」，不是「源码里有没有那行字」。判断办法：把改动故意弄坏，验证必须失败；只改内部写法，验证应照样通过。做不到的验证是形式主义。

## 规则表

| 规则 | 由什么拦住 |
|---|---|
| 透视弹窗顶栏与 ⋮ 菜单镜像严格互斥（顶栏有→菜单不重复，顶栏无→菜单必露出） | `CDP_PORT=9224 node test/audit/verify-diff-menu.mjs`（真浏览器，桌面+手机两视口，含反证） |
| 禁止用 `#blai-diff-modal` 祖先选择器控制菜单镜像显隐 | `node build-check.mjs` 第 15 条静态检查 |
| 深度净化程序改写不报 `xxx is not defined`、勾选不回顶 | `CDP_PORT=9224 node test/audit/verify-deep-clean.mjs`（真浏览器，含双向反证） |
| 禁止「调用别处导出却没 import」（`node --check` 查不出，运行才炸） | `node test/check-imports.mjs` / `node build-check.mjs` 第 16 条静态闸门（含反证） |
| 正则查找框高亮时光标贴字右侧、不叠进字形 | `CDP_PORT=9224 node test/audit/verify-regex-caret.mjs`（真浏览器量光标 x−字符右缘，注入 bold 反证） |
| 三弹窗直属 body、直角高亮、主题对比色、扫描结果说明、双端导览锚点 | `CDP_PORT=9224 node test/audit/verify-followup.mjs`（真浏览器 19 项，桌面+手机） |
| 透视弹窗不再残留独立「AI 改写」入口 | `verify-diff-menu.mjs` 的 `aiRewriteGone` 断言（顶栏与菜单镜像都检查） |
| 交差前跑通验证并附截图 | `build-css.mjs` + `build-check.mjs` + `test/audit/verify-*.mjs` + `shots/` |

## 已知陷阱：portal 菜单

`src/ui/popover.js` 的 `openMenuPopover` 会把菜单 `document.body.appendChild(menu)` 挂到 body。
因此任何依赖祖先容器的 CSS 选择器（如 `#blai-diff-modal .blai-diff-menu-action`）在菜单打开后**必然失效**——
菜单已经不在那个祖先里了。这类菜单的显隐要么只用菜单自身选择器，要么由 JS 在打开时按真实状态运行时设置。

曾因此踩坑：桌面 ⋮ 菜单里顶栏四项（撤回所选/撤回净化/AI 改写/全文模式）全部重复出现，
而 grep CSS 的「验证」一路误报通过。现在镜像显隐由 `openDiffActionsMenu` 按顶栏按钮实际可见性设置，
CSS 基线只负责「默认隐藏」，两者配合覆盖桌面/手机与 reverted 等动态状态。
独立「AI 改写」入口已删，镜像项由 4 项减为 3 项；「重新净化」按 AI 开关串接 AI 与程序改写。

## 已知陷阱：主容器内的弹窗

`#blai-purifier-popup` 带 `backdrop-filter`，会生成层叠上下文：内部的 `position:fixed` 相对它定位，
遮罩铺不满视口、弹窗也可能被主界面挡住。所有大弹窗都必须放在模板里 `#blai-purifier-popup`
闭合标签**之后**（运行时整体 append 到 body，即成为 body 直属节点）。
新增弹窗后同步检查 `src/ui/shell.js` 的初始化清理清单，否则重复加载会残留旧节点。

## 已知陷阱：漏导入的 ReferenceError

ES module 里调用别模块导出的函数却忘了 import，`node --check` 与 CSS 构建闸门都查不出，
只有真运行到那条分支才抛 `xxx is not defined`——表现为用户点开界面看到「无法完成」。
已踩坑：`matching-00-compile.js` 漏导入 `collectVariableUpdateRanges`（程序改写必炸）、
`replay-04-migration.js` 漏导入 `cloneJson`、`debugStore.js` 调用未导入的 `refreshMountedDebugDisplay`。
现在 `test/check-imports.mjs` 静态扫全仓（已处理 spread 调用 `...fn(` 的误伤），
并挂到 `build-check.mjs` 第 16 条闸门，构建期就拦下。新增跨模块调用务必确认已 import。

## 已知陷阱：整块重渲染吞掉滚动位置

用 `.html()` 整块重建 DOM 会销毁原滚动容器，scrollTop 归零。
深度净化初始选择勾选复选框就走这条路：渲染前记住 scrollTop、渲染后**同步**设回。
不要用 `requestAnimationFrame` 延迟恢复（回调时机不稳，实测反而丢失）。

## 测试环境

- SillyTavern 在 `http://127.0.0.1:8000/`
- 验证用独立调试浏览器：`CDP_PORT=9224`。全项目统一这个端口，所有脚本默认值与文档都写它。用户日常浏览器占 9222 且无调试端口，不要连。
- 源码在 `E:\Plugin Development\Veridis-Rewrite`；装机副本在
  `D:\Games\SillyTavern\SillyTavern\data\default-user\extensions\Veridis-Rewrite`
- 改完必须跑 `node build-css.mjs` → `node build-check.mjs` →
  `node test/sync.mjs <源> <装机副本>`，否则装机副本与源码不一致。
