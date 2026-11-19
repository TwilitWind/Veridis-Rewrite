/**
 * 单条撤回的 DOM 采集与纯计算工具。
 *
 * 从 core 事件模块抽离：core 只负责事件编排与提交，
 * 这里负责「勾选项 -> 阶段文本」的换算，避免单文件继续膨胀。
 */
import { applyTextEdits, buildOffsetMap, computeSelectiveRevertedText } from './revertMerge.js';

const readNumber = (element, name) => {
    const raw = element?.getAttribute?.(`data-blai-${name}`);
    const value = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
};

const isChangeElement = (node) => node?.nodeType === 1
    && node.matches?.('del.blai-diff-change, ins.blai-diff-change');

/**
 * 给渲染出的差异项编号，并把相邻的 del/ins 归入同一项。
 * 序号在每次重渲染后按 DOM 顺序重建；文本不变时结果稳定。
 */
export function assignDiffRevertItemIds(contentEl) {
    if (!contentEl) return;
    const changes = Array.from(contentEl.querySelectorAll('del.blai-diff-change, ins.blai-diff-change'));
    const paired = new Set();
    let itemIndex = 0;
    for (const element of changes) {
        if (paired.has(element)) continue;
        const direction = element.tagName === 'DEL' ? 'nextSibling' : 'previousSibling';
        const candidate = element[direction];
        const pair = isChangeElement(candidate)
            && candidate.getAttribute('data-blai-diff-section') === element.getAttribute('data-blai-diff-section')
            ? candidate : null;
        const id = `blai-diff-item-${itemIndex++}`;
        const group = pair && pair !== element ? [element, pair] : [element];
        group.forEach(node => {
            node.setAttribute('data-blai-revert-item', id);
            paired.add(node);
        });
    }
}

/** 读取已勾选的差异项；同一项的 del/ins 只返回一条。 */
export function collectPickedDiffItems(contentEl) {
    if (!contentEl) return [];
    const nodes = Array.from(contentEl.querySelectorAll('[data-blai-revert-item]'));
    const picked = Array.from(contentEl.querySelectorAll('.blai-diff-change-picked'));
    const items = [];
    const handled = new Set();
    for (const element of picked) {
        const id = element.getAttribute('data-blai-revert-item');
        if (id && handled.has(id)) continue;
        if (id) handled.add(id);
        const group = id ? nodes.filter(node => node.getAttribute('data-blai-revert-item') === id) : [element];
        const del = group.find(node => node.tagName === 'DEL');
        const ins = group.find(node => node.tagName === 'INS');
        const anchor = del || ins || element;
        const oldStart = readNumber(del || anchor, 'old-start') ?? 0;
        const oldEnd = readNumber(del || anchor, 'old-end') ?? oldStart;
        const newStart = readNumber(ins || anchor, 'new-start') ?? 0;
        const newEnd = readNumber(ins || anchor, 'new-end') ?? newStart;
        items.push({
            section: anchor.getAttribute('data-blai-diff-section'),
            oldStart,
            oldEnd,
            newStart,
            newEnd,
            deletedText: del ? String(del.textContent || '') : '',
            insertedText: ins ? String(ins.textContent || '') : '',
        });
    }
    return items;
}

/**
 * 把勾选项换算成回退后的阶段文本与最终文本。
 * @returns {{original:string, aiText:string, programText:string, finalText:string}|null}
 */
export function computePickedRevert(items, meta, currentText) {
    if (!Array.isArray(items) || items.length === 0 || !meta) return null;
    const original = String(meta.originalMes ?? '');
    const aiText = meta.aiMes === null ? original : String(meta.aiMes);
    const programText = String(meta.programMes ?? '');
    const mapAiToProgram = meta.aiMes === null ? null : buildOffsetMap(aiText, programText);
    const programEdits = [];
    const aiEdits = [];

    for (const item of items) {
        if (item?.section !== 'ai' && item?.section !== 'program') continue;
        const deleted = String(item.deletedText ?? '');
        const inserted = String(item.insertedText ?? '');
        if (!deleted && !inserted) continue;
        if (item.section === 'program') {
            // 程序阶段：差异的新侧就是最终 Program 文本，坐标可直接用。
            programEdits.push({ start: item.newStart, end: item.newEnd, text: deleted });
        } else if (mapAiToProgram) {
            // AI 阶段：坐标落在 AI 文本上，先换算到 Program 文本。
            programEdits.push({
                start: mapAiToProgram(item.newStart),
                end: mapAiToProgram(item.newEnd),
                text: deleted,
            });
            aiEdits.push({ start: item.newStart, end: item.newEnd, text: deleted });
        }
    }
    if (programEdits.length === 0) return null;

    const revertedProgramText = applyTextEdits(programText, programEdits);
    if (revertedProgramText === programText) return null;
    const revertedAiText = aiEdits.length > 0 ? applyTextEdits(aiText, aiEdits) : aiText;
    const finalText = computeSelectiveRevertedText(currentText, programText, revertedProgramText);
    return {
        original,
        aiText: revertedAiText,
        programText: revertedProgramText,
        finalText,
    };
}
