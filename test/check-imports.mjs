/**
 * 导入完整性闸门：揪出「裸调用了本仓其他模块导出的函数，却没在本文件 import」的 ReferenceError 隐患。
 *
 * 真实踩过的坑（会直接导致「深度净化无法完成：xxx is not defined」）：
 *   - matching-00-compile.js 调用 collectVariableUpdateRanges() 却没导入
 *   - debugStore.js 调用 refreshMountedDebugDisplay() 却没导入
 * 这类错误静态语法检查（node --check）查不出来，只有运行到那条分支才炸，
 * 所以必须由本闸门在构建期拦下。
 *
 * 跑法：node test/check-imports.mjs          （失败退出 1）
 * 反证：临时删掉某文件的 import，本脚本必须报出来。
 *
 * 只匹配裸函数调用 (?<![\w.$])Name( ，排除 obj.Name( 与方法名；
 * 已 import、本文件声明、本文件形参/解构绑定、模块自身导出的一律跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
const files = walk(SRC);

// 1. 全仓导出符号 -> 定义文件集合
const exported = new Map();
for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const add = (name) => {
        if (!exported.has(name)) exported.set(name, new Set());
        exported.get(name).add(rel);
    };
    const re = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(t))) add(m[1]);
    const reb = /export\s*\{([^}]*)\}/g;
    while ((m = reb.exec(t))) {
        for (const part of m[1].split(',')) {
            const nm = part.trim().split(/\s+as\s+/).pop().trim();
            if (/^[A-Za-z_$][\w$]*$/.test(nm)) add(nm);
        }
    }
}

const problems = [];
for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const bound = new Set(); // import + 本文件声明 + 形参/解构

    const impRe = /import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/g;
    let m;
    while ((m = impRe.exec(t))) {
        for (const part of m[1].split(',')) {
            const nm = part.trim().split(/\s+as\s+/).pop().trim();
            if (/^[A-Za-z_$][\w$]*$/.test(nm)) bound.add(nm);
        }
    }
    const collect = (re, fn) => { let x; while ((x = re.exec(t))) fn(x); };
    collect(/import\s*\*\s*as\s+([\w$]+)/g, (x) => bound.add(x[1]));
    collect(/import\s+([\w$]+)\s+from/g, (x) => bound.add(x[1]));
    collect(/(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g, (x) => bound.add(x[1]));

    // 形参：function f(a, b) / ({ a, b }) / (a = 1) 以及箭头函数形参
    collect(/(?:\(|,\s*)([A-Za-z_$][\w$]*)\s*(?=[,)=]|\s*=>)/g, (x) => bound.add(x[1]));
    // 解构绑定的键名（形参 { a } 或 const { a } =）
    collect(/\{([^{}]*)\}/g, (x) => {
        for (const part of x[1].split(',')) {
            const nm = part.trim().split(/[:=]/)[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(nm)) bound.add(nm);
        }
    });

    // spread 调用 ...fn() 的 fn 前面是 ".",会被下面的 "排除方法调用" 负向后顾误伤。
    // 先把 "..." 抹成空格，这样 ...collectVariableUpdateRanges( 变成可匹配的裸调用；
    // 真正的对象方法 obj.fn( 前面的单点仍在，仍被排除。
    const spreadFree = t.replace(/\.\.\./g, '   ');
    for (const [name, defFiles] of exported) {
        if (bound.has(name) || defFiles.has(rel)) continue;
        const callRe = new RegExp('(?<![\\w.$])' + name + '\\s*\\(', 'g');
        if (callRe.test(spreadFree)) problems.push({ file: rel, name, definedIn: [...defFiles].join(', ') });
    }
}

if (problems.length === 0) {
    console.log(`check-imports 通过：${files.length} 个 JS，未发现未导入的跨模块调用`);
} else {
    console.error(`check-imports 失败：${problems.length} 处调用了别处导出却未导入的函数（会抛 ReferenceError）：`);
    for (const p of problems) console.error(`  ✗ ${p.file}: 调用 ${p.name}() -> 定义在 ${p.definedIn}`);
    process.exit(1);
}
