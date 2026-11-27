# 词汇映射 · 样式体系

令牌分区、界面令牌落点、反馈页高亮约束与 `!important` 例外登记。构建命令见 [DEVELOPMENT.md](../../DEVELOPMENT.md)，样式文件职责见 [change-map.md](change-map.md)「样式文件职责速查」。

## 五、样式体系

`styles/` 是唯一真源，五层。`styles/ORDER.json` 的 `order` 数组即层叠顺序：同特异性靠先后决胜，**调顺序会改视觉结果**，故顺序写在 JSON 而非脚本；新增分文件只改 ORDER.json。

审计入口、调试与发布流程见 [DEVELOPMENT.md](../../DEVELOPMENT.md)。

| 目录 | 职责 | 约束 |
| --- | --- | --- |
| `tokens/` | 调色板、五套主题、刻度 | 唯一来源，其他文件不许重定义 |
| `base/` | 重置与元素级默认值 | 只放元素级 |
| `components/` | 按钮、输入框、卡片、toast、统一对话框 | 新组件必须建独立文件 |
| `layouts/` | 覆盖层骨架、顶栏、侧栏、底部导航、响应式 | 不含业务页规则 |
| `pages/<page>/` | 单页排版 home/ai/clean/tools/feedback/diff/tour | 只写该页，禁止通用组件样式 |
| `pages/99-mobile.css` | 手机端跨页收尾：标题降档、提交反馈单列化 | 最后加载，压过各页桌面声明；只放 `@media (max-width: 600px)` |

三个令牌文件：`01-palette.css`（状态色、正则高亮 `--re-*`、差异来源色）、`02-themes.css`（auto/light/dark 的 `--bg-*` / `--text-*` / `--border-color` / `--accent-*`）、`03-scale.css`（`--blai-space-*` / `--blai-font-*` / `--blai-radius-*` / `--blai-border-*` / `--blai-size-*` 与语义层）。动效节奏也在 `03-scale.css`：`--blai-duration-fast` 80ms（弹窗淡出/菜单/toast）、`--blai-duration-base` 120ms（弹窗遮罩与通用淡入）、`--blai-duration-slow` 140ms（弹卡/有位移过渡）、`--blai-ease-out`（平滑减速不过冲）；退场比进场更短，JS 兜底定时器与 jQuery 淡入淡出读同一组令牌，改一处全站同步。交互控件的重复几何也收在同一文件：`--blai-focus-offset`（焦点描边间距）、`--blai-ring-inset`（1px 内描边环，颜色由使用处叠加）、`--blai-z-*`（层级阶梯，见 [mechanics.md](mechanics.md)「层级阶梯」）；同类重复值先在 `03-scale.css` 找，别在各页重写字面量。可见滚动条在 `base/00-reset.css` 挂根容器统一设中性灰拇指（`--blai-scrollbar-thumb`），不用强调色；刻意隐藏的不受影响。

令牌挂在一组**容器选择器**而非 `:root`：`#blai-purifier-popup`、`.blai-modal-shell`、`#blai-scope-tag-editor-modal`、`#blai-rule-transfer-modal`、`#blai-diff-modal`、`#blai-rule-search-modal`、`#blai-preset-import-choice-modal`、`.blai-toast`、`#blai-loading-overlay`、`#blai-tour-layer`。弹层与 toast 不在主容器内——增删容器要同步令牌、`theme.js` 的 `data-theme` 列表与 `03-scale.css` 语义层。

### 界面令牌落点

项目偏好与术语见根目录 `DESIGN.md`；本节只记插件令牌与坑。

- 颜色两层：`--bg-base`（画布）→ `--bg-surface`（卡片）。输入控件底色 `--blai-input-bg` 取 `--bg-surface`，靠 1px `--border-color` 表达可输入；跟随酒馆主题时 `--border-color` 取宿主正文色 `--SmartThemeBodyColor` 并混到 20% 不透明度（`color-mix` 混透明），不依赖宿主的 `BorderColor`，亮色与暗色主题都得到同色系低对比描边。结构分隔线另走 `--blai-border-soft`（低对比半透明），不与控件描边共用。滚动条与内容之间由 `--blai-scrollbar-gutter` 预留间距；下拉菜单 `--blai-dropdown-pad` 右侧也叠加该值，避免拇指贴住选项。粗细走 `--blai-scrollbar-size`（桌面 7px / 手机 5px），portal 菜单挂在 body 上，令牌由 `popover.js` 从锚点复制。手机端高亮只保留聚焦/按下/选中态的强调色内描边，触摸模拟触发的 hover 不产生强调色高亮；自绘下拉触发器例外，hover 时仍保留自身的默认描边与底色，避免边框消失。滑动开关轨道与滑块全用 CSS 绘制；开关按钮与同行铅笔 / 竖三点同规格（`32×32`），开启态与同行图标同色，间距走 `--blai-switch-gap`。三条容易踩的坑（宿主 FA 规则盖字号、checked 颜色被页面级规则压住、隐藏 checkbox 热区要与可见按钮同尺寸）与具体写法见 `components/02-controls.css`、`pages/clean/clean-main.css` 的相邻注释。盾牌图标只允许出现在酒馆页注入的人设保护按钮上，面板内的人设开关不得改写其 `<i>`。
- 焦点态用 `box-shadow: inset 0 0 0 1px var(--accent-color) !important`，不占位不抖动；hover 不加描边。禁给输入框写 `transparent`（第三方主题会注入带 `!important` 的底色，闸门会拦）。主题对裸标签有强声明时把 `--ui-color-sec` 重定向到 `--blai-input-bg`，不新增 `!important`；副作用是边框也读该变量，反馈页三个裸标签用同色 inset 补可见边框。`.pages` / `.page-panel` 保持透明让 `--bg-base` 透上来；日间用实色，不用半透明叠灰底（发脏）。
- 图标统一酒馆自带 Font Awesome 6.5.2，格式 `<i class="fas fa-*" aria-hidden="true"></i>`；禁止内联 `<svg>`、CSS 拼三角/对勾、字符箭头。伪元素勾选与下拉箭头用 FA 字形码加 FA 字体；装饰线条/圆点不算图标。类名必须在 FA 6.5.2 存在，`fa-fw` / `fa-solid` / `fa-spin` 是修饰类，不参与校验。
- 字号只用 5 档语义 token（`--blai-fs-*`）；双端档值与禁止整体缩放见根目录 `DESIGN.md`「字号档位」。间距语义层在 `03-scale.css` 第二块：`--blai-canvas-pad`(12)、`--blai-panel-pad`、`--blai-panel-pad-tight`(10)、`--blai-panel-gap`、`--blai-column-gap`、`--blai-head-gap`(8)、`--blai-head-pad`(12)、`--blai-row-pad`(10)、`--blai-feedback-update-gap`（反馈页版本提示与表单之间的唯一间距）。弹窗/对话框里有底色的按钮左右内边距统一走 `--blai-btn-pad-x`(12)，各弹窗不再写 14/15/20/22px 的独立值。页面文件不写裸 `gap: 14px`。
- 视口高度统一走 `--blai-viewport-h`（`100vh` 回退，支持时用 `100svh`），插件外壳与大弹窗不写 `100dvh`：手机软键盘弹出时布局高度不重排，内容被键盘覆盖而非被顶起。弹窗打开时输入框不自动聚焦，避免软键盘意外弹出。键盘期间 `ui/viewportHeight.js` 只给聚焦输入框所在的滚动容器临时补一段底部空间，并把它滚到键盘上沿；弹窗顶栏、底栏和输入框高度不变，键盘收起时撤销。
- 两栏统一 `minmax(0, 5fr) minmax(0, 3fr)`（两端都要 `minmax(0, ...)`）与 `align-items: stretch`，不退回 `start`；断点、`box-shadow`、`grid-template-columns`、`transform` 保留字面量是刻意的。

### 反馈页与高亮的实现约束

反馈页桌面布局高度随内容增长（不用 `minmax(0,1fr)+height:100%` 锁死），否则「涉及区域」展开时详细说明框越过固定 footer 盖住隐私说明浅字；隐私说明设 `min-height` 避免换行跳动。查找区正则高亮态 `color: transparent` 与 token 颜色必须保留强声明（同属性在控件基线规则里仍有 `!important`，加特异性压不住）。

测试区命中高亮的固定做法：overlay 叠在 textarea 之下，命中时只把输入框自身背景 `--blai-input-bg` 置 transparent；**可见文字与光标始终由 textarea 自己渲染**，overlay 的文字（含 `<mark>`）一律 `color: transparent`、`mark` 不加水平 padding，只画匹配底色块。切勿反过来把 textarea 文字转透明、让 overlay 重画整段文字——那样 mark 的 padding 会把重画的字推离原生光标，光标就叠进字形里。overlay 与 textarea 必须有完全相同的边框和内边距（不要一边有边框一边又给 padding 补 1px），否则高亮块整体偏移。命中统计放测试框右上角。

**查找框（`#blai-modal-sub-target`）的语法高亮**与上面的测试区相反：textarea 文字转 `transparent`、**光标由 textarea 保留**（`caret-color`），彩色字由 `.blai-regex-highlight` 覆盖层逐 token 重画。两层字形度量必须逐项一致，否则光标（textarea 画）与字（覆盖层画）错位：`font-size` 同弹窗 13px、`line-height` 同 `.blai-regex-input-wrap .blai-textarea` 的 **1.55**（不是普通 textarea 的 1.5）、`font-weight` 一律 **normal**，各 token **只用颜色区分、禁止加粗**（西文符号如 `\A`、`(?<=` 加粗会与光标叠字）；覆盖层无边框，padding 要把 input 的 1px 边框补进去（`12px+1px / 14px+1px`）。实测时量「光标 x − 前一字符右边缘 x」，并注入 bold 做反证。配对符号与匹配测试区底纹都用直角（`border-radius:0`），圆角会在符号两端和跨行接缝处吃掉底色。

配对高亮的触发时机：只有 `#blai-modal-sub-target` 上真实的 `click/keyup/select` 才调用 `syncRegexBracketPairHighlight()`。打开弹窗 / 切模式 / 改高亮开关 / 输入内容一律走无参 `renderRegexHighlightPreview()`，绝不读 `selectionStart` 去配对——刚 `.val()` 进去光标停在开头符号上（或旧值末尾），会被误判为「光标贴着括号」而自动加底纹。

两个规则弹窗顶栏叉号统一 `.blai-modal-close-x`；其中 `border: 0 !important` 是主题对裸 button 强声明用特异性压不过后的例外，已登记 `styles/quality-baseline.json`。拆分样板见 `styles/pages/` 与各 `components/` 下的 `*-topbar.css` / `*-page.css` / `*-deep.css` / `*-processing.css` / `*-form.css` / `*-regex.css`。

### !important 例外登记

`build-check.mjs` 按「相对基线累计增量」给 5 处预算：`+1~+5` 只在输出里记一行 info，不逐条 warn；超过 5 直接拦截。只有被拦截并确认确实无法用特异性 / token / `@layer` 解决时，才在下表补一行，然后同步更新 `styles/quality-baseline.json` 的预算。

| 文件 | 选择器 / 属性 | 对抗对象 | 不能用 token / 特异性的原因 | 登记日期 |
| --- | --- | --- | --- | --- |
| `styles/pages/home/home-rule-edit-modal.css` | `.blai-modal-close-x { border: 0 !important }` | 主题对裸 `button` 的强声明 | 提高特异性仍压不过；叉号必须无边框 | 2026-11-24 |
| `styles/pages/ai/01-ai.css` | `#blai-ai-model-manage-close, .blai-ai-model-manage-delete { border: none !important; box-shadow: none !important }` | 主题对裸 `button` 的边框/阴影强声明 | 与既有叉号同类，提高特异性仍压不过；管理弹窗两个叉号必须无边框 | 2026-11-24 |

新增条目时写明原因与已排除方案再登记这张表；不要只改 `styles/quality-baseline.json` 绕过闸门。
