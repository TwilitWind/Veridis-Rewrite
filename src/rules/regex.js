// 正则解析/校验语义。

import { getChineseCharVariants } from '../zh/conversion.js';

const SIMPLE_WILDCARD_STOP_CHARS = ",，。.!?！？；;\n";
const REGEX_LITERAL_ALLOWED_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

// 浏览器抛出的正则错误是英文原文（形如 "Invalid regular expression: /[/gmu: Unterminated
// character class"），直接贴给用户看不懂，这里按引擎提示逐条翻成中文并去掉 /pattern/flags 前缀。
const REGEX_ERROR_PREFIX = /^Invalid regular expression: \/[\s\S]*?\/[a-z]*: ([\s\S]+)$/u;

const REGEX_ERROR_TRANSLATIONS = [
    [/^Unterminated character class$/iu, '字符组没有闭合，请检查 [ 与 ] 是否成对'],
    [/^Unterminated group$/iu, '分组没有闭合，请检查 ( 与 ) 是否成对'],
    [/^Unmatched '\)'$/iu, '多了一个右括号 )，没有与之配对的左括号'],
    [/^Incomplete quantifier$/iu, '量词花括号没有写完整，请检查 {n}、{n,}、{n,m} 的写法'],
    [/^numbers out of order in \{\} quantifier$/iu, '花括号量词的数字顺序颠倒，前面的数字不能大于后面的数字'],
    [/^Nothing to repeat$/iu, '量词前面缺少可重复的内容，请检查 * + ? { 前面的字符'],
    [/^Invalid quantifier$/iu, '量词使用位置不合法，例如不能直接跟在零宽断言后面'],
    [/^Lone quantifier brackets$/iu, '字符组里出现了不支持的嵌套写法（例如 [[:alpha:]]），请改用单层字符组'],
    [/^Range out of order in character class$/iu, '字符组里的范围顺序颠倒，例如 [z-a] 应为 [a-z]'],
    [/^Invalid character class$/iu, '字符组内容不合法，例如 [a-\\d] 这样的混合范围'],
    [/^Invalid group$/iu, '分组语法不合法，请检查 (?...) 的写法'],
    [/^Invalid capture group name$/iu, '捕获组名称不合法，只能由字母、数字、下划线组成且不能以数字开头'],
    [/^Duplicate capture group name$/iu, '捕获组名称重复，同一个名称只能出现一次'],
    [/^Invalid named capture referenced$/iu, '引用的命名捕获组不存在，请检查 \\k<名称>'],
    [/^Invalid( Unicode)? escape$/iu, '转义写法不合法，请检查 \\u{...}、\\x、\\c 等转义'],
    [/^Invalid decimal escape$/iu, '十进制转义不合法，请检查 \\数字 的写法'],
    [/^Invalid property name$/iu, 'Unicode 属性名不合法，请检查 \\p{...} 里的属性名称'],
    [/^Invalid character in property name$/iu, 'Unicode 属性名里出现了非法字符，请检查 \\p{...}'],
    [/^Invalid regular expression flags$/iu, '正则修饰符不合法，可用的只有 d、g、i、m、s、u、v、y'],
    [/^\\ at end of pattern$/iu, '模式以反斜杠结尾，请补全要转义的字符'],
    [/^Invalid group specifier name$/iu, '分组说明符不合法，请检查 (?<名称>) 的写法'],
];

/**
 * 把浏览器正则引擎的英文报错转成中文提示，翻译不到时保留原文兜底。
 */
export function translateRegexError(rawMessage) {
    let message = String(rawMessage ?? '').trim();
    if (!message) return '正则表达式语法错误，请检查写法。';
    // 先剥掉 "/pattern/flags: " 前缀，剩下的才是引擎给出的人话错误。
    const unwrapped = message.match(REGEX_ERROR_PREFIX);
    if (unwrapped) message = unwrapped[1].trim();
    for (const [pattern, replacement] of REGEX_ERROR_TRANSLATIONS) {
        if (!pattern.test(message)) continue;
        return message.replace(pattern, replacement);
    }
    return `正则表达式语法错误：${message}`;
}

function findLastUnescapedSlash(text) {
    for (let i = text.length - 1; i > 0; i--) {
        if (text[i] !== '/') continue;
        let backslashCount = 0;
        for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashCount++;
        if (backslashCount % 2 === 0) return i;
    }
    return -1;
}

function normalizeRegexLiteralFlags(rawFlags) {
    let normalizedFlags = '';
    const seen = new Set();
    for (const flag of rawFlags) {
        if (!REGEX_LITERAL_ALLOWED_FLAGS.has(flag)) return { ok: false, error: { message: `包含不支持的 flags：${flag}` } };
        if (seen.has(flag)) return { ok: false, error: { message: `包含重复的 flags：${flag}` } };
        seen.add(flag);
        normalizedFlags += flag;
    }
    if (!seen.has('g')) normalizedFlags += 'g';
    return { ok: true, flags: normalizedFlags };
}

function expandChineseRegexCharacters(pattern, flags, options) {
    const unicode = flags.includes('u') || flags.includes('v');
    let output = '';
    let classDepth = 0;
    let previousToken = '';

    for (let index = 0; index < pattern.length;) {
        const rest = pattern.slice(index);
        // 转义与分组名属于语法，不是中文字面量原子。
        const syntax = rest.match(/^\\(?:[pP]\{[^}]*\}|k<[^>]*>|q\{(?:\\[\s\S]|[^\\}])*\}|u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|c[A-Za-z]|[\s\S])/)
            || (classDepth === 0 && rest.match(/^\(\?<[^=!][^>]*>/));
        if (syntax) {
            output += syntax[0];
            previousToken = syntax[0];
            index += syntax[0].length;
            continue;
        }

        const char = unicode ? String.fromCodePoint(pattern.codePointAt(index)) : pattern[index];
        if (char === '[' && (classDepth === 0 || flags.includes('v'))) classDepth++;
        else if (char === ']' && classDepth > 0) classDepth--;

        // 范围端点定义的是一个区间，而不是字面成员。
        const rangeEndpoint = classDepth > 0
            && (previousToken === '-'
                || (pattern[index + char.length] === '-'
                    && ![']', '-'].includes(pattern[index + char.length + 1])));
        const variants = /\p{Script=Han}/u.test(char) && !rangeEndpoint
            ? getChineseCharVariants(char, options)
            : [char];
        if (variants.length === 1) {
            output += char;
        } else {
            const encoded = variants.map((variant) => Array.from(variant).map((value) => {
                if (unicode) return `\\u{${value.codePointAt(0).toString(16)}}`;
                return value.split('').map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
            }).join(''));
            output += classDepth > 0
                ? (flags.includes('v') ? `[${encoded.join('')}]` : encoded.join(''))
                : `(?:${encoded.join('|')})`;
        }
        previousToken = char === '-' && ['[', '^', '-', '\\-'].includes(previousToken) ? '\\-' : char;
        index += char.length;
    }
    return output;
}

export function compileRegexTarget(target, options = {}) {
    const source = String(target ?? '').trim();
    if (!source) return { ok: false, error: { message: '规则不能为空。' } };
    let pattern = source;
    let flags = 'gmu';
    if (source.startsWith('/')) {
        const lastSlash = findLastUnescapedSlash(source);
        if (lastSlash <= 0) return { ok: false, error: { message: '不是合法的 /pattern/flags 格式。' } };
        pattern = source.slice(1, lastSlash);
        const normalized = normalizeRegexLiteralFlags(source.slice(lastSlash + 1));
        if (!normalized.ok) return normalized;
        flags = normalized.flags;
    }
    try {
        let regex = new RegExp(pattern, flags);
        const matchesEmptyString = regex.test('');
        regex.lastIndex = 0;
        if (matchesEmptyString) return { ok: false, error: { message: '会匹配空字符串，存在风险，请改写规则。' } };
        if (options.useZhVariantCompat === true) {
            pattern = expandChineseRegexCharacters(pattern, flags, options.zhVariantOptions);
            regex = new RegExp(pattern, flags);
        }
        return { ok: true, value: { source, pattern, flags, regex } };
    } catch (e) {
        return { ok: false, error: { message: translateRegexError(e?.message) } };
    }
}

export function validateRegexTargetInput(text) {
    const parsed = [];
    const lines = String(text ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineText = String(lines[i] ?? '').trim();
        if (!lineText) continue;
        const compiled = compileRegexTarget(lineText);
        if (!compiled.ok) return { ok: false, error: { line: i + 1, input: lineText, message: compiled.error.message } };
        parsed.push({ line: i + 1, ...compiled.value });
    }
    return { ok: true, parsed };
}

export function buildSimpleWildcardPattern() {
    const escapedStops = SIMPLE_WILDCARD_STOP_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `[^${escapedStops}]{0,15}?`;
}
