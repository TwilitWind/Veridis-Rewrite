# 本项目协作规则

## 交差前

改了用户看得见的行为（界面、交互）时，源码改动不算证据。汇报格式：

```text
做了什么：一句话
测试：<命令> → 通过 N，失败 0
截图：shots/ 下的路径
没验证到的：哪些、为什么；没有就写「无」
```

验证测「用户看到的结果」。把改动弄坏，验证必须失败；只改内部写法，验证应照样通过。做不到的验证是形式主义。

## 规则表

| 规则 | 由什么拦住 |
|---|---|
| 透视弹窗顶栏与 ⋮ 菜单镜像严格互斥 | `CDP_PORT=9224 node test/audit/verify-diff-menu.mjs`（桌面 + 手机，含反证） |
| 禁止用 `#blai-diff-modal` 祖先选择器控制菜单镜像显隐 | `node build-check.mjs` 静态检查 |
| 深度净化程序改写不报错、勾选不回顶 | `CDP_PORT=9224 node test/audit/verify-deep-clean.mjs`（含反证） |
| 禁止调用未 import 的导出 | `node test/check-imports.mjs` / `node build-check.mjs` 静态闸门 |
| 正则查找框高亮不叠字 | `CDP_PORT=9224 node test/audit/verify-regex-caret.mjs`（量光标 x−字符右缘） |
| 三弹窗直属 body、主题对比色、扫描说明、双端导览锚点 | `CDP_PORT=9224 node test/audit/verify-followup.mjs` |
| 透视来源图例、筛选折叠、定位高亮单线、浅字说明、手机四字文案 | `CDP_PORT=9224 node test/audit/verify-diff-stats-legend.mjs`（桌面 + 手机） |
| 交差前跑通验证并附截图 | `build-css.mjs` + `build-check.mjs` + `test/audit/verify-*.mjs` + `shots/` |

## 已知陷阱：portal 菜单

`openMenuPopover` 把菜单挂到 `document.body`。依赖祖先容器的 CSS（如 `#blai-diff-modal .blai-diff-menu-action`）在菜单打开后失效。菜单显隐只用菜单自身选择器，或由 JS 在打开时按真实状态设置。镜像显隐由 `openDiffActionsMenu` 按顶栏按钮可见性设置，CSS 基线只负责默认隐藏。

## 已知陷阱：主容器内的弹窗

`#blai-purifier-popup` 带 `backdrop-filter`，会生成层叠上下文；内部 `position:fixed` 相对它定位，遮罩和弹窗会被挡住。大弹窗必须在模板里放在 `#blai-purifier-popup` 闭合标签之后，运行时成为 body 直属节点。新增弹窗后检查 `src/ui/shell.js` 的初始化清理清单。

## 已知陷阱：漏导入的 ReferenceError

ES module 漏 import 不会被 `node --check` 或 CSS 构建闸门发现，只有运行到分支才报 `xxx is not defined`。`test/check-imports.mjs` 已挂到 `build-check.mjs`，新增跨模块调用必须确认已 import。

## 已知陷阱：整块重渲染吞掉滚动位置

`.html()` 整块重建 DOM 会销毁滚动容器，scrollTop 归零。深度净化勾选后渲染前记住 scrollTop，渲染后同步设回；不要 `requestAnimationFrame` 延迟恢复。

## 测试环境

- SillyTavern：`http://127.0.0.1:8000/`
- CDP：`CDP_PORT=9224`，端口约定与启动见工作区 `AGENTS.md` 和 `docs/testing.md` §2。
- 源码：`E:\Plugin Development\Veridis-Rewrite`
- 装机副本：`D:\Games\SillyTavern\SillyTavern\data\default-user\extensions\Veridis-Rewrite`
- 改完跑：`node build-css.mjs` → `node build-check.mjs` → `node test/sync.mjs <源> <装机副本>`。
