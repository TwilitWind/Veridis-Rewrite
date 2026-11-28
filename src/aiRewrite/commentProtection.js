const xmlCommentPattern = /<!--[\s\S]*?-->/g;

export function collectXmlCommentRanges(text) {
    const source = String(text ?? '');
    const ranges = [];
    xmlCommentPattern.lastIndex = 0;
    let match;
    while ((match = xmlCommentPattern.exec(source)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        ranges.push({ start, end });
        if (match[0].length === 0) xmlCommentPattern.lastIndex += 1;
    }
    xmlCommentPattern.lastIndex = 0;
    return ranges;
}

/** AI 改写开关是否同时保护 HTML/XML 注释；规则引擎与 AI 链路共用同一判定。 */
export function shouldProtectXmlComments(settings = {}) {
    return settings?.aiRewrite?.protectXmlComments === true;
}

/** 按开关返回需要跳过的注释范围（原文坐标）；关闭时返回空数组。 */
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
