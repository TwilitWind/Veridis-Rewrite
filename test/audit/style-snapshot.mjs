// 计算样式快照：双视口 × 双主题 × 五页面，抓取每个页面面板及其全部后代的计算样式。
// 用途：减少 !important / 调整选择器特异性时，证明「前后计算样式零差异」。
// 用法：
//   node test/audit/style-snapshot.mjs [--out tmp/style-snapshot.json]
//   node test/audit/style-snapshot.mjs --save-baseline test/audit/fixtures/style-baseline.json
//   node test/audit/style-snapshot.mjs --compare test/audit/fixtures/style-baseline.json [--strict]
// 前置：SillyTavern 在 127.0.0.1:8000，调试 Chrome 在 CDP_PORT（默认 9224）。
// 只读：临时切视口/主题/页面并还原，不改源码。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PORT = process.env.CDP_PORT ?? '9224';
const args = process.argv.slice(2);
const valueOf = (flag, fallback = null) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : (args[i + 1] || fallback);
};
const OUT = valueOf('--out', 'tmp/style-snapshot.json');
const SAVE_BASELINE = valueOf('--save-baseline');
const COMPARE = valueOf('--compare');
const STRICT = args.includes('--strict') || process.env.STRICT === '1';

// 68 项稳定计算属性：覆盖布局、盒模型、边框、背景、文字、弹性/网格、阴影与交互态。
const PROPS = [
    'display', 'visibility', 'opacity', 'position', 'zIndex', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'boxSizing',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight',
    'lineHeight', 'letterSpacing', 'textAlign', 'textOverflow', 'whiteSpace', 'overflowX', 'overflowY',
    'gap', 'rowGap', 'columnGap', 'alignItems', 'justifyContent', 'flexDirection',
    'gridTemplateColumns', 'boxShadow', 'outlineStyle', 'outlineColor',
    'transform', 'filter', 'cursor', 'pointerEvents',
];
const PSEUDO_PROPS = ['content', 'fontFamily', 'fontSize', 'color', 'backgroundColor', 'width', 'height', 'borderColor'];

const VIEWPORTS = [
    { name: 'desktop', width: 1353, height: 858 },
    { name: 'mobile', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];
const PAGES = ['overview', 'ai', 'clean', 'tools', 'feedback'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CAPTURE = function (props, pseudoProps, theme, page) {
    const keyOf = (el) => {
        const parts = [];
        for (let node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
            const parent = node.parentElement;
            const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
            const cls = typeof node.className === 'string'
                ? node.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
            parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls ? `.${cls}` : ''}[${index}]`);
        }
        return parts.join(' > ');
    };
    const pick = (style, names) => Object.fromEntries(names.map((name) => [name, style[name] ?? '']));
    const panel = document.querySelector(`#blai-purifier-popup .page-panel[data-page="${page}"]`);
    if (!panel) return { theme, page, elements: {}, error: 'page-panel not found' };
    const elements = {};
    const nodes = [panel, ...panel.querySelectorAll('*')];
    for (const el of nodes) {
        const style = getComputedStyle(el);
        const key = keyOf(el);
        const entry = { tag: el.tagName.toLowerCase(), props: pick(style, props), pseudo: {} };
        for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content && ps.content !== 'none' && ps.content !== 'normal') {
                entry.pseudo[pseudo] = pick(ps, pseudoProps);
            }
        }
        elements[key] = entry;
    }
    return { theme, page, elementCount: Object.keys(elements).length, elements };
};

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pageTarget = list.find((target) => target.type === 'page');
if (!pageTarget) throw new Error('没有可用的 page target');
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
});
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text + ' :: ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.clearDeviceMetricsOverride');

const originalThemes = await evaluate(`[...document.querySelectorAll('[data-theme]')].map((el) => el.getAttribute('data-theme'))`);
const popupHidden = await evaluate(`(() => {
    const popup = document.getElementById('blai-purifier-popup');
    return !popup || getComputedStyle(popup).display === 'none';
})()`);

if (popupHidden) {
    await evaluate(`document.getElementById('blai-wand-btn')?.click(); true`);
    await sleep(600);
}
await evaluate(`import('/scripts/extensions/third-party/Veridis-Rewrite/src/ui/shell.js').then(() => true)`);

const combos = {};
for (const viewport of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await sleep(400);
    for (const theme of THEMES) {
        await evaluate(`(() => {
            document.querySelectorAll('[data-theme]').forEach((el) => el.setAttribute('data-theme', ${JSON.stringify(theme)}));
            return true;
        })()`);
        for (const pageName of PAGES) {
            await evaluate(`(async () => {
                const mod = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/ui/shell.js');
                mod.showResponsivePage(${JSON.stringify(pageName)});
                return true;
            })()`);
            await sleep(280);
            const comboKey = `${viewport.name}|${theme}|${pageName}`;
            combos[comboKey] = await evaluate(`(${CAPTURE.toString()})(${JSON.stringify(PROPS)}, ${JSON.stringify(PSEUDO_PROPS)}, ${JSON.stringify(theme)}, ${JSON.stringify(pageName)})`);
            console.log(`${comboKey}: ${combos[comboKey].elementCount ?? 0} 个元素`);
        }
    }
}

try {
    await evaluate(`(() => {
        const values = ${JSON.stringify(originalThemes)};
        document.querySelectorAll('[data-theme]').forEach((el, index) => {
            const value = values[index];
            if (value === null || value === undefined) el.removeAttribute('data-theme');
            else el.setAttribute('data-theme', value);
        });
        return true;
    })()`);
} finally {
    await send('Emulation.clearDeviceMetricsOverride');
    ws.close();
}

const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    props: PROPS,
    pseudoProps: PSEUDO_PROPS,
    viewports: VIEWPORTS,
    themes: THEMES,
    pages: PAGES,
    combos,
};

// 基线只存每个组合的元素数和计算样式摘要，避免把 7MB 全量 DOM 快照塞进仓库。
// 差异出现时重跑 --out 得到全量快照，再和上一份全量快照逐字段排查。
const digestCombo = (combo) => createHash('sha256').update(JSON.stringify(combo.elements)).digest('hex');
const makeCompact = (source) => ({
    version: source.version,
    generatedAt: source.generatedAt,
    props: source.props,
    pseudoProps: source.pseudoProps,
    viewports: source.viewports,
    themes: source.themes,
    pages: source.pages,
    combos: Object.fromEntries(Object.entries(source.combos).map(([key, combo]) => [
        key,
        { elementCount: combo.elementCount ?? 0, digest: digestCombo(combo) },
    ])),
});

const write = (file, data) => {
    const abs = path.resolve(file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`已写入 ${abs}`);
};

write(OUT, snapshot);
if (SAVE_BASELINE) write(SAVE_BASELINE, makeCompact(snapshot));

if (COMPARE) {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(COMPARE), 'utf8'));
    const diffs = [];
    const compactBaseline = baseline.combos && Object.values(baseline.combos).every((combo) => combo.digest);
    for (const comboKey of Object.keys(combos)) {
        const before = baseline.combos?.[comboKey];
        const after = combos[comboKey];
        if (!before) { diffs.push({ comboKey, reason: 'baseline missing' }); continue; }
        const afterDigest = digestCombo(after);
        if (compactBaseline) {
            if (before.elementCount !== (after.elementCount ?? 0)) {
                diffs.push({ comboKey, reason: 'element-count', before: before.elementCount, after: after.elementCount });
            }
            if (before.digest !== afterDigest) {
                diffs.push({ comboKey, reason: 'computed-style-digest', before: before.digest, after: afterDigest });
            }
            continue;
        }
        const beforeKeys = Object.keys(before.elements || {});
        const afterKeys = Object.keys(after.elements || {});
        if (beforeKeys.length !== afterKeys.length) {
            diffs.push({ comboKey, reason: 'element-count', before: beforeKeys.length, after: afterKeys.length });
        }
        for (const key of afterKeys) {
            const oldEntry = before.elements?.[key];
            const newEntry = after.elements[key];
            if (!oldEntry) { diffs.push({ comboKey, key, reason: 'element-added' }); continue; }
            for (const prop of PROPS) {
                if ((oldEntry.props?.[prop] ?? '') !== (newEntry.props?.[prop] ?? '')) {
                    diffs.push({ comboKey, key, prop, before: oldEntry.props?.[prop], after: newEntry.props?.[prop] });
                }
            }
            for (const pseudo of Object.keys(newEntry.pseudo || {})) {
                for (const prop of PSEUDO_PROPS) {
                    if ((oldEntry.pseudo?.[pseudo]?.[prop] ?? '') !== (newEntry.pseudo?.[pseudo]?.[prop] ?? '')) {
                        diffs.push({ comboKey, key, pseudo, prop, before: oldEntry.pseudo?.[pseudo]?.[prop], after: newEntry.pseudo?.[pseudo]?.[prop] });
                    }
                }
            }
        }
    }
    console.log(`\n对比 ${COMPARE}：${diffs.length ? `${diffs.length} 处差异` : '计算样式零差异'}`);
    diffs.slice(0, 30).forEach((diff) => console.log(' ', JSON.stringify(diff)));
    if (STRICT && diffs.length) process.exit(1);
}
