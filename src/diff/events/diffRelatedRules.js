/**
 * 相关规则推测：从点击的差异片段提取上下文，匹配可能的触发规则并渲染候选列表。
 * 从 events-00-core.js 拆出，这组函数不依赖弹窗闭包状态。
 */
import { getAppContext } from '../../host/appContext.js';
import { extensionName } from '../../settings/defaults.js';
import { getCurrentDiffIndex, getDiffComparisonForMessage } from '../state.js';
import { escapeHtml } from '../compare.js';
import { findRelatedRulesForDiffChange } from '../relatedRules.js';

function readDiffChangeNumber(element, name) {
    const raw = element?.getAttribute?.(`data-blai-${name}`);
    const value = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
}

function getAdjacentDiffChangeElement(element, direction) {
    const node = element?.[direction];
    return node?.nodeType === Node.ELEMENT_NODE
        && node.matches('del.blai-diff-change, ins.blai-diff-change')
        && node.getAttribute('data-blai-diff-section') === element.getAttribute('data-blai-diff-section') ? node : null;
}

function getContextWindow(text = '', start = 0, end = start, radius = 160) {
    const source = String(text || '');
    const safeStart = Math.max(0, Math.min(source.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(source.length, Number(end) || safeStart));
    return source.slice(Math.max(0, safeStart - radius), Math.min(source.length, safeEnd + radius));
}

function buildDiffChangeFromElement(element) {
    const index = getCurrentDiffIndex();
    const section = element?.closest('[data-blai-diff-section]')?.getAttribute('data-blai-diff-section');
    const pair = getDiffComparisonForMessage(index, section);
    if (!pair || !element) return null;

    const clickedType = element.getAttribute('data-blai-diff-type') || (element.tagName === 'DEL' ? 'delete' : 'insert');
    const clickedText = String(element.textContent || '');
    const previousChange = getAdjacentDiffChangeElement(element, 'previousSibling');
    const nextChange = getAdjacentDiffChangeElement(element, 'nextSibling');
    const pairedDelete = clickedType === 'delete' ? element : (previousChange?.tagName === 'DEL' ? previousChange : null);
    const pairedInsert = clickedType === 'insert' ? element : (nextChange?.tagName === 'INS' ? nextChange : null);
    const oldStart = readDiffChangeNumber(pairedDelete || element, 'old-start') ?? readDiffChangeNumber(element, 'old-start') ?? 0;
    const oldEnd = readDiffChangeNumber(pairedDelete || element, 'old-end') ?? oldStart;
    const newStart = readDiffChangeNumber(pairedInsert || element, 'new-start') ?? readDiffChangeNumber(element, 'new-start') ?? 0;
    const newEnd = readDiffChangeNumber(pairedInsert || element, 'new-end') ?? newStart;
    const deletedText = pairedDelete ? String(pairedDelete.textContent || '') : (clickedType === 'delete' ? clickedText : '');
    const insertedText = pairedInsert ? String(pairedInsert.textContent || '') : (clickedType === 'insert' ? clickedText : '');

    return {
        clickedType,
        clickedText,
        deletedText,
        insertedText,
        beforeText: deletedText,
        afterText: insertedText,
        oldStart,
        oldEnd,
        newStart,
        newEnd,
        oldSourceText: pair.oldText || '',
        oldContext: getContextWindow(pair.oldText || '', oldStart, oldEnd),
        newContext: getContextWindow(pair.newText || '', newStart, newEnd),
    };
}

function summarizeCandidateTargets(candidate) {
    const targets = Array.isArray(candidate.targets) ? candidate.targets.filter(Boolean) : [];
    const replacements = Array.isArray(candidate.replacements) ? candidate.replacements.filter(Boolean) : [];
    const targetText = targets.length > 0 ? targets.join(' / ') : '（空查找词）';
    const replacementText = replacements.length > 0 ? replacements.join(' / ') : '删除';
    return `${targetText} -> ${replacementText}`;
}

function renderRelatedRulesModal(change, candidates) {
    const $modal = $('#blai-diff-related-modal');
    const $body = $('#blai-diff-related-body');
    if (!$modal.length || !$body.length) return;
    const clickedText = change?.clickedText ? escapeHtml(change.clickedText).slice(0, 120) : '（空）';
    if (!Array.isArray(candidates) || candidates.length === 0) {
        $body.html(`
                <div class="blai-diff-related-head">
                    <strong><i class="fa-solid fa-crosshairs"></i> 未找到明显相关规则</strong>
                    <span>点击文本：${clickedText}</span>
                </div>
                <div class="blai-diff-related-note">这是相关规则推测，不保证为实际触发规则。</div>
            `);
        $modal.css('display', 'flex');
        return;
    }

    const items = candidates.map((candidate) => {
        const reasons = Array.isArray(candidate.reasons) && candidate.reasons.length > 0
            ? candidate.reasons.slice(0, 2).join('，')
            : '相关文本命中';
        const remark = candidate.remark ? ` · ${candidate.remark}` : '';
        return `
                <button type="button" class="blai-diff-related-candidate" data-rule-index="${candidate.ruleIndex}" data-subrule-index="${candidate.subRuleIndex}">
                    <span class="blai-diff-related-candidate-main">
                        <span class="blai-tag blai-badge-compact">${escapeHtml(candidate.modeLabel || candidate.mode || '规则')}</span>
                        <strong>${escapeHtml(candidate.groupName || `合集 ${candidate.ruleIndex + 1}`)}</strong>
                    </span>
                    <span class="blai-diff-related-candidate-preview">${escapeHtml(summarizeCandidateTargets(candidate))}</span>
                    <span class="blai-diff-related-candidate-reason">${escapeHtml(`${reasons} · 分数 ${Math.round(candidate.score)}${remark}`)}</span>
                </button>
            `;
    }).join('');

    $body.html(`
            <div class="blai-diff-related-head"><span>点击文本：${clickedText}</span></div>
            <div class="blai-diff-related-note">相关规则推测，不保证为实际触发规则。最多显示 10 条。</div>
            <div class="blai-diff-related-list">${items}</div>
        `);
    $modal.css('display', 'flex');
}

export function showRelatedRulesForDiffElement(element) {
    const change = buildDiffChangeFromElement(element);
    if (!change) return;
    const { extension_settings } = getAppContext();
    const rules = extension_settings[extensionName]?.rules || [];
    const candidates = findRelatedRulesForDiffChange(change, rules, { maxCount: 10 });
    renderRelatedRulesModal(change, candidates);
}
