// 一站式样式审计入口：静态声明审计 + CDP 运行时布局审计。
// 用法：node test/audit.mjs [static|layout|all]   （默认 all）
//   static  只跑静态字号/双端/裁切信号审计，零依赖、无需浏览器
//   layout  只跑 CDP 运行时裁切/重叠/遮挡审计，需先启动 9224 调试 Chrome
//   all     静态 + 运行时，依次输出
// 目录约定：结果存到 tmp/，结构化 JSON 供脚本消费。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'all';
if (!['static', 'layout', 'all'].includes(mode)) {
    console.error('用法：node test/audit.mjs [static|layout|all]');
    process.exit(2);
}
const tmp = path.join(ROOT, 'tmp');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp);

const run = (script, env = {}) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'test', script)], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
    return r.status ?? 1;
};

let code = 0;
if (mode === 'static' || mode === 'all') {
    console.log('\n[1/2] 静态审计');
    code |= run('style-audit.mjs', {});
}
if (mode === 'layout' || mode === 'all') {
    console.log('\n[2/2] 运行时审计（需要 CDP 9224）');
    code |= run('layout-audit.mjs', { OUT: 'tmp/layout-report.json', CDP_PORT: process.env.CDP_PORT ?? '9224' });
}
process.exit(code);
