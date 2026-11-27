# 开发说明

面向改代码的人：环境、构建、闸门、提交与发布。运行形态与模块职责见 [ARCHITECTURE.md](ARCHITECTURE.md)，使用者说明见 [README.md](README.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。

本文档随插件发布；只写构建与闸门的可移植步骤，本机路径、调试端口与 profile 按各自环境处理。

## 环境

- SillyTavern 1.16.0；扩展目录 `data/<handle>/extensions/<folder>`，装的是源码直连副本。
- 无打包器、无 npm 依赖；Node 只用来跑根目录的构建与闸门脚本（`build-css.mjs`、`build-check.mjs`）。
- `src/` 与 `templates/` 必须随扩展安装，不能只装产物。

## 构建

`style.css` 是产物，`styles/` 分文件是唯一真源。改动后按序执行：

```bash
node build-css.mjs     # 拼接压缩 + token 级等价校验 + sourcemap
node build-check.mjs   # 构建闸门，与上一命令独立，必须单独跑
```

`build-css.mjs` 在写产物前做 token 级等价校验：源码与产物 token 序列逐项相同，不一致即报错、不写文件。改 JS 后先做语法检查；跨模块导入名还要静态核对——ESM 漏写 `import` 不会被语法检查发现，只有运行到那条分支才报错。

## 构建闸门

`build-check.mjs` 的机械校验：

- 单文件体积超阈值 fail/warn；`src/` 下 `.js` 还有行数上限；花括号不平衡 fail（少 `}` 会把桌面规则吞进手机 `@media`）。
- `styles/` 下每个 `.css` 必须登记 `ORDER.json`，孤儿 fail；顶层只允许 tokens/base/components/layouts/pages，层级不得倒挂。
- 非 tokens 文件不许重定义刻度名；禁 `@import` / `@charset`；输入框不许透明底；tokens 外不许硬编码颜色。
- `!important` 相对 `styles/quality-baseline.json` 有 5 处预算：`+1~+5` 只记一行 info，`>5` 直接 fail。确需豁免时按 `docs/architecture/style-tokens.md`「!important 例外登记」写明原因并更新基线。
- 弹窗正文挂 `.blai-dialog-body-text`，移动端把普通 `p` 压到 note 档的规则按这个类排除。
- manifest 指向的 js/css 与根 `style.css` 必须存在且非空。

具体阈值以脚本为准，不在此抄数。

## 提交前

`.git/hooks/pre-commit` 调用仓库根目录的 `pre-commit-size.mjs`：暂存文件超过 30KB（约 5000 token）直接拒绝；`vendor/`、`images/`、`shots/`、`style.css`、`*.map`、lockfile 豁免。被拦就按职责拆文件，不压缩空白或改扩展名绕过；拆分方向见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [change-map.md](docs/architecture/change-map.md)。钩子脚本本身不入库，换机器从版本库取回脚本并重设。

## 发布

写入 GitHub（push、推 tag、建仓改名、API 写入、网页上传）需用户对当次版本明确同意；本地 `git add` / `git commit` 不需要。流程：本地完成并验证 → 给出仓库与分支、commit 标题、改动摘要、版本变化与不可逆操作 → 等明确同意 → 推送后校验远端与线上 `manifest.json`。

交付前确认：随包文件清单只含 `manifest.json`、声明的 js/css、被 import 的模块、`README.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` / `CHANGELOG.md`、`docs/architecture/` 专项文档与静态资源；构建脚本、钩子脚本、临时目录、截图、`DESIGN.md`、`AGENTS.md` 不随包。
