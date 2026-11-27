# 词汇映射 架构说明（开发者）

面向改代码的人：先建立鸟瞰与边界，再按索引进专项文档。本文件只写不常变的东西（运行形态、初始化链、模块分层、边界与不变量）；机制细节、令牌清单与改动落点已下沉到 [docs/architecture/](docs/architecture/)。安装与使用见 [README.md](README.md)，构建与闸门见 [DEVELOPMENT.md](DEVELOPMENT.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。

## 一、运行形态

SillyTavern 扩展，无打包器、无 npm 依赖。`manifest.json` 只声明两个产物：

| 产物 | 来源 | 说明 |
| --- | --- | --- |
| `index.js` | 手写 | ESM 入口，直接 `import` `src/` 模块，源码即产物 |
| `style.css` | `build-css.mjs` 按 `styles/ORDER.json` 拼接压缩 `styles/` 分文件 | 产物勿手改，附 `style.css.map` |

写产物前做 token 级等价校验（源码与产物 token 序列逐项相同），不一致即报错、不写文件。构建闸门与命令见 [DEVELOPMENT.md](DEVELOPMENT.md)。

四条硬约束：

1. `src/` `styles/` `templates/` `vendor/` 必须随扩展安装；只拷两个产物会因模块加载失败不启动。
2. 样式只改 `styles/` 分文件；改完跑 `node build-css.mjs && node build-check.mjs`。
3. 改完刷新酒馆页面：ESM 与 CSS 都走浏览器缓存。
4. 不引入打包器；校验靠 `node --check` 与真机刷新核对。

扩展位置由 `host/extensionIdentity.js` 从 `import.meta.url` 反解（锚点 `/scripts/extensions/`），安装目录可任意改名，代码不写死路径。

```
Veridis-Rewrite/
├── manifest.json           display_name「词汇映射」/ js index.js / css style.css / version 3.5 / loading_order 110
├── index.js                入口：读宿主模块 → 注入 appContext → 依次初始化
├── style.css(.map)         构建产物，勿手改
├── build-css.mjs           拼接压缩 + token 等价校验 + sourcemap
├── build-check.mjs         构建闸门
├── src/                    业务模块
├── styles/                 样式唯一真源：tokens/ base/ components/ layouts/ pages/
├── templates/          工作台 DOM 分片：purifier-shell / -page-* / -modals / -diff / -forms
├── docs/architecture/      本文件的专项文档（模块 / 机制 / 样式 / 落点）
├── images/
└── vendor/                 pinyin-pro、sql.js（本地化）
```

## 二、初始化链

`index.js` 静态导入宿主模块：`extensions.js`、`script.js`（`eventSource`/`event_types`/`chat`/`saveSettingsDebounced`）、`personas.js`、`world-info.js`、`util/stream-fadein.js`。随后：

```
resolveExtensionIdentity(import.meta.url)   → externalId / folderName / templateDirectory
initAppContext({...})                       → 宿主能力槽位表
jQuery(() => { createDefaultSettings → 旧命名空间导入 → legacy 拷贝 → migrateOldData → ensureSettingsShape → boot() })
```

`boot()` 顺序固定，调换会出问题：

1. `waitForTauriTavernReady()`
2. 三个兼容层就绪日志（TauriTavern / 柏宝箱 / LoreFrame）
3. `setupUI(renderExtensionTemplateAsync, templateDirectory)`
4. 自定义全局提示词迁移确认（需要时 `showRiskConfirmModal`）
5. `bindEvents()` → `bindUpdateStatusEvents()`
6. `syncComposerButtonScript()` → `initRealtimeInterceptor()`
7. `updateToolbarUI()` → `applyCharacterPresetBinding(true)` → `performGlobalChatMaintenance()`
8. 异步 `captureVeridisCommit()` + `initializeUpdateStatus()`

启动时机：`event_types.APP_READY`，或 `#send_textarea` 已存在（热重载）。

## 三、模块分层

页面内部统一三层：`model.js` 纯数据与规范化 → `view.js` 只碰 DOM → `events.js` 绑事件、调 model 与 view。运行时状态放各目录 `state.js`（`programRuntimeState`、`rulesUiState`、`aiRewriteState`、`presetsRuntimeState` 等），脏标记（`markRulesUiDirty` 等）触发重渲染。

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 入口 | `index.js`、`src/events.js`、`src/log.js` | 宿主导入、全局初始化、顶栏与路由事件、`logger`（前缀 `[词汇映射]`） |
| 宿主适配 | `src/host/` | 能力槽位、降级读取、扩展身份、生成生命周期、流式处理 |
| 设置 | `src/settings/` | `defaults.js` 默认值全集、`migration.js` 形状补齐与旧版迁移 |
| UI 外壳 | `src/ui/` | 页面路由、主题、导览、统一对话框、浮层定位、人形保护控件 |
| 业务页 | `rules` `scope` `aiRewrite` `presets` `deepClean` `feedback` `zh` `update` | 每目录一套 model / view / events |
| 文本内核 | `rules/engine.js`、`rules/regex.js`、`text/` | 规则编译成处理器、替换、正则、句子切分、变量块剥离 |
| 净化与差异 | `chat/`、`diff/`、`dom/` | 执行净化、写回消息、记录阶段差异、渲染透视 |
| 集成 | `integrations/`、`shujuku/` | TauriTavern / 柏宝箱 / LoreFrame / MVU / TavernHelper、Shujuku 只读联动 |

各目录模块的职责与关键导出见 [modules.md](docs/architecture/modules.md)。

## 四、边界与不变量

从代码里不容易看出的约束，改动时先确认没有越界；展开与例外见 [mechanics.md](docs/architecture/mechanics.md)，样式侧见 [style-tokens.md](docs/architecture/style-tokens.md)。

- **宿主与数据**：宿主能力只走 `host/appContext.js` + `host/context.js` 两层；设置主键 `ultimate_purifier_ai_rewrite` 不随显示名改动。
- **净化与撤回**：`compileProcessors` 不含 AI 规则，先 AI 后程序；撤回只看 `meta` 是否存在，手动编辑后仍可撤回。
- **深度净化**：只处理当前角色卡的世界书与聊天记录，`is_system === true` 不跳过，运行预设由 `frozenRunInput` 冻结。
- **界面与浮层**：五个 page id 与两套导航按钮成对；禁用原生对话框，大弹窗必须是 body 直属；层级只走 `--blai-z-*`，portal 定位只由 `ui/popover.js` 写。
- **动效**：切页待办只在 `ui/shell.js` 的 `pendingPageSwap`，动效只动 transform / opacity，不改定位元素的 transform，不做横向 push / pop。

## 五、专项文档

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [modules.md](docs/architecture/modules.md) | 各目录模块职责、关键导出：入口与宿主、UI 外壳、文本内核、AI 改写、净化差异、其余 | 想知道"某功能由哪个模块实现" |
| [mechanics.md](docs/architecture/mechanics.md) | 净化管道、撤回、深度净化范围、差异记录、页面导航、弹窗浮层、命名空间、存储键 | 要改机制或查运行约束 |
| [style-tokens.md](docs/architecture/style-tokens.md) | 令牌分区、界面令牌落点、反馈页高亮、`!important` 例外登记 | 要改样式或令牌 |
| [change-map.md](docs/architecture/change-map.md) | "想改什么 → 改哪里"速查表、样式文件职责速查 | 动手前定位改动落点 |

专项文档同样随插件发布；新增内容按上表归位，不要堆回本文件。本文件超过 150 行或细节喧宾夺主时继续下沉到专项文档。
