// 提交前源码体积门禁：检查 src/ 下的 JS/MJS/CSS。
// 超过 25KB 警告、达到或超过 30KB 拦截，提示按职责拆分。
// 由 .git/hooks/pre-commit 调用；钩子不入库，本脚本入库可复用。
// 用法: node test/pre-commit-size.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const WARN = 25 * 1024;
const BLOCK = 30 * 1024;

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, out);
        else if (/\.(js|mjs|css)$/.test(ent.name)) out.push(p);
    }
    return out;
}

const rows = walk(SRC)
    .map((file) => ({
        rel: 'src/' + path.relative(SRC, file).split(path.sep).join('/'),
        bytes: fs.statSync(file).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);

const oversized = rows.filter((r) => r.bytes >= BLOCK);
const warned = rows.filter((r) => r.bytes >= WARN && r.bytes < BLOCK);

if (warned.length) {
    console.warn('[体积警告] 以下文件超过 25KB，建议按职责拆分：');
    for (const r of warned) console.warn(`  ${(r.bytes / 1024).toFixed(1)}KB  ${r.rel}`);
}
if (oversized.length) {
    console.error('\n[体积拦截] 以下文件达到 30KB，提交被拒绝：');
    for (const r of oversized) console.error(`  ${(r.bytes / 1024).toFixed(1)}KB  ${r.rel}`);
    console.error('\n请按职责拆分：脚本按功能/事件/视图分模块，CSS 按分区拆成 NN-*.css 再按序合并。');
    console.error('不要靠压缩空白或改扩展名绕过门禁。');
    process.exit(1);
}

console.log(`源码体积门禁通过：检查 ${rows.length} 个文件，最大 ${rows.length ? (rows[0].bytes / 1024).toFixed(1) + 'KB' : '0KB'}`);
