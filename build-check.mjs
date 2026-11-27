import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 构建闸门：样式架构规范的机械校验。
 * 跑法：node build-check.mjs（与 build-css.mjs 相互独立，必须单独跑一次）
 * 任何一条不过就以非零码退出，构建视为失败。
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STYLES = path.join(ROOT, 'styles');
const MAX_BYTES = 30 * 1024;
const TARGET_BYTES = 25 * 1024;
const IMPORTANT_BUDGET = 5;

const errors = [];
const warns = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);

const ORDER = JSON.parse(fs.readFileSync(path.join(STYLES, 'ORDER.json'), 'utf8')).order;

/* 1. ORDER.json 里的文件必须都存在 */
for (const rel of ORDER) {
  if (!fs.existsSync(path.join(STYLES, rel))) fail(`ORDER.json 引用了不存在的文件：styles/${rel}`);
}

/* 2. styles/ 下所有 .css 都必须登记在 ORDER.json（否则是孤儿，永远不会被合并） */
const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.css')) out.push(path.relative(STYLES, p).split(path.sep).join('/'));
  }
  return out;
};
const allFiles = walk(STYLES);
const registered = new Set(ORDER);
for (const rel of allFiles) {
  if (!registered.has(rel)) fail(`styles/${rel} 没有登记在 ORDER.json，不会被合并进 style.css`);
}

/* 3. 体积阈值：25KB 起警告，30KB 直接拦截，提示按职责拆分 */
for (const rel of allFiles) {
  const size = fs.statSync(path.join(STYLES, rel)).size;
  if (size > MAX_BYTES) fail(`styles/${rel} 有 ${size} 字节，超过 30KB 红线，请按职责拆分`);
  else if (size > TARGET_BYTES) warn(`styles/${rel} 有 ${size} 字节，超过 25KB 警告线，建议按职责拆分`);
}

/* 4. 目录职责：只允许 tokens / base / components / layouts / pages 五类 */
const ALLOWED_DIRS = ['tokens', 'base', 'components', 'layouts', 'pages'];
for (const rel of allFiles) {
  const top = rel.split('/')[0];
  if (!ALLOWED_DIRS.includes(top)) fail(`styles/${rel} 不在允许的目录下（只允许 ${ALLOWED_DIRS.join(' / ')}）`);
}

/* 5. 合并顺序：tokens 必须全部排在 base 之前，base 排在其他之前 */
const rank = (rel) => {
  const top = rel.split('/')[0];
  return { tokens: 0, base: 1, components: 2, layouts: 3, pages: 4 }[top] ?? 5;
};
let lastRank = -1;
for (const rel of ORDER) {
  const r = rank(rel);
  if (r < lastRank) fail(`ORDER.json 顺序错误：${rel} 排在了更靠后层级的文件之后`);
  lastRank = Math.max(lastRank, r);
}

/* 6. 令牌唯一来源：组件 / 布局 / 页面里禁止定义新的全局变量，只能 tokens/ 定义 */
const tokenDef = /^\s{0,4}(--[a-zA-Z0-9-]+)\s*:/gm;
for (const rel of allFiles) {
  if (rel.startsWith('tokens/')) continue;
  const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
  const defs = [...text.matchAll(tokenDef)].map((m) => m[1]);
  // 允许组件在本作用域内定义私有变量（以组件自身选择器开头的块），但禁止重定义 scales 里的公共刻度
  const scale = fs.readFileSync(path.join(STYLES, 'tokens', '03-scale.css'), 'utf8');
  for (const name of defs) {
    if (new RegExp(`\\s${name}\\s*:`).test(scale)) fail(`styles/${rel} 重定义了全局刻度 ${name}，刻度只能在 tokens/03-scale.css 定义`);
  }
}

/* 7. 花括号必须平衡（少一个 } 会把后续桌面规则吞进手机 @media，token 校验发现不了） */
for (const rel of allFiles) {
  const raw = fs.readFileSync(path.join(STYLES, rel), 'utf8');
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  let depth = 0;
  let line = 1;
  let openedAt = 0;
  for (const c of text) {
    if (c === '\n') { line += 1; continue; }
    if (c === '{') { if (depth === 0) openedAt = line; depth += 1; }
    else if (c === '}') {
      depth -= 1;
      if (depth < 0) { fail(`styles/${rel} 第 ${line} 行有多余的 }`); depth = 0; }
    }
  }
  if (depth > 0) fail(`styles/${rel} 从第 ${openedAt} 行起有 ${depth} 个 { 没有闭合`);
}

/* 8. 禁止 @import 与 @charset（合并单元必须自包含） */
for (const rel of allFiles) {
  const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
  if (/@import\b/.test(text)) fail(`styles/${rel} 里有 @import，合并单元必须自包含`);
  if (/@charset\b/.test(text)) fail(`styles/${rel} 里有 @charset`);
}

/* 9. 输入框底色不许透明（第三方主题会注入带 !important 的底色） */
for (const rel of allFiles) {
  const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
  const re = /(?:^|[;{\s])(?:background|background-color)\s*:\s*transparent\s*(?:!important)?\s*(?=;|})/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    const sel = before.split('}').pop().split('{')[0] || '';
    if (/\binput\b|\btextarea\b|\bselect\b|\.field\b|\bblai-select/.test(sel)) {
      fail(`styles/${rel} 里输入框用了透明底色：${sel.trim().slice(-70)}`);
    }
  }
}

/* 10. 硬编码颜色不许出现在 tokens/ 之外 */
for (const rel of allFiles) {
  if (rel.startsWith('tokens/')) continue;
  const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
  const hits = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  if (hits.length) fail(`styles/${rel} 里有硬编码颜色 ${[...new Set(hits)].join(' ')}，应改用 var(--token)`);
}

/* 11. !important 增量预算：累计 +1~+5 只记账不吵，超过 +5 才拦截并要求登记豁免。
   基线结构是 { note, base: { 路径: {hex, px, important} } }。早期版本直接读 baseline[rel]，
   取到 undefined 后退化成 0，于是每个文件都被判成「从 0 涨上来」。 */
const baselinePath = path.join(STYLES, 'quality-baseline.json');
if (fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const baseMap = baseline.base ?? baseline;
  const drift = [];
  for (const rel of allFiles) {
    const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
    // 注释里解释「为什么需要 !important」不算一次使用，和 important-audit.mjs 口径保持一致。
    const declarations = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const now = (declarations.match(/!important/g) || []).length;
    const was = baseMap[rel]?.important ?? 0;
    if (now > was) drift.push({ rel, was, now, delta: now - was });
  }
  const totalDrift = drift.reduce((sum, row) => sum + row.delta, 0);
  if (totalDrift > IMPORTANT_BUDGET) {
    const rows = drift.map((row) => `  - styles/${row.rel}: ${row.was} → ${row.now}（+${row.delta}）`).join('\n');
    fail(`!important 相对基线累计 +${totalDrift}，超过 ${IMPORTANT_BUDGET} 处未登记预算：\n${rows}\n`
      + '  处理顺序：\n'
      + '  1) 按工作区 docs/design/design.md §CSS 编写规则「!important 准入门槛」写明原因和已排除的替代方案；\n'
      + '  2) 在 docs/architecture/style-tokens.md「!important 例外登记」补文件、选择器/属性、对抗对象；\n'
      + '  3) 更新该文档的基线登记后，再跑 node build-check.mjs');
  } else if (totalDrift > 0) {
    console.log(`  [info] !important 未登记增量 +${totalDrift}（预算 ${IMPORTANT_BUDGET}）：`
      + drift.map((row) => `${row.rel} +${row.delta}`).join('、'));
  }
}

/* 12. manifest.json 指向的 js / css 必须存在 */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
for (const key of ['js', 'css']) {
  if (manifest[key] && !fs.existsSync(path.join(ROOT, manifest[key]))) fail(`manifest.json 指向的 ${key} 不存在：${manifest[key]}`);
}

/* 13. 根 style.css 必须存在且非空 */
const produced = path.join(ROOT, 'style.css');
if (!fs.existsSync(produced)) fail('根目录 style.css 不存在，先跑 node build-css.mjs');
else if (fs.statSync(produced).size < 1000) fail('根目录 style.css 小得不像话，构建可能中途失败');

/* 14. 源码体积阈值：src 下的 .js 25KB 起警告、30KB 直接拦截，防止巨型文件 */
const JS_MAX_BYTES = 30 * 1024;
const JS_TARGET_BYTES = 25 * 1024;
const JS_MAX_LINES = 600;
const walkJs = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
};
const srcDir = path.join(ROOT, 'src');
if (fs.existsSync(srcDir)) {
  for (const file of walkJs(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const bytes = Buffer.byteLength(text);
    const lines = text.split('\n').length;
    const rel = 'src/' + path.relative(srcDir, file).split(path.sep).join('/');
    if (bytes > JS_MAX_BYTES) fail(`${rel} 有 ${bytes} 字节，超过 30KB 红线，请按职责拆分`);
    else if (bytes > JS_TARGET_BYTES) warn(`${rel} 有 ${bytes} 字节，超过 25KB 警告线，建议按职责拆分`);
    if (lines > JS_MAX_LINES) fail(`${rel} 有 ${lines} 行，超过 600 行，请按职责拆分`);
  }
}

/* 15. portal 菜单的显隐禁止用 #blai-diff-modal 祖先选择器（打开后菜单被挂到 body，祖先选择器必失效）。
   这条拦的是真实踩过的坑：曾写 #blai-diff-modal .blai-diff-menu-action{display:none}，
   结果桌面 ⋮ 菜单里顶栏四项全部重复。菜单镜像显隐一律由 openDiffActionsMenu 运行时按顶栏可见性处理。 */
for (const rel of allFiles) {
    const text = fs.readFileSync(path.join(STYLES, rel), 'utf8');
    // 匹配同一选择器里同时含 modal id 与菜单镜像类的规则。
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!stripped || stripped.startsWith('/*')) return;
        // 只看选择器片段（到第一个 { 为止）
        const sel = stripped.slice(0, stripped.indexOf('{') === -1 ? stripped.length : stripped.indexOf('{'));
        if (sel.includes('#blai-diff-modal')
            && (sel.includes('.blai-diff-menu-action') || sel.includes('.blai-diff-menu-divider'))) {
            fail(`styles/${rel}:${i + 1} 用 #blai-diff-modal 祖先控制 ⋮ 菜单镜像显隐，portal 到 body 后会失效；`
                + '改由 openDiffActionsMenu 按顶栏可见性运行时设置');
        }
    });
}

/* 16. 字号字重：正文一律整数 px、字重只用 400/600（Font Awesome 图标的 900 例外）。
   真实踩坑：小数 px 与 700 字重被反复引入，靠人工提醒不如机械拦截。 */
for (const rel of allFiles) {
    const lines = fs.readFileSync(path.join(STYLES, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
        const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!stripped || stripped.startsWith('/*')) return;
        const decimalPx = stripped.match(/font-size:\s*[+-]?\d+\.\d+px\b/i);
        if (decimalPx) fail(`styles/${rel}:${i + 1} 的 ${decimalPx[0]} 用了小数 px，改成整数 px`);
        const badWeight = stripped.match(/font-weight:\s*(?:100|200|300|500|700|800|bold|bolder)\b/i);
        if (badWeight) fail(`styles/${rel}:${i + 1} 的 ${badWeight[0]} 不符合字重约束，只用 400/600（var(--blai-weight-normal/bold)）`);
    });
}

/* 输出 */
for (const w of warns) console.warn('  [warn] ' + w);
if (errors.length) {
  console.error('\n构建闸门未通过，共 ' + errors.length + ' 项：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`构建闸门通过：${allFiles.length} 个样式文件、${ORDER.length} 条合并项，最大 ${Math.max(...allFiles.map((r) => fs.statSync(path.join(STYLES, r)).size))} 字节`);
