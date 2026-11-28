// 生成可直接安装的插件 zip。零依赖，只按随包清单收文件，协作与开发文件一律不进包。
// 用法：node build-release.mjs [输出目录]   默认输出到 ./dist
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(root, 'dist'));

// 随包清单（与 DEVELOPMENT.md「交付前确认」一致）：
// 根目录单文件 + 整目录。目录用递归白名单，避免夹带临时产物。
const ROOT_FILES = [
    'manifest.json',
    'index.js',
    'style.css',
    'LICENSE',
    'README.md',
    'ARCHITECTURE.md',
    'DEVELOPMENT.md',
    'CHANGELOG.md',
];
const TREE_DIRS = ['src', 'templates', 'vendor', 'images', 'docs/architecture'];

// 目录内即便在白名单下也不收的东西：源映射、备份、临时与协作文件。
const DENY_NAME = /^(?:AGENTS\.md|MODULES\.md|DESIGN\.md|todo\.md|pre-commit-size\.mjs|build-.*\.mjs)$/i;
const DENY_FILE = /\.(?:map|bak|orig|tmp|log|zip)$/i;
const DENY_DIR = new Set(['.git', 'node_modules', 'temp', 'tmp', '_tmp', '_archive', 'shots', 'dev', 'test', 'dist']);

function collect() {
    const files = [];
    for (const name of ROOT_FILES) {
        const full = path.join(root, name);
        if (!fs.existsSync(full)) throw new Error(`随包文件缺失：${name}`);
        files.push({ full, rel: name });
    }
    for (const dir of TREE_DIRS) {
        const base = path.join(root, dir);
        if (!fs.existsSync(base)) throw new Error(`随包目录缺失：${dir}`);
        const walk = (current) => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    if (DENY_DIR.has(entry.name)) continue;
                    walk(path.join(current, entry.name));
                    continue;
                }
                if (DENY_NAME.test(entry.name) || DENY_FILE.test(entry.name)) continue;
                const full = path.join(current, entry.name);
                files.push({ full, rel: path.relative(root, full).replace(/\\/g, '/') });
            }
        };
        walk(base);
    }
    return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

// 最小 ZIP 写入器（store 模式，不压缩）：Node 内置 zlib.crc32，无需第三方库。
function writeZip(files, target) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const { full, rel } of files) {
        const data = fs.readFileSync(full);
        const name = enc.encode(rel);
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.length + name.length + data.length;
    }
    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.concat([...locals, ...centrals, end]));
}

const files = collect();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = String(manifest.version || 'dev').replace(/[^\w.-]/g, '_');
const target = path.join(outDir, `Veridis-Rewrite-${version}.zip`);
writeZip(files, target);
console.log(`已生成：${target}`);
console.log(`文件数：${files.length}`);
console.log(files.map(f => f.rel).join('\n'));
