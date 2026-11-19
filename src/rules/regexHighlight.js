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

export function renderRegexHighlightHtml(source) {
    const text = String(source ?? '');
    if (!text.trim()) return '';
    return text.split(/\r?\n/).map((line) => {
        if (!line.trim()) return '<div class="blai-regex-hl-line">&nbsp;</div>';
        const tokens = tokenizeRegexSource(line);
        const flags = line.trim().startsWith('/') ? splitLiteralFormFlags(tokens) : '';
        const body = tokens.map((token) => {
            const label = TOKEN_LABELS[token.type] || '';
            return '<span class="blai-regex-tok blai-regex-tok--' + token.type + '" title="' + label + '">' + escapeHighlightHtml(token.value) + '</span>';
        }).join('');
        const flagsHtml = flags
            ? '<span class="blai-regex-tok blai-regex-tok--flags" title="' + TOKEN_LABELS.flags + '">' + escapeHighlightHtml(flags) + '</span>'
            : '';
        return '<div class="blai-regex-hl-line">' + body + flagsHtml + '</div>';
    }).join('');
}
