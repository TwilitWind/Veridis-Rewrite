#!/usr/bin/env node
// 把 styles/ 下带注释的分文件合并压缩成根目录 style.css（manifest 只认单个 css 文件）。
// 真源永远是 styles/ 里的分文件：改样式改那里，然后跑本脚本。
// 合并顺序读 styles/ORDER.json —— 顺序即层叠顺序，不能随手调：同特异性的规则靠先后决胜。
// 末尾做 token 级等价校验，只要语义变了一个字符就构建失败、不写产物。
// 同时生成 style.css.map，DevTools 里能直接跳回带注释的分文件行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 顺序表与源文件分离：新增分文件只改 ORDER.json，不改本脚本。
const ORDER = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles', 'ORDER.json'), 'utf8')).order.map(
    (rel) => './styles/' + rel,
);
const BANNER = '/* 由 build-css.mjs 从 styles/ 下的分文件生成，请勿直接编辑；样式改动写进分文件后重新跑 node build-css.mjs。 */\n';
const MAP_HINT = '/*# sourceMappingURL=style.css.map */\n';

const WS = /^\s+$/;
const isWordChar = (c) => /[A-Za-z0-9_\-\u00a0-\uffff.#%]/.test(c);

// 词法切分：注释丢弃，字符串整体保留，其余按「标识符串 / 单字符」切。
// 同一段 CSS 无论空白怎么变，token 序列必须完全一致 —— 这就是「无损」的可判定定义。
function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        if (/\s/.test(c)) { i += 1; continue; }
        if (c === '"' || c === "'") {
            const start = i;
            i += 1;
            while (i < text.length) {
                if (text[i] === '\\') { i += 2; continue; }
                if (text[i] === c) { i += 1; break; }
                i += 1;
            }
            tokens.push(text.slice(start, i));
            continue;
        }
        if (isWordChar(c)) {
            const start = i;
            while (i < text.length && isWordChar(text[i])) i += 1;
            tokens.push(text.slice(start, i));
            continue;
        }
        tokens.push(c);
        i += 1;
    }
    return tokens;
}

// 带原始偏移的切分，供 sourcemap 反查行号。
function slice(text) {
    const pieces = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'") {
            const start = i;
            i += 1;
            while (i < text.length) {
                if (text[i] === '\\') { i += 2; continue; }
                if (text[i] === c) { i += 1; break; }
                i += 1;
            }
            pieces.push({ text: text.slice(start, i), at: start });
            continue;
        }
        if (/\s/.test(c)) {
            const start = i;
            while (i < text.length && /\s/.test(text[i])) i += 1;
            pieces.push({ text: ' ', ws: true, at: start });
            continue;
        }
        pieces.push({ text: c, at: i });
        i += 1;
    }
    return pieces;
}

const NO_SPACE_BEFORE = '{};,>';
const NO_SPACE_AFTER = '{};,>';

// 省空白只做在这些位置：连续空白压成一个；紧贴 { } ; , > 的空白去掉；} 前多余的 ; 去掉。
// 刻意不动 + - 两侧（calc 必须有空格），也不动两个标识符之间的空格（后代选择器）。
// 返回 { code, lineAt: 每行首个字符在源文件里的偏移 }
function minifyFile(text) {
    const pieces = slice(text);
    let out = '';
    const lineAt = [];
    let atLineStart = true;
    let pendingBreak = false;
    const push = (s, at) => {
        if (atLineStart) { lineAt.push(at); atLineStart = false; }
        out += s;
    };
    for (let k = 0; k < pieces.length; k += 1) {
        const piece = pieces[k];
        if (piece.ws) {
            if (pendingBreak) continue;
            const prev = out[out.length - 1];
            let next = '';
            for (let j = k + 1; j < pieces.length; j += 1) {
                if (!pieces[j].ws) { next = pieces[j].text[0]; break; }
            }
            if (prev === undefined || next === '') continue;
            if (NO_SPACE_AFTER.includes(prev) || NO_SPACE_BEFORE.includes(next)) continue;
            push(' ', piece.at);
            continue;
        }
        if (piece.text === '}') {
            if (out.endsWith(';')) out = out.slice(0, -1);
            push('}', piece.at);
            pendingBreak = true;
            continue;
        }
        if (pendingBreak) {
            out += '\n';
            atLineStart = true;
            pendingBreak = false;
        }
        push(piece.text, piece.at);
    }
    // 末尾未刷新的换行补上，保证每个分文件都以 \n 结束 —— 否则文件边界那行会被并到下一段，
    // sourcemap 之后每个文件的映射都会整体错一行。
    if (pendingBreak || out.length === 0) out += '\n';
    if (lineAt.length === 0) lineAt.push(0);
    return { code: out, lineAt };
}

function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
    return starts;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(value) {
    let v = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = '';
    do {
        let digit = v & 31;
        v >>>= 5;
        if (v > 0) digit |= 32;
        out += B64[digit];
    } while (v > 0);
    return out;
}

function main() {
    const parts = [];
    const sources = [];
    const lines = []; // { src, line }
    ORDER.forEach((rel, index) => {
        const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        if (/@import/.test(raw)) throw new Error(rel + ' 里还有 @import，不能作为压缩单元');
        const starts = lineStarts(raw);
        const { code, lineAt } = minifyFile(raw);
        sources.push(rel.replace('./', ''));
        parts.push(code);
        const count = code.split('\n').length - 1;
        for (let i = 0; i < count; i += 1) {
            // 每行一个映射（code 以 \n 结尾，最后一行是空行 → 沿用上一行位置）。
            const at = lineAt[i] || 0;
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid] <= at) lo = mid;
                else hi = mid - 1;
            }
            lines.push({ src: index, line: lo });
        }
    });

    const body = parts.join('');
    const bannerLines = BANNER.split('\n').length - 1;
    const output = BANNER + body + MAP_HINT;

    // 等价校验：注释/空白/块尾分号本来就不参与比较，其余 token 必须逐个相同。
    const normalize = (tokens) => tokens.filter((t, i) => !(t === ';' && tokens[i + 1] === '}'));
    const source = ORDER.map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');
    const before = normalize(tokenize(source));
    const after = normalize(tokenize(BANNER + body + MAP_HINT));
    if (before.length !== after.length) {
        throw new Error('token 数量不一致：源 ' + before.length + '，产物 ' + after.length + '（压缩不安全，已中止）');
    }
    for (let i = 0; i < before.length; i += 1) {
        if (before[i] !== after[i]) {
            const from = Math.max(0, i - 8);
            throw new Error('token 第 ' + i + ' 个不一致：源『' + before.slice(from, i + 4).join(' ') + '』／产物『' + after.slice(from, i + 4).join(' ') + '』');
        }
    }

    // sourcemap：每行一个片段，指向分文件里的原始行。
    let prevSrc = 0;
    let prevLine = 0;
    const mappings = [];
    for (let i = 0; i < bannerLines; i += 1) mappings.push('');
    for (const item of lines) {
        mappings.push(vlq(0) + vlq(item.src - prevSrc) + vlq(item.line - prevLine) + vlq(0));
        prevSrc = item.src;
        prevLine = item.line;
    }
    // 不内嵌 sourcesContent：styles/*.css 随扩展一起安装，DevTools 会按 sources 路径去取，
    // 内嵌只会让 map 膨胀到 300kB+ 而没有额外好处。
    const map = {
        version: 3,
        file: 'style.css',
        sources,
        names: [],
        mappings: mappings.join(';'),
    };
    fs.writeFileSync(path.join(ROOT, 'style.css.map'), JSON.stringify(map), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'style.css'), output, 'utf8');

    const size = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + 'kB';
    console.log('style.css ' + size(source) + ' -> ' + size(output) + '，' + ORDER.length + ' 个源文件已合并（' + output.split('\n').length + ' 行）');
    console.log('校验通过：token 序列完全一致（' + before.length + ' 个），无功能或样式变化');
}
main();
