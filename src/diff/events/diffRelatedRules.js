/**
 * 相关规则：按净化时记录的实际命中痕迹精确定位，不再用相似度猜一整页候选。
 * 命中痕迹保存在消息独立字段里（ruleHitTrace.js）；找不到痕迹或规则已删时明确提示。
 * 从 events-00-core.js 拆出，这组函数不依赖弹窗闭包状态。
 */
import { getAppContext } from '../../host/appContext.js';
import { extensionName } from '../../settings/defaults.js';
import { getCurrentDiffIndex, getDiffComparisonForMessage } from '../state.js';
import { escapeHtml } from '../compare.js';
import {
    getRuleHitTrace,
    findHitsForChange,
    renderHitCandidate,
} from '../ruleHitTrace.js';
import { findRuleByFingerprint } from '../../rules/ruleIdentity.js';

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

function setRelatedBody(headHtml, noteHtml, listHtml = '') {
    const $body = $('#blai-diff-related-body');
    if (!$body.length) return;
    $body.html(`
            <div class="blai-diff-related-head">${headHtml}</div>
            <div class="blai-diff-related-note">${noteHtml}</div>
            ${listHtml ? `<div class="blai-diff-related-list">${listHtml}</div>` : ''}
        `);
    $('#blai-diff-related-modal').css('display', 'flex');
}

function showNotFound(clickedText, reason) {
    setRelatedBody(
        `<strong><i class="fa-solid fa-magnifying-glass"></i> 找不到对应规则</strong>
         <span>点击文本：${escapeHtml(clickedText || '（空）').slice(0, 120)}</span>`,
        escapeHtml(reason),
    );
}

export function showRelatedRulesForDiffElement(element) {
    const change = buildDiffChangeFromElement(element);
    if (!change) return;
    const { chat } = getAppContext();
    const index = getCurrentDiffIndex();
    const msg = Array.isArray(chat) ? chat[index] : null;
    const trace = getRuleHitTrace(msg);
    if (trace.length === 0) {
        showNotFound(change.clickedText, '这条消息没有规则命中记录（旧版本净化或 AI 改写），无法精确定位。');
        return;
    }

    const hits = findHitsForChange(trace, change);
    if (hits.length === 0) {
        showNotFound(change.clickedText, '该片段没有匹配的规则命中记录，可能由手动编辑或 AI 改写产生。');
        return;
    }

    const rules = getAppContext().extension_settings?.[extensionName]?.rules || [];
    const located = hits.map((hit) => findRuleByFingerprint(rules, hit.fingerprint));
    const items = hits.map((hit, itemIndex) => renderHitCandidate(
        hit,
        !!located[itemIndex],
        located[itemIndex]?.ruleIndex,
        located[itemIndex]?.subRuleIndex,
    )).join('');

    const allMissing = located.every((entry) => !entry);
    const note = allMissing
        ? '这些规则已被删除或修改，无法打开。'
        : '以下是实际改写该片段的规则，点击即可打开。';
    setRelatedBody(
        `<strong><i class="fa-solid fa-crosshairs"></i> 改写这条片段的规则</strong>
         <span>点击文本：${escapeHtml(change.clickedText || '（空）').slice(0, 120)}</span>`,
        note,
        items,
    );
}
