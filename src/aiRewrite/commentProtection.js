const xmlCommentPattern = /<!--[\s\S]*?-->/g;
// html / HTML 等大小写写法都算；整块连围栏标记一起保护，内部换行原样保留。
const htmlFencePattern = /```html\b[\s\S]*?```/gi;

function collectPatternRanges(source, pattern) {
    const ranges = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        ranges.push({ start, end });
        if (match[0].length === 0) pattern.lastIndex += 1;
    }
    pattern.lastIndex = 0;
    return ranges;
}

/** 收集注释与 html 代码块的原文坐标，重叠区间合并后按起点排序。 */
export function collectXmlCommentRanges(text) {
    const source = String(text ?? '');
    const ranges = [
        ...collectPatternRanges(source, xmlCommentPattern),
        ...collectPatternRanges(source, htmlFencePattern),
    ].sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
        else merged.push({ ...range });
    }
    return merged;
}

/** AI 改写开关是否同时保护注释与 html 代码块；规则引擎与 AI 链路共用同一判定。 */
export function shouldProtectXmlComments(settings = {}) {
    return settings?.aiRewrite?.protectXmlComments === true;
}

/** 按开关返回需要跳过的注释与 html 代码块范围（原文坐标）；关闭时返回空数组。 */
export function getXmlCommentProtectRanges(text, protect = false) {
    return protect === true ? collectXmlCommentRanges(text) : [];
}

export function maskXmlCommentRanges(text, ranges = collectXmlCommentRanges(text)) {
    const source = String(text ?? '');
    if (!source || !Array.isArray(ranges) || ranges.length === 0) return source;

    let output = '';
    let cursor = 0;
    ranges.forEach((range) => {
        const start = Math.max(cursor, Math.min(source.length, Number(range?.start) || 0));
        const end = Math.max(start, Math.min(source.length, Number(range?.end) || start));
        if (end <= start) return;
        output += source.slice(cursor, start);
        output += source.slice(start, end).replace(/[^\r\n]/g, ' ');
        cursor = end;
    });
    return output + source.slice(cursor);
}
