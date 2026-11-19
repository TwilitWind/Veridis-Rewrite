// 变量处理器载荷是消息数据，绝不是 AI 散文或复核文本。
const variableUpdatePattern = /<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi;

export function collectVariableUpdateRanges(text) {
    return [...String(text ?? '').matchAll(variableUpdatePattern)]
        .map(match => ({ start: match.index, end: match.index + match[0].length }));
}

export function omitVariableUpdates(text) {
    return String(text ?? '').replace(variableUpdatePattern, '');
}
