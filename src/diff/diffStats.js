/**
 * 透视弹窗工具行的计数口径：当前差异里的改写项数 + 改写后的手动改动数。
 * 不写 DOM，不持久化；由 events-00-core.js 负责回显。
 */
import { getTextDiffOperations } from './compare.js';
import { getMessageDiffMeta, isMessageDiffReverted } from './messageMeta.js';
import { omitVariableUpdates } from '../text/variableUpdates.js';

/** 插件产出与当前正文之间的差异，连续的一段算一次手改。 */
function countManualHunks(msg, meta) {
    if (!msg || !meta || isMessageDiffReverted(msg)) return 0;
    const before = omitVariableUpdates(meta.programMes ?? '');
    const after = omitVariableUpdates(msg.mes ?? '');
    if (before === after) return 0;
    let hunks = 0;
    let inHunk = false;
    for (const operation of getTextDiffOperations(before, after)) {
        if (operation.type === 'equal') {
            inHunk = false;
            continue;
        }
        if (!inHunk) { hunks++; inHunk = true; }
    }
    return hunks;
}

/**
 * @param {object} msg 当前消息。
 * @param {Element|null} contentEl 已渲染的差异内容区。
 * @returns {{program:number, ai:number, manual:number}}
 */
export function collectDiffStats(msg, contentEl) {
    const seen = new Set();
    let program = 0;
    let ai = 0;
    contentEl?.querySelectorAll('[data-blai-revert-item]').forEach((node) => {
        const id = node.getAttribute('data-blai-revert-item');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const section = node.getAttribute('data-blai-diff-section');
        if (section === 'program') program++;
        else if (section === 'ai') ai++;
    });
    return { program, ai, manual: countManualHunks(msg, getMessageDiffMeta(msg)) };
}
