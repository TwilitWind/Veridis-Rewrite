// 提交前体积门禁：检查本次暂存的文件；没有暂存文件时退回扫 src/（便于手动调用）。
// 超过 25KB 警告、达到或超过 30KB 拦截，提示按职责拆分。
// 第三方依赖、官方源码快照、构建产物与截图不是本插件手写代码，不参与门禁。
// 由 .git/hooks/pre-commit 调用；钩子不入库，本脚本入库可复用。
// 用法: node test/pre-commit-size.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const WARN = 25 * 1024;
const BLOCK = 30 * 1024;
const CODE_RE = /\.(js|mjs|css)$/;
// 这些是可再生或第三方内容，体积不反映本项目的可维护性。
const EXCLUDE = /(^|\/)(vendor|reference|node_modules|shots|test\/tmp|test\/fixtures)(\/|$)|^style\.css$/;

function stagedFiles() {
    try {
        const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
            cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.split('\n').filter(Boolean).map((rel) => rel.replace(/\\/g, '/'));
    } catch {
        return [];
    }
}

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, out);
        else if (CODE_RE.test(ent.name)) out.push(p);
    }
    return out;
}

const staged = stagedFiles();
const rows = (staged.length
    ? staged.filter((rel) => CODE_RE.test(rel) && !EXCLUDE.test(rel))
        .map((rel) => ({ rel, file: path.join(ROOT, rel) }))
    : walk(SRC).map((file) => ({ rel: 'src/' + path.relative(SRC, file).split(path.sep).join('/'), file }))
).filter(({ file }) => fs.existsSync(file))
    .map(({ rel, file }) => ({ rel, bytes: fs.statSync(file).size }))
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

console.log(`${staged.length ? '暂存' : '源码'}体积门禁通过：检查 ${rows.length} 个文件，最大 ${rows.length ? (rows[0].bytes / 1024).toFixed(1) + 'KB' : '0KB'}`);
