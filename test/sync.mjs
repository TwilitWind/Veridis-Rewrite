// 把源目录的运行时文件同步到已安装副本，逐文件比对后写入（含子目录，如 css/）。
// 用法: node sync.mjs <源目录> <目标目录> [扩展名过滤,默认 js,css,json,md,html]
// 预览镜像删除: 追加 --prune（默认只打印待删清单，不真删）
// 执行镜像删除: 追加 --prune --apply
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [src, dst, extArg] = args.filter(a => !a.startsWith('--'));
const PRUNE = args.includes('--prune');
const APPLY = args.includes('--apply');
if (!src || !dst) {
    console.error('用法: node sync.mjs <源目录> <目标目录> [扩展名过滤] [--prune] [--apply]');
    process.exit(1);
}
const exts = new Set((extArg ?? 'js,css,json,md,html').split(',').map(e => '.' + e.replace(/^\./, '')));

if (!fs.existsSync(dst)) {
    console.error('目标目录不存在:', dst);
    process.exit(1);
}

// 开发产物不同步：构建脚本、测试与临时目录里的文件不进安装副本。
// src/ 在本项目是运行时源码：index.js 用相对 import 直接引用 ./src/...，
// 没有打包步骤，所以装机副本必须有一份；仅当目标已存在该目录时才同步，
// 避免给真正「打包后单文件」的插件凭空塞源码目录。
// html 是模板（templates/purifier.html）在运行时 fetch，必须同步。
const SKIP = new Set(['.git', 'node_modules', 'dev', 'test', 'tmp', '_tmp', '_archive', 'shots', 'css-backup']);
function skipDir(rel) {
    if (rel !== 'src') return false;
    return !fs.existsSync(path.join(dst, 'src'));
}

// 构建脚本也不是运行时文件。
const SKIP_NAME = /^(?:build-.*\.mjs|package(?:-lock)?\.json|AGENTS\.md|MODULES\.md|CHANGELOG\.md|todo\.md)$/i;

// 调试与归档文件即使放在根目录也不同步。
const SKIP_FILE = /\.(png|jpe?g|gif|webp|zip|bak|orig|tmp|log)$/i;

// 同步与镜像删除共用这一个判据：只有「本脚本会同步的文件」才可能被镜像删除。
// 这样 images/ 的 png、vendor/ 的 wasm/mjs、style.css.map、.gitattributes 等
// 源目录不管的文件永不被删。
function isManagedFile(name) {
    if (SKIP_FILE.test(name)) return false;
    if (SKIP_NAME.test(name)) return false;
    return exts.has(path.extname(name));
}
function skipEntry(rel, name) {
    return SKIP.has(name) || skipDir(rel ? rel + '/' + name : name);
}
const norm = p => p.replace(/\\/g, '/');

const seen = new Set(); // 源目录里存在、受管理的相对路径（同步时收集）

// 每个目录下「源目录确实存在」的扩展名集合。
// 镜像删除只删「同目录、同扩展名」的失效文件——即改名残留的典型形态；
// 用户手工放进受管目录的杂项文件（如纯 css 目录里的 my-notes.json）不会匹配。
const dirExts = new Map(); // 目录(posix) -> Set(ext)
function recordDirExt(relPath) {
  const dir = path.posix.dirname(norm(relPath));
  const ext = path.extname(relPath);
  if (!dirExts.has(dir)) dirExts.set(dir, new Set());
  dirExts.get(dir).add(ext);
}

function walk(rel) {
    const from = path.join(src, rel);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (skipEntry(rel, entry.name)) continue;
        const childRel = path.join(rel, entry.name);
        if (entry.isDirectory()) {
            walk(childRel);
            continue;
        }
        if (!isManagedFile(entry.name)) continue;
        seen.add(norm(childRel));
        recordDirExt(childRel);
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

// ---- 镜像删除 ----
// 只删「本脚本会同步、但源目录已不存在」的文件。四重安全边界：
//   1) 扩展名与 SKIP 规则同同步（isManagedFile / skipEntry）；
//   2) 源目录里必须存在对应目录，整个源里没有的目录（如用户手工放的目录）不碰；
//   3) 源目录里若仍有同名文件，一律不删；
//   4) 同目录里源目录必须有同扩展名的受管文件，才认定是改名残留——
//      用户手工放进纯 css 目录的 my-notes.json 之类不会被误删。
// 默认只预览；必须显式 --prune --apply 才真删。
if (PRUNE) {
    const toDelete = [];
    function scanTarget(rel) {
        const fromDir = path.join(src, rel);
        const toDir = path.join(dst, rel);
        if (!fs.existsSync(toDir) || !fs.existsSync(fromDir)) return;
        for (const entry of fs.readdirSync(toDir, { withFileTypes: true })) {
            if (skipEntry(rel, entry.name)) continue;
            const childRel = path.join(rel, entry.name);
            if (entry.isDirectory()) {
                // 只递归进源目录也存在的子目录
                if (fs.existsSync(path.join(fromDir, entry.name))) scanTarget(childRel);
                continue;
            }
            if (!isManagedFile(entry.name)) continue;
            if (seen.has(norm(childRel))) continue;
            if (fs.existsSync(path.join(src, childRel))) continue;
            // 安全边界：该目录里源目录必须有同扩展名的受管文件，才认定是改名残留。
            const siblings = dirExts.get(path.posix.dirname(norm(childRel)));
            if (!siblings || !siblings.has(path.extname(entry.name))) continue;
            toDelete.push(childRel);
        }
    }
    scanTarget('');

    if (!toDelete.length) {
        console.log('\n[prune] 没有需要清理的文件');
    } else {
        console.log(`\n[prune] 待清理 ${toDelete.length} 个装机副本里已失效的文件:`);
        for (const f of toDelete) console.log('  ' + f);
        if (APPLY) {
            for (const f of toDelete) {
                fs.unlinkSync(path.join(dst, f));
                console.log('  deleted', f);
            }
            console.log(`[prune] 已删除 ${toDelete.length} 个文件`);
        } else {
            console.log('[prune] 仅预览；加 --apply 才会真删');
        }
    }
}
