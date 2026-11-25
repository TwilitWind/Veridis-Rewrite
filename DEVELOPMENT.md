# 开发说明

面向改代码的人：搭建环境、构建、审计、调试、发布。运行形态与模块职责见 [ARCHITECTURE.md](ARCHITECTURE.md)，使用者说明见 [README.md](README.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。

本文档随插件发布，只写可移植的步骤与判定；本机路径、调试端口、profile 位置按各自环境填写，公共配置见工作区 `docs/testing/testing.md`。

## 环境

- SillyTavern 1.16.0，扩展目录 `data/<handle>/extensions/<folder>`，装的是源码直连副本。
- 无打包器、无 npm 依赖；Node 用来跑构建与审计脚本，浏览器刷新后生效（ESM 与 CSS 都走缓存）。
- 源码直连插件的 `src/` 与 `templates/` 必须随扩展安装，装机副本靠 `test/sync.mjs` 同步。

## 构建

`style.css` 是产物，`styles/` 分文件是唯一真源。改动后按序执行：

```bash
node build-css.mjs     # 拼接压缩 + token 级等价校验 + 生成 sourcemap
node build-check.mjs   # 构建闸门，与上一命令独立，必须单独跑
```

`build-css.mjs` 在写产物前做 token 级等价校验：源码与产物 token 序列逐项相同，不一致即报错、不写文件。改 JS 模块后用 `node --check` 的语法副本检查（含 `import` 的原文件按 CommonJS 解析会误报，复制成 `.mjs` 再查）。

## 构建闸门

`build-check.mjs` 的机械校验：

- 单文件超阈值 fail/warn；花括号不平衡 fail（少 `}` 会把桌面规则吞进手机 `@media`，token 校验发现不了）。
- `styles/` 下每个 `.css` 必须登记 `ORDER.json`，孤儿 fail；顶层只允许 tokens/base/components/layouts/pages；层级不得倒挂（tokens→base→components→layouts→pages）。
- 非 tokens 文件不许重定义刻度名；禁 `@import` / `@charset`；输入框不许透明底；tokens 外不许 `#hex`。
- `!important` 相对 `quality-baseline.json` 有 5 处预算：`+1~+5` 只记一行 info，`>5` 直接 fail；超预算时按报错提示先在 `docs/design/design.md`「!important 准入门槛」写原因、在 `ARCHITECTURE.md`「!important 例外登记」登记，再跑 `node test/audit/important-audit.mjs --update-baseline` 重置预算。manifest 指向的 js/css 与根 `style.css` 必须存在且非空；`src/` 下 `.js` 有体积与行数上限。

具体阈值以脚本为准，不在此抄数。

## 审计

改样式后可跑以下入口，按需要选择：

```bash
node test/audit/audit.mjs              # static + layout + align
node test/audit/audit.mjs static       # 零依赖：字号分布/极值/裸值/双端 @media
node test/audit/audit.mjs layout       # CDP：裁切/重叠/遮挡
node test/audit/audit.mjs align        # CDP：控件与同行文本垂直居中
node test/audit/dialog-font-audit.mjs  # 弹窗调用点枚举 + 正文/按钮/输入框字号比例
```

运行时审计要先起独立的调试浏览器实例，用单独的调试端口与 profile，避开日常浏览器；启动参数按本机环境填写，工作区 `docs/testing/testing.md` §2 有可用配置。审计脚本只读：只临时切视口/开弹窗，退出还原。双端几何、配色、状态用 CDP 求值，截图只确认整窗观感。

弹窗正文用共享类 `.blai-dialog-body-text` 标记；移动端把普通 `p` 压到 note 档的规则按这个类排除。新增弹窗正文时挂上这个类。

## 同步到装机副本

```bash
node test/sync.mjs <源> <装机目录>                    # 同步
node test/sync.mjs <源> <装机目录> --prune             # 预览失效文件
node test/sync.mjs <源> <装机目录> --prune --apply     # 执行删除
```

`--prune` 默认只预览；每次 `--apply` 前先跑一次预览核对清单。改动后逐文件比对哈希，确认两端一致。

## 提交前

`.git/hooks/pre-commit` 调用 `test/pre-commit-size.js`，检查本次暂存的 `.js` / `.mjs` / `.css`（无暂存时退回 `src/`）：超过 25KB 警告、达到 30KB 拦截；`vendor/` / `reference/` / 构建产物 / 截图不计入。钩子不入库，换机器重装。拆分方向：脚本按功能/事件/视图分模块，CSS 按分区拆成 `NN-*.css` 再按序合并；禁止压缩空白或改扩展名绕过。

## 发布

每一次写入 GitHub（push、推 tag、建仓改名、API 写入、网页上传）都需用户对当次版本的明确同意；本地 `git add` / `git commit` 不需要。流程：本地完成并验证 → 一条消息给出仓库与分支、commit 标题、改动摘要、版本变化、不可逆操作 → 等明确同意 → 推送后用远端与线上 `manifest.json` 校验。凭据、脚本用法与推后校验见工作区 `docs/github-publish.md`。

交付前确认：随包文件清单只含 `manifest.json`、声明的 js/css、被 import 的模块、四份根目录 md、`docs/architecture/` 专项文档与静态资源；无构建脚本、`test/`、`tmp/`、截图。
