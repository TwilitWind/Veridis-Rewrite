// 把源目录的运行时文件同步到已安装副本，逐文件比对后写入（含子目录，如 css/）。
// 用法: node sync.mjs <源目录> <目标目录> [扩展名过滤,默认 js,css,json,md]
import fs from 'node:fs';
import path from 'node:path';

const [src, dst, extArg] = process.argv.slice(2);
if (!src || !dst) {
    console.error('用法: node sync.mjs <源目录> <目标目录> [扩展名过滤]');
    process.exit(1);
}
const exts = new Set((extArg ?? 'js,css,json,md').split(',').map(e => '.' + e.replace(/^\./, '')));

if (!fs.existsSync(dst)) {
    console.error('目标目录不存在:', dst);
    process.exit(1);
}

// 开发产物不同步：源码目录、构建脚本、测试与临时目录里的文件永远不该出现在安装副本里。
// src/ 是打包前的源码，装机目录只认 manifest 指向的产物；拷过去只会污染扩展目录。
// test/ 是正式测试、tmp/ 与 _tmp/ 是临时产物，同理不进装机目录。
const SKIP = new Set(['.git', 'node_modules', 'dev', 'src', 'test', 'tmp', '_tmp', '_archive', 'shots', 'css-backup']);

// 构建脚本也不是运行时文件。
const SKIP_NAME = /^(?:build-.*\.mjs|package(?:-lock)?\.json|AGENTS\.md|MODULES\.md|CHANGELOG\.md|todo\.md)$/i;

// 调试与归档文件即使放在根目录也不同步。
const SKIP_FILE = /\.(png|jpe?g|gif|webp|zip|bak|orig|tmp|log)$/i;

function walk(rel) {
    const from = path.join(src, rel);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const childRel = path.join(rel, entry.name);
        if (entry.isDirectory()) {
            walk(childRel);
            continue;
        }
        if (SKIP_FILE.test(entry.name)) continue;
        if (SKIP_NAME.test(entry.name)) continue;
        if (!exts.has(path.extname(entry.name))) continue;
        const a = fs.readFileSync(path.join(src, childRel));
        const target = path.join(dst, childRel);
        const b = fs.existsSync(target) ? fs.readFileSync(target) : null;
        if (!b || !a.equals(b)) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, a);
            console.log('copied', childRel);
        } else {
            console.log('same', childRel);
        }
    }
}

walk('');
