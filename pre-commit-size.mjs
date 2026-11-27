/**
 * 提交前体积闸门：暂存的普通源码/文档超过 30KB（约 5000 token）就拒绝提交。
 * 跳过 lockfile、构建产物、vendor 与二进制资源；工作台模板已拆成 templates/purifier-*.html，
 * 每个片段都受同一红线约束，不再有基线豁免。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MAX_BYTES = 30 * 1024;
const BASELINE_EXEMPT = new Set();

function isSkipped(rel) {
    if (BASELINE_EXEMPT.has(rel)) return true;
    if (rel.endsWith('.map') || rel === 'style.css') return true;
    if (/^(vendor|images|shots)\//.test(rel)) return true;
    if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(rel)) return true;
    return false;
}

const listed = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], { encoding: 'utf8' });
if (listed.status !== 0) {
    console.error('体积闸门无法读取暂存文件：' + (listed.stderr || '').trim());
    process.exit(1);
}
const staged = listed.stdout.split('\0').filter(Boolean);
const violations = [];
for (const rel of staged) {
    if (isSkipped(rel) || !fs.existsSync(rel)) continue;
    const bytes = fs.statSync(rel).size;
    if (bytes > MAX_BYTES) violations.push(`  ${rel}：${bytes} 字节（约 ${Math.ceil(bytes / 4)} token），超过 5000 token / 30KB 红线`);
}
if (violations.length > 0) {
    console.error('提交被体积闸门拦下：\n' + violations.join('\n')
        + '\n请按功能拆成几个文件后重新提交（不要压缩空白或改扩展名绕过）。');
    process.exit(1);
}
