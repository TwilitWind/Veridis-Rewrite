import { getTextDiffOperations } from './compare.js';

function buildChangeHunks(oldText, newText) {
    const operations = getTextDiffOperations(oldText, newText);
    const hunks = [];
    let baseIndex = 0;
    for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        const length = Array.from(operation.text).length;
        if (operation.type === 'equal') {
            baseIndex += length;
            continue;
        }
        if (operation.type === 'delete') {
            const next = operations[i + 1];
            if (next?.type === 'insert') {
                hunks.push({ baseStart: baseIndex, baseEnd: baseIndex + length, text: next.text });
                i++;
            } else {
                hunks.push({ baseStart: baseIndex, baseEnd: baseIndex + length, text: '' });
            }
            baseIndex += length;
            continue;
        }
        hunks.push({ baseStart: baseIndex, baseEnd: baseIndex, text: operation.text });
    }
    return hunks;
}

function isZeroWidth(hunk) {
    return hunk.baseStart === hunk.baseEnd;
}

function hunksOverlap(left, right) {
    const leftEmpty = isZeroWidth(left);
    const rightEmpty = isZeroWidth(right);
    if (leftEmpty && rightEmpty) return left.baseStart === right.baseStart;
    if (leftEmpty) return left.baseStart > right.baseStart && left.baseStart < right.baseEnd;
    if (rightEmpty) return right.baseStart > left.baseStart && right.baseStart < left.baseEnd;
    return left.baseStart < right.baseEnd && right.baseStart < left.baseEnd;
}

function sortHunks(left, right) {
    if (left.baseStart !== right.baseStart) return left.baseStart - right.baseStart;
    return (isZeroWidth(left) ? 0 : 1) - (isZeroWidth(right) ? 0 : 1);
}

function renderRegion(baseChars, start, end, hunks) {
    let output = '';
    let cursor = start;
    for (const hunk of hunks) {
        if (hunk.baseStart > cursor) output += baseChars.slice(cursor, hunk.baseStart).join('');
        output += hunk.text;
        cursor = Math.max(cursor, hunk.baseEnd);
    }
    if (cursor < end) output += baseChars.slice(cursor, end).join('');
    return output;
}

/**
 * 把「基准文本上的一组替换」与「用户对基准文本的编辑」合并：
 * 重叠区间保留用户措辞，未改动的区间才应用替换。
 */
function mergeBaseChangesWithUserEdits(currentText, baseText, baseHunks) {
    const current = String(currentText ?? '');
    const base = String(baseText ?? '');
    if (current === base) return null;

    const baseChars = Array.from(base);
    const userHunks = buildChangeHunks(base, current).sort(sortHunks);

    const grouped = [];
    for (const entry of [
        ...baseHunks.map((hunk) => ({ hunk, side: 'base' })),
        ...userHunks.map((hunk) => ({ hunk, side: 'user' })),
    ].sort((left, right) => sortHunks(left.hunk, right.hunk))) {
        const last = grouped[grouped.length - 1];
        if (last && last.entries.some((item) => hunksOverlap(item.hunk, entry.hunk))) {
            last.entries.push(entry);
            last.start = Math.min(last.start, entry.hunk.baseStart);
            last.end = Math.max(last.end, entry.hunk.baseEnd);
            continue;
        }
        grouped.push({ entries: [entry], start: entry.hunk.baseStart, end: entry.hunk.baseEnd });
    }

    let output = '';
    let cursor = 0;
    for (const group of grouped) {
        if (group.start > cursor) output += baseChars.slice(cursor, group.start).join('');
        const baseSide = group.entries.filter((entry) => entry.side === 'base').map((entry) => entry.hunk);
        const userSide = group.entries.filter((entry) => entry.side === 'user').map((entry) => entry.hunk);
        const applied = userSide.length > 0 ? userSide : baseSide;
        output += renderRegion(baseChars, group.start, group.end, applied);
        cursor = Math.max(cursor, group.end);
    }
    if (cursor < baseChars.length) output += baseChars.slice(cursor).join('');
    return output;
}

/**
 * 在用户手动编辑过的文本之上撤回已记录的净化阶段。
 * 未改动区间回退到记录的 Original；用户动过的区间
 * 保留用户措辞，因此手动编辑绝不会阻止撤回。
 */
export function computeRevertedText(currentText, programText, originalText) {
    const current = String(currentText ?? '');
    const base = String(programText ?? '');
    const original = String(originalText ?? '');
    if (current === base) return original;

    const originalHunks = buildChangeHunks(base, original).sort(sortHunks);
    return mergeBaseChangesWithUserEdits(current, base, originalHunks) ?? original;
}

const clampOffset = (value, length) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(length, Math.trunc(number)));
};

/**
 * 在指定文本上按 UTF-16 偏移替换若干区间；按从后往前的顺序应用，
 * 因此前面的编辑不会让后面的坐标失效。重叠区间只保留靠后的那一条，
 * 避免同一段文本被写两次。
 */
export function applyTextEdits(text, edits = []) {
    let result = String(text ?? '');
    const normalized = (Array.isArray(edits) ? edits : [])
        .map((edit) => {
            const start = clampOffset(edit?.start, result.length);
            const end = Math.max(start, clampOffset(edit?.end, result.length));
            return { start, end, text: String(edit?.text ?? '') };
        })
        .filter((edit) => edit.start !== edit.end || edit.text !== '')
        .sort((left, right) => left.start - right.start || left.end - right.end);

    const merged = [];
    for (const edit of normalized) {
        const last = merged[merged.length - 1];
        if (last && edit.start < last.end) {
            last.end = Math.max(last.end, edit.end);
            continue;
        }
        merged.push({ ...edit });
    }
    for (let i = merged.length - 1; i >= 0; i--) {
        const { start, end, text } = merged[i];
        result = result.slice(0, start) + text + result.slice(end);
    }
    return result;
}

/**
 * 建立 fromText 的 UTF-16 偏移到 toText 偏移的映射。
 * 用于把 AI 阶段的差异坐标换算到最终 Program 文本坐标。
 */
export function buildOffsetMap(fromText, toText) {
    const from = String(fromText ?? '');
    const to = String(toText ?? '');
    const map = new Array(from.length + 1).fill(to.length);
    map[0] = 0;
    let fromOffset = 0;
    let toOffset = 0;
    for (const operation of getTextDiffOperations(from, to)) {
        const length = String(operation.text ?? '').length;
        if (operation.type === 'equal') {
            for (let i = 1; i <= length; i++) map[fromOffset + i] = toOffset + i;
            fromOffset += length;
            toOffset += length;
        } else if (operation.type === 'delete') {
            for (let i = 1; i <= length; i++) map[fromOffset + i] = toOffset;
            fromOffset += length;
        } else if (operation.type === 'insert') {
            toOffset += length;
        }
    }
    return (offset) => map[clampOffset(offset, from.length)];
}

/**
 * 在用户手动编辑之上部分撤回：revertedProgramText 是已经按选中项
 * 回退过的 Program 文本，这里只把未改动的区间换成它，用户措辞保持不动。
 */
export function computeSelectiveRevertedText(currentText, programText, revertedProgramText) {
    const base = String(programText ?? '');
    const reverted = String(revertedProgramText ?? '');
    if (base === reverted) return String(currentText ?? '');
    const revertHunks = buildChangeHunks(base, reverted).sort(sortHunks);
    return mergeBaseChangesWithUserEdits(currentText, base, revertHunks) ?? reverted;
}
