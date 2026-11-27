/** 半开区间 [start, end) 的公共运算：作用域、代码范围与替换落点都按这里判定。 */

export function rangesOverlap(left, right) {
    return left.start < right.end && right.start < left.end;
}

export function rangeOverlapsAny(start, end, ranges) {
    return ranges.some((range) => rangesOverlap({ start, end }, range));
}

export function intersectRanges(leftRanges, rightRanges) {
    const intersections = [];
    for (const left of leftRanges) {
        for (const right of rightRanges) {
            const start = Math.max(left.start, right.start);
            const end = Math.min(left.end, right.end);
            if (start < end) intersections.push({ start, end });
        }
    }
    return intersections.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function subtractRanges(sourceRanges, excludedRanges) {
    const excluded = [...excludedRanges]
        .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end) && range.start < range.end)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const remaining = [];

    for (const sourceRange of sourceRanges) {
        let cursor = sourceRange.start;
        for (const excludedRange of excluded) {
            if (excludedRange.end <= cursor) continue;
            if (excludedRange.start >= sourceRange.end) break;
            if (excludedRange.start > cursor) {
                remaining.push({ start: cursor, end: Math.min(excludedRange.start, sourceRange.end) });
            }
            cursor = Math.max(cursor, excludedRange.end);
            if (cursor >= sourceRange.end) break;
        }
        if (cursor < sourceRange.end) remaining.push({ start: cursor, end: sourceRange.end });
    }

    return remaining;
}
