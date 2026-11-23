// !important 静态审计：逐条统计选择器/属性/文件/用途，并和 styles/quality-baseline.json 对比。
// 用法：node test/audit/important-audit.mjs [--json] [--strict] [--update-baseline]
//   --json            输出结构化 JSON（供脚本消费）
//   --strict          任一文件 !important 数量高于基线即退出 1
//   --update-baseline 把当前每文件 !important 数量写回 styles/quality-baseline.json
// 依据：E:/Plugin Development/docs/design.md「CSS 编写规则」——数量只许降，
// 第三方主题注入的 !important 才准入，且必须注释对抗对象。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLES = path.join(ROOT, 'styles');
const BASELINE_PATH = path.join(STYLES, 'quality-baseline.json');
const ORDER = JSON.parse(fs.readFileSync(path.join(STYLES, 'ORDER.json'), 'utf8')).order;

const jsonMode = process.argv.includes('--json');
const strict = process.argv.includes('--strict') || process.env.STRICT === '1';
const updateBaseline = process.argv.includes('--update-baseline');

const stripCommentsKeepLines = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));

function ruleAt(src, index) {
    const before = src.slice(0, index);
    const open = before.lastIndexOf('{');
    const prevOpen = before.lastIndexOf('{', open - 1);
    const prevBoundary = Math.max(before.lastIndexOf('}'), prevOpen);
    const selector = src.slice(prevBoundary + 1, open).trim().replace(/\s+/g, ' ').slice(-220);
    const declStart = Math.max(before.lastIndexOf('{'), before.lastIndexOf(';'));
    let declEnd = src.indexOf(';', index);
    const braceEnd = src.indexOf('}', index);
    if (declEnd === -1 || (braceEnd !== -1 && braceEnd < declEnd)) declEnd = braceEnd;
    const declaration = src.slice(declStart + 1, declEnd).trim().replace(/\s+/g, ' ');
    const prop = declaration.split(':')[0].trim();
    const line = before.split('\n').length;
    return { selector, declaration, prop, line };
}

function classify({ prop, selector }) {
    const s = selector.toLowerCase();
    if ((prop === 'display' || prop === 'visibility' || prop === 'opacity' || prop === 'pointer-events')
        && /hidden|\[hidden\]|show|open|overlay|toast/.test(s)) return '显示/隐藏强开关';
    if (prop === 'z-index' || prop === 'position' || /^(top|right|bottom|left|inset)$/.test(prop)) return '浮层定位/层级';
    if (/^(background|background-color|background-image|color|border|border-color|box-shadow|outline|fill)/.test(prop)
        && /(input|select|textarea|text_pole|blai-input|blai-select-box)/.test(s)) return '输入控件主题覆盖';
    if (/^(background|background-color|background-image|color|border|border-color|box-shadow|outline|fill)/.test(prop)
        && /(toast|modal|menu|overlay|popup|tour|loading|dialog)/.test(s)) return '自有浮层固定外观';
    if (/^(font-size|font-weight|line-height|letter-spacing|font-family)/.test(prop)) return '字号/字重覆盖';
    if (/^(width|height|min-width|min-height|max-width|max-height|padding|margin|gap|flex|grid|box-sizing)/.test(prop)) return '尺寸/间距覆盖';
    if (/^(border-radius|transform|transition|animation)/.test(prop)) return '形状/动效覆盖';
    return '其他';
}

const countBy = (keyFn, rows) => {
    const map = new Map();
    for (const row of rows) {
        const key = keyFn(row);
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

const records = [];
const allDeclarations = new Map();
const byFile = new Map();
const missingReasonRecords = [];

for (const rel of ORDER) {
    const abs = path.join(STYLES, rel);
    if (!fs.existsSync(abs) || !rel.endsWith('.css')) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const src = stripCommentsKeepLines(raw);
    const rawLines = raw.split('\n');
    let count = 0;

    for (const match of src.matchAll(/!important/gi)) {
        const info = ruleAt(src, match.index);
        const record = { file: rel, ...info, category: classify(info) };
        const context = rawLines.slice(Math.max(0, info.line - 5), info.line - 1).join('\n');
        record.hasReasonNote = /对抗|第三方|主题|宿主|内联|隐藏|!important|custom_css/i.test(context);
        if (!record.hasReasonNote) missingReasonRecords.push(record);
        records.push(record);
        count += 1;
    }
    byFile.set(rel, count);

    for (const match of src.matchAll(/([-\w]+)\s*:\s*([^;{}]+?)(?=;|})/g)) {
        const prop = match[1].trim();
        const value = match[2].trim();
        const info = ruleAt(src, match.index);
        const key = `${info.selector}::${prop}`;
        const entry = allDeclarations.get(key) || { normal: 0, important: 0 };
        if (/!important/i.test(value)) entry.important += 1;
        else entry.normal += 1;
        allDeclarations.set(key, entry);
    }
}

const duplicateDeclarations = [...allDeclarations.entries()]
    .filter(([, value]) => value.normal > 0 && value.important > 0)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (b.normal + b.important) - (a.normal + a.important));

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
if (updateBaseline) {
    for (const [rel, count] of byFile) {
        baseline.base[rel] = { ...(baseline.base[rel] || { hex: 0, px: 0 }), important: count };
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

const overBaseline = [...byFile.entries()]
    .map(([rel, count]) => ({ file: rel, count, baseline: baseline.base[rel]?.important ?? 0 }))
    .filter((row) => row.count > row.baseline);

const report = {
    total: records.length,
    baselineTotal: Object.values(baseline.base).reduce((sum, entry) => sum + (Number(entry.important) || 0), 0),
    files: countBy((row) => row.file, records),
    properties: countBy((row) => row.prop, records),
    categories: countBy((row) => row.category, records),
    selectors: countBy((row) => row.selector, records).slice(0, 30),
    missingReasonCount: missingReasonRecords.length,
    duplicateDeclarations,
    overBaseline,
    records: records.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
};

if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`!important 总计 ${report.total} 处，基线 ${report.baselineTotal} 处。`);
    console.log(`未写对抗原因注释：${report.missingReasonCount} 处（线索，不判错）`);
    console.log(`同选择器同属性普通版与 !important 并存：${duplicateDeclarations.length} 组（含不同 media 分支，需人工判定）`);
    console.log('\n按用途分类：');
    report.categories.forEach(([category, count]) => console.log(String(count).padStart(4), category));
    console.log('\n按文件（仅列前 12）：');
    report.files.slice(0, 12).forEach(([file, count]) => console.log(String(count).padStart(4), file));
    if (overBaseline.length) {
        console.log('\n高于基线（STRICT 会失败）：');
        overBaseline.forEach((row) => console.log(`  ${row.file}: ${row.baseline} -> ${row.count}`));
    }
    if (updateBaseline) console.log('\n已更新 styles/quality-baseline.json 的 important 计数。');
}

if (strict && overBaseline.length) process.exit(1);
