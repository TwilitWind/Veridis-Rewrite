// 正则语法高亮：只做词法切分，不做校验。

const TOKEN_LABELS = {
    escape: '转义',
    class: '字符组',
    group: '分组',
    quantifier: '量词',
    anchor: '锚点',
    alternation: '或',
    dot: '任意字符',
    flags: '修饰符',
    literal: '文本',
};

const OPEN_BRACKETS = { '(': ')', '[': ']', '{': '}' };
const CLOSE_BRACKETS = { ')': '(', ']': '[', '}': '{' };

export function escapeHighlightHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function readEscapeToken(text, index) {
    const rest = text.slice(index);
    const braced = rest.match(/^\\(?:[pP]\{[^}]*\}|u\{[0-9a-fA-F]+\}|q\{[\s\S]*?\})/);
    if (braced) return braced[0];
    const short = rest.match(/^\\(?:k<[^>]*>|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z])/);
    if (short) return short[0];
    return text.slice(index, index + 2);
}

export function tokenizeRegexSource(source) {
    const text = String(source ?? '');
    const tokens = [];
    const push = (type, value) => {
        if (!value) return;
        const last = tokens[tokens.length - 1];
        if (last && last.type === type) {
            last.value += value;
            return;
        }
        tokens.push({ type, value });
    };

    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === '\\') {
            const escape = readEscapeToken(text, index);
            push('escape', escape);
            index += escape.length;
            continue;
        }
        if (char === '[') {
            let depth = 0;
            let cursor = index;
            while (cursor < text.length) {
                const current = text[cursor];
                if (current === '\\') {
                    cursor += (readEscapeToken(text, cursor) || '\\').length;
                    continue;
                }
                if (current === '[') {
                    depth++;
                } else if (current === ']') {
                    depth--;
                    cursor++;
                    if (depth <= 0) break;
                    continue;
                }
                cursor++;
            }
            push('class', text.slice(index, cursor));
            index = cursor;
            continue;
        }
        if (char === '(' || char === ')') {
            push('group', char);
            index++;
            continue;
        }
        if (char === '*' || char === '+' || char === '?') {
            push('quantifier', char);
            index++;
            continue;
        }
        if (char === '{') {
            const quantifier = text.slice(index).match(/^\{\d+(?:,\d*)?\}/);
            if (quantifier) {
                push('quantifier', quantifier[0]);
                index += quantifier[0].length;
                continue;
            }
        }
        if (char === '^' || char === '$') {
            push('anchor', char);
            index++;
            continue;
        }
        if (char === '.') {
            push('dot', char);
            index++;
            continue;
        }
        if (char === '|') {
            push('alternation', char);
            index++;
            continue;
        }
        push('literal', char);
        index++;
    }

    return tokens;
}

/** 按真实换行切行，同时保留每行在整段文本里的起始偏移，供括号配对范围使用。 */
function splitSourceLines(text) {
    const lines = [];
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== '\n') continue;
        const end = i > start && text[i - 1] === '\r' ? i - 1 : i;
        lines.push({ text: text.slice(start, end), start });
        start = i + 1;
    }
    lines.push({ text: text.slice(start), start });
    return lines;
}

/** 建括号位置表：转义符号与字符组内部的括号不参与配对。 */
function buildBracketPairMap(text) {
    const pairs = new Map();
    const stack = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i];
        if (char === '\\') {
            i += (readEscapeToken(text, i) || '\\').length;
            continue;
        }
        if (char === '[') {
            let depth = 1;
            let cursor = i + 1;
            while (cursor < text.length && depth > 0) {
                const current = text[cursor];
                if (current === '\\') {
                    cursor += (readEscapeToken(text, cursor) || '\\').length;
                    continue;
                }
                if (current === '[') depth += 1;
                else if (current === ']') depth -= 1;
                cursor += 1;
            }
            if (depth === 0) {
                const close = cursor - 1;
                pairs.set(i, close);
                pairs.set(close, i);
                i = cursor;
                continue;
            }
            stack.push({ char, index: i });
            i += 1;
            continue;
        }
        if (OPEN_BRACKETS[char]) {
            stack.push({ char, index: i });
            i += 1;
            continue;
        }
        if (CLOSE_BRACKETS[char]) {
            const expected = CLOSE_BRACKETS[char];
            let found = -1;
            for (let s = stack.length - 1; s >= 0; s -= 1) {
                if (stack[s].char === expected) { found = s; break; }
            }
            if (found >= 0) {
                const opener = stack[found];
                stack.splice(found, 1);
                pairs.set(opener.index, i);
                pairs.set(i, opener.index);
            }
            i += 1;
            continue;
        }
        i += 1;
    }
    return pairs;
}

/**
 * 光标贴着括号任意一侧时，返回这一对括号两个符号各自的下标（start/end 仍是小者/大者，
 * 但只表示这两个符号，不表示它们之间的文本）。
 * 光标优先取左侧字符（即点在某符号右侧），再取右侧字符（点在某符号左侧）。
 */
export function findBracketPairAt(source, caret) {
    const text = String(source ?? '');
    const position = Number(caret);
    if (!Number.isInteger(position) || position < 0 || position > text.length) return null;
    const pairs = buildBracketPairMap(text);
    for (const index of [position - 1, position]) {
        if (index < 0 || index >= text.length) continue;
        const partner = pairs.get(index);
        if (partner === undefined) continue;
        return { start: Math.min(index, partner), end: Math.max(index, partner) };
    }
    return null;
}

function tokenSpan(type, value) {
    const label = TOKEN_LABELS[type] || '';
    return '<span class="blai-regex-tok blai-regex-tok--' + type + '" title="' + label + '">' + escapeHighlightHtml(value) + '</span>';
}

/**
 * 只给配对的括号符号本身（开符号与闭符号各一个字符）加底纹，中间文本保持原样。
 * 底纹仅用于看清符号的起始/闭合位置，所以绝不去包住中间内容；仍逐字切分保证与输入框对齐。
 */
function renderTokenWithPair(type, value, tokenStart, pairPositions) {
    if (!pairPositions) return tokenSpan(type, value);
    // 每个 token 只可能命中开/闭符号中的一到两个单字符，逐字符判断是否落在配对的两个下标上。
    const hits = [];
    for (let i = 0; i < value.length; i += 1) {
        const absolute = tokenStart + i;
        if (absolute === pairPositions.start || absolute === pairPositions.end) hits.push(i);
    }
    if (!hits.length) return tokenSpan(type, value);
    const label = TOKEN_LABELS[type] || '';
    const baseClass = 'blai-regex-tok blai-regex-tok--' + type;
    let html = '';
    let cursor = 0;
    for (const hit of hits) {
        if (hit > cursor) html += tokenSpan(type, value.slice(cursor, hit));
        html += '<span class="' + baseClass + ' blai-regex-bracket-pair" title="' + label + '">' + escapeHighlightHtml(value[hit]) + '</span>';
        cursor = hit + 1;
    }
    if (cursor < value.length) html += tokenSpan(type, value.slice(cursor));
    return html;
}

/**
 * 简易组合语法高亮：只标 `{` `}` `,` 分组、`,` 或分支、`*` 与 `?` 通配，
 * 其余按文本色输出。普通文本没有语法符号，因此调用方不会用本函数。
 */
export function renderSimpleHighlightHtml(source, pairRange = null) {
    const text = String(source ?? '');
    if (!text.trim()) return '';
    return splitSourceLines(text).map((line) => {
        if (!line.text.trim()) return '<div class="blai-regex-hl-line">&nbsp;</div>';
        let body = '';
        for (let i = 0; i < line.text.length; i += 1) {
            const char = line.text[i];
            let type = 'literal';
            if (char === '{' || char === '}') type = 'group';
            else if (char === ',') type = 'alternation';
            else if (char === '*' || char === '?') type = 'quantifier';
            body += renderTokenWithPair(type, char, line.start + i, pairRange);
        }
        return '<div class="blai-regex-hl-line">' + body + '</div>';
    }).join('');
}

function splitLiteralFormFlags(tokens) {
    const last = tokens[tokens.length - 1];
    if (!last || last.type !== 'literal') return '';
    const slashIndex = last.value.lastIndexOf('/');
    if (slashIndex < 0) return '';
    const flags = last.value.slice(slashIndex + 1);
    last.value = last.value.slice(0, slashIndex + 1);
    if (!last.value) tokens.pop();
    return flags;
}

export function renderRegexHighlightHtml(source, pairRange = null) {
    const text = String(source ?? '');
    if (!text.trim()) return '';
    return splitSourceLines(text).map((line) => {
        if (!line.text.trim()) return '<div class="blai-regex-hl-line">&nbsp;</div>';
        const tokens = tokenizeRegexSource(line.text);
        const flags = line.text.trim().startsWith('/') ? splitLiteralFormFlags(tokens) : '';
        let offset = line.start;
        const body = tokens.map((token) => {
            const html = renderTokenWithPair(token.type, token.value, offset, pairRange);
            offset += token.value.length;
            return html;
        }).join('');
        const flagsHtml = flags
            ? '<span class="blai-regex-tok blai-regex-tok--flags" title="' + TOKEN_LABELS.flags + '">' + escapeHighlightHtml(flags) + '</span>'
            : '';
        return '<div class="blai-regex-hl-line">' + body + flagsHtml + '</div>';
    }).join('');
}
