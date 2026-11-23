// 样式静态审计：字号分布 / 极值 / 裸值离群 / 双端覆盖 / 裁切隐患信号。
// 用法：node test/audit/style-audit.mjs [--json] [--strict]
//   默认输出人类可读报告；--json 输出结构化结果便于脚本消费。
//   --strict（或 STRICT=1）：发现「确定错误」退出 1。只拦客观坏 declaration，
//   离群字号/裸写 px 在白名单内/未用 token/裁切信号只是线索，永不判错。
// 只读，不改任何样式文件；不启动浏览器，因此检测的是「声明」而非「实际渲染」。
// 真正的裁切/重叠/遮挡请用 test/audit/layout-audit.mjs（CDP 实际量几何）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // 脚本在 test/audit/，项目根上两级
const STYLES = path.join(ROOT, 'styles');
const ORDER = JSON.parse(fs.readFileSync(path.join(STYLES, 'ORDER.json'), 'utf8')).order;
const jsonMode = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict') || process.env.STRICT === '1';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* 从 03-scale.css 取字号 token 白名单。
   token 有两种写法：直接 px（5 档语义 --blai-fs-*）与 var() 别名（旧 --blai-font-N 指向 5 档）。
   先收集直接 px，再解引用别名，得到每个 token 的最终 px。 */
const scaleText = stripComments(fs.readFileSync(path.join(STYLES, 'tokens', '03-scale.css'), 'utf8'));
const tokenMap = new Map();
const aliasMap = new Map();
for (const m of scaleText.matchAll(/(--(?:blai-font|blai-fs)-[\w-]+)\s*:\s*([\d.]+)px/g)) {
    // 不覆盖已存在值：03-scale 末尾的手机 @media 会重定义 5 档，
    // 审计以桌面档值为准（手机档在运行时审计里单独量）。
    if (!tokenMap.has(m[1])) tokenMap.set(m[1], Number(m[2]));
}
for (const m of scaleText.matchAll(/(--(?:blai-font|blai-fs)-[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)) {
    aliasMap.set(m[1], m[2]);
}
const resolvePx = (name, seen = new Set()) => {
    if (tokenMap.has(name)) return tokenMap.get(name);
    if (aliasMap.has(name) && !seen.has(name)) {
        seen.add(name);
        return resolvePx(aliasMap.get(name), seen);
    }
    return null;
};
for (const [name, target] of aliasMap) {
    const px = resolvePx(target);
    if (px != null) tokenMap.set(name, px);
}
const allowedPx = new Set(tokenMap.values());

/* 轻量 CSS 扫描：切出每条声明，带行号与 media 上下文 */
function scanDeclarations(rel) {
    const raw = fs.readFileSync(path.join(STYLES, rel), 'utf8');
    const src = stripComments(raw);
    const out = [];
    let buf = '';
    let line = 1;
    let media = null; // 当前所在的 @media 条件（只记最内层）
    const mediaStack = [];
    let blockStartLine = 1;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\n') line += 1;
        if (c === '{') {
            const head = buf.trim();
            const mm = head.match(/@media[^{]*/);
            if (mm) { mediaStack.push(mm[0].trim()); media = mediaStack.at(-1); }
            else if (!head.startsWith('@')) blockStartLine = line;
            buf = '';
            continue;
        }
        if (c === '}' || c === ';') {
            const text = buf.trim();
            const dm = text.match(/^([\w-]+)\s*:\s*(.+)$/s);
            if (dm && c === ';') {
                out.push({
                    file: rel,
                    line: line - (buf.match(/\n/g)?.length || 0),
                    prop: dm[1],
                    value: dm[2].trim(),
                    media,
                    blockStartLine,
                });
            }
            buf = '';
            if (c === '}') {
                if (mediaStack.length) { mediaStack.pop(); media = mediaStack.at(-1) ?? null; }
            }
            continue;
        }
        buf += c;
    }
    return out;
}

const decls = ORDER.flatMap(scanDeclarations);

/* 1. 字号分布：token 引用与裸值分开统计 */
const fontDecls = decls.filter((d) => d.prop === 'font-size');
const distribution = new Map(); // px -> { count, tokens:Set, files:Set, bare:[] }
const bareFonts = [];

for (const d of fontDecls) {
    const tokenM = d.value.match(/var\(\s*(--blai-font-[\w-]+)\s*\)/);
    let px = null;
    let kind = 'bare';
    if (tokenM) {
        px = tokenMap.get(tokenM[1]) ?? null;
        kind = 'token';
        if (px == null) { bareFonts.push({ ...d, reason: `引用了未定义的 token ${tokenM[1]}` }); continue; }
    } else {
        const numM = d.value.match(/^([\d.]+)px\b/);
        if (numM) px = Number(numM[1]);
        else { // em/rem/%/inherit 等非 px，单列不进分布
            continue;
        }
    }
    if (!distribution.has(px)) distribution.set(px, { count: 0, tokens: new Set(), files: new Set(), samples: [] });
    const e = distribution.get(px);
    e.count += 1;
    e.files.add(d.file);
    if (kind === 'token') e.tokens.add(tokenM[1]);
    else e.bareFonts = (e.bareFonts || 0) + 1;
    if (e.samples.length < 3) e.samples.push(`${d.file}:${d.line}`);
    if (kind === 'bare') {
        const inWhitelist = allowedPx.has(px);
        bareFonts.push({ ...d, px, reason: inWhitelist ? '硬编码 px（白名单内，建议改用 token）' : '硬编码 px 且不在字号白名单' });
    }
}

const rows = [...distribution.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([px, e]) => ({
        px,
        count: e.count,
        tokens: [...e.tokens],
        bare: e.bare || 0,
        files: [...e.files],
        samples: e.samples,
    }));
const pxValues = rows.map((r) => r.px);
const maxPx = pxValues.length ? Math.max(...pxValues) : null;
const minPx = pxValues.length ? Math.min(...pxValues) : null;
const outliers = rows.filter((r) => r.count === 1 && r.tokens.length === 0);

/* 旧数字 token 是语义档位的别名：引用别名即等于引用语义档位。 */
const usedFontTokens = new Set();
for (const d of fontDecls) {
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        let token = m[1];
        const seen = new Set();
        while (token && !seen.has(token)) {
            usedFontTokens.add(token);
            seen.add(token);
            token = aliasMap.get(token) ?? null;
        }
    }
}

/* 2. 双端覆盖：@media 内的 font-size 声明，列出 选择器上一个块 → 覆盖值 */
const mediaFonts = decls.filter((d) => d.prop === 'font-size' && d.media && /max-width|min-width/.test(d.media));
const mediaGroups = new Map();
for (const d of mediaFonts) {
    const key = d.media;
    if (!mediaGroups.has(key)) mediaGroups.set(key, []);
    mediaGroups.get(key).push({ file: d.file, line: d.line, value: d.value, blockStartLine: d.blockStartLine });
}

/* 3. 裁切隐患静态信号 */
const fixedHeightOverflow = decls.filter((d) => d.prop === 'overflow' && /hidden|clip/.test(d.value));
const tightLineHeight = decls.filter((d) => d.prop === 'line-height' && (() => {
    const n = Number(d.value);
    return Number.isFinite(n) && n > 0 && n < 1;
})());
const zeroHeight = decls.filter((d) => (d.prop === 'height' || d.prop === 'min-height') && /^(0|0px)\b/.test(d.value));

/* 4. 汇总 */
const mobileKey = [...mediaGroups.keys()].find((k) => /max-width:\s*600px/.test(k)) || null;
const report = {
    meta: {
        generatedAt: new Date().toISOString(),
        styleFiles: ORDER.length,
        declarations: decls.length,
        fontDeclarations: fontDecls.length,
        note: '静态声明审计；实际渲染请看 layout-audit.mjs',
    },
    fontSize: {
        maxPx,
        minPx,
        span: maxPx != null ? maxPx - minPx : null,
        distinctValues: pxValues.length,
        distribution: rows,
        outliers,
        bareFonts,
        tokenCount: tokenMap.size,
        unusedTokens: [...tokenMap.keys()].filter((t) => !usedFontTokens.has(t)),
    },
    responsive: {
        mediaGroups: [...mediaGroups.entries()].map(([media, items]) => ({ media, count: items.length, items })),
        mobileKey,
    },
    layoutSignals: {
        overflowHiddenCount: fixedHeightOverflow.length,
        overflowHiddenSamples: fixedHeightOverflow.slice(0, 8).map((d) => `${d.file}:${d.line} ${d.value}`),
        tightLineHeight: tightLineHeight.map((d) => `${d.file}:${d.line} line-height:${d.value}`),
        zeroHeight: zeroHeight.map((d) => `${d.file}:${d.line} ${d.prop}:${d.value}`),
    },
};

// 确定错误：引用未定义的字号 token、或硬编码 px 且不在白名单（客观 off-scale，非风格建议）。
// 这两类放回去一定渲染错，适合做闸门；其余统计项只是线索。
const strictErrors = bareFonts.filter((d) => /未定义|不在字号白名单/.test(d.reason));
if (STRICT) {
    console.log(`\nSTRICT=1 闸门：确定错误 ${strictErrors.length} 处（未定义 token / 白名单外硬编码字号）`);
    for (const d of strictErrors.slice(0, 8)) console.log(`  ✗ ${d.file}:${d.line} font-size:${d.value} — ${d.reason}`);
}

if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
} else {
    const bar = (n, max) => '█'.repeat(Math.max(1, Math.round((n / max) * 24)));
    const maxCount = Math.max(1, ...rows.map((r) => r.count));
    console.log('样式静态审计（字号 / 双端 / 裁切信号）');
    console.log('─'.repeat(58));
    console.log(`样式文件 ${ORDER.length} · 声明 ${decls.length} · 字号声明 ${fontDecls.length} · 字号 token ${tokenMap.size}`);
    console.log();
    console.log('字号分布（px ↓，次数）：');
    for (const r of rows) {
        const tag = r.tokens.length ? r.tokens.join(',') : (r.bare ? '裸值' : '?');
        const flag = r.px === maxPx ? ' ← 最大' : r.px === minPx ? ' ← 最小' : '';
        console.log(`  ${String(r.px).padStart(5)}px ${bar(r.count, maxCount).padEnd(24)} ${String(r.count).padStart(3)}  ${tag}${flag}`);
    }
    console.log();
    console.log(`极值：最大 ${maxPx}px / 最小 ${minPx}px / 跨度 ${maxPx - minPx}px / 不同字号 ${pxValues.length} 种`);
    console.log(`离群字号（仅出现 1 次且非 token）：${outliers.length ? outliers.map((r) => r.px + 'px').join(', ') : '无'}`);
    console.log(`裸写字号：${bareFonts.length} 处${bareFonts.length ? ' → ' + bareFonts.slice(0, 5).map((d) => `${d.file}:${d.line}(${d.value})`).join(', ') : ''}`);
    console.log(`未使用的字号 token：${report.fontSize.unusedTokens.length ? report.fontSize.unusedTokens.join(', ') : '无'}`);
    console.log();
    console.log('双端覆盖（@media 内的字号声明）：');
    for (const g of report.responsive.mediaGroups) {
        console.log(`  ${g.media}  → ${g.count} 处`);
        for (const it of g.items.slice(0, 12)) console.log(`      ${it.file}:${it.line}  font-size:${it.value}`);
        if (g.items.length > 12) console.log(`      ... 另 ${g.items.length - 12} 处`);
    }
    if (!report.responsive.mediaGroups.length) console.log('  无');
    console.log();
    console.log('裁切隐患信号（静态，仅提示不判错）：');
    console.log(`  overflow:hidden/clip  ${fixedHeightOverflow.length} 处`);
    console.log(`  line-height < 1       ${report.layoutSignals.tightLineHeight.length} 处${report.layoutSignals.tightLineHeight.length ? ' → ' + report.layoutSignals.tightLineHeight.slice(0, 5).join(', ') : ''}`);
    console.log(`  height:0              ${report.layoutSignals.zeroHeight.length} 处${report.layoutSignals.zeroHeight.length ? ' → ' + report.layoutSignals.zeroHeight.slice(0, 5).join(', ') : ''}`);
    console.log();
    console.log('注：静态只看声明。文字是否真的被裁/重叠/遮挡，需 CDP 实测 → node test/audit/layout-audit.mjs');
}

if (STRICT && strictErrors.length) {
    console.error(`\nSTRICT 失败：${strictErrors.length} 处确定错误，请改用字号 token 或补齐白名单档位。`);
    process.exit(1);
}
