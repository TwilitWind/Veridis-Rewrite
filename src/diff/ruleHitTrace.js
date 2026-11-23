/**
 * 规则命中痕迹：在净化时记录「这条差异实际由哪条规则改写」，供透视弹窗精确回查。
 * 存在消息上的独立字段（与 diff 阶段文本元数据分开），按 Swipe 分支存放，
 * 因此改动 diff 元数据的规范校验与迁移逻辑都不受影响。
 */
import { getMessageDiffBranchKey } from '../chat/messageBranch.js';
import { collectRuleHits } from '../rules/engine.js';
import { escapeHtml } from './compare.js';

const traceKey = '__blai_diff_rule_trace';
const maxTracePerBranch = 200;

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHit(hit = {}) {
    const fingerprint = String(hit.fingerprint || '');
    if (!fingerprint) return null;
    return {
        fingerprint,
        ruleName: String(hit.ruleName || ''),
        remark: String(hit.remark || ''),
        mode: String(hit.mode || 'text'),
        matchedText: String(hit.matchedText || ''),
        replacement: String(hit.replacement ?? ''),
        scopeStart: Number(hit.scopeStart) || 0,
        // 统一存原文坐标：命中回查要对齐差异片段，不能用处理链里被前序替换挪动过的坐标。
        start: Number(hit.originalStart ?? hit.start) || 0,
    };
}

/** 计算并存下这条消息当前分支的规则命中痕迹。 */
export function recordRuleHitTrace(msg, sourceText) {
    if (!isObject(msg)) return false;
    const branchKey = getMessageDiffBranchKey(msg);
    if (!branchKey) return false;
    const hits = collectRuleHits(sourceText).slice(0, maxTracePerBranch).map(normalizeHit).filter(Boolean);
    if (!isObject(msg[traceKey])) msg[traceKey] = {};
    const previous = msg[traceKey][branchKey];
    if (JSON.stringify(previous) === JSON.stringify(hits)) return false;
    msg[traceKey][branchKey] = hits;
    return true;
}

/** 读取指定分支的命中痕迹；旧消息无痕迹时返回空数组。 */
export function getRuleHitTrace(msg, branchKey = getMessageDiffBranchKey(msg)) {
    if (!branchKey) return [];
    const hits = msg?.[traceKey]?.[branchKey];
    return Array.isArray(hits) ? hits : [];
}

/** 删除消息的全部痕迹（窗口外消息清理时调用）。 */
export function clearMessageRuleHitTrace(msg) {
    if (!isObject(msg) || !Object.hasOwn(msg, traceKey)) return false;
    delete msg[traceKey];
    return true;
}

/** 宿主删掉一个 Swipe 后，把后续分支痕迹的序号整体前移。 */
export function shiftRuleHitTraceAfterSwipeDelete(msg, deletedIndex) {
    const container = msg?.[traceKey];
    if (!isObject(container) || !Number.isInteger(deletedIndex) || deletedIndex < 0) return false;
    const keys = Object.keys(container).filter((key) => /^swipe:\d+$/.test(key))
        .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    let changed = false;
    for (const key of keys) {
        const index = Number(key.slice(6));
        if (index < deletedIndex) continue;
        const entry = container[key];
        delete container[key];
        if (index > deletedIndex) container[`swipe:${index - 1}`] = entry;
        changed = true;
    }
    if (Object.keys(container).length === 0) delete msg[traceKey];
    return changed;
}

/**
 * 按差异片段文本与位置找对应命中。
 * 优先精确文本（删除文本 = 命中查找词 / 插入文本 = 替换结果），
 * 再退到原文坐标匹配；找不到返回空数组，由 UI 明确提示。
 */
export function findHitsForChange(trace = [], change = {}) {
    const deleted = String(change.deletedText || change.beforeText || '').trim();
    const inserted = String(change.insertedText || change.afterText || '').trim();
    const oldStart = Number(change.oldStart);
    const oldEnd = Number(change.oldEnd);
    const hasRange = Number.isFinite(oldStart) && Number.isFinite(oldEnd);

    // 只按替换结果相同会把「都删成空」的规则串成一组；命中词必须真的属于这段差异。
    const isTextCompatible = (hit) => {
        const matched = String(hit.matchedText || '').trim();
        const replacement = String(hit.replacement || '').trim();
        if (deleted && matched && !deleted.includes(matched)) return false;
        if (inserted && replacement && !inserted.includes(replacement)) return false;
        return true;
    };

    const exact = trace.filter((hit) => {
        const matched = String(hit.matchedText || '').trim();
        const replacement = String(hit.replacement || '').trim();
        const matchedDelete = deleted && matched === deleted;
        const matchedReplacement = inserted && !matchedDelete && replacement === inserted;
        return isTextCompatible(hit) && (matchedDelete || matchedReplacement);
    });
    if (exact.length > 0) return dedupeHits(exact);

    if (hasRange) {
        const byRange = trace.filter((hit) => {
            const absoluteStart = hit.scopeStart + hit.start;
            const absoluteEnd = absoluteStart + String(hit.matchedText || '').length;
            return isTextCompatible(hit)
                && absoluteStart <= oldEnd && absoluteEnd >= oldStart;
        });
        if (byRange.length > 0) return dedupeHits(byRange);
    }
    return [];
}

function dedupeHits(hits) {
    const seen = new Set();
    return hits.filter((hit) => {
        if (seen.has(hit.fingerprint)) return false;
        seen.add(hit.fingerprint);
        return true;
    });
}

function describeMode(hit) {
    if (hit.mode === 'regex') return '正则';
    if (hit.mode === 'simple') return '简易';
    return '普通';
}

/** 把一条命中渲染成可点击候选；found 为 false 时置灰，点击不跳转。 */
export function renderHitCandidate(hit, found, ruleIndexHint, subRuleIndexHint) {
    const target = escapeHtml(hit.matchedText || '（空查找词）');
    const replacement = escapeHtml(hit.replacement || '删除');
    const heading = hit.ruleName || '未命名合集';
    const remark = hit.remark ? ` · ${escapeHtml(hit.remark)}` : '';
    const attrs = found && Number.isInteger(ruleIndexHint) && Number.isInteger(subRuleIndexHint)
        ? `data-rule-index="${ruleIndexHint}" data-subrule-index="${subRuleIndexHint}"`
        : 'data-missing="true"';
    const status = found
        ? `<span class="blai-tag blai-badge-compact">${describeMode(hit)}</span>`
        : '<span class="blai-tag blai-badge-compact blai-diff-rule-missing-tag">已删除</span>';
    const note = found ? '点击打开这条规则' : '原规则已删除或修改，无法定位';
    return `
        <button type="button" class="blai-diff-related-candidate${found ? '' : ' is-missing'}" ${attrs}>
            <span class="blai-diff-related-candidate-main">
                ${status}
                <strong>${escapeHtml(heading)}</strong>
            </span>
            <span class="blai-diff-related-candidate-preview">${target} → ${replacement}</span>
            <span class="blai-diff-related-candidate-reason">${escapeHtml(note + remark)}</span>
        </button>
    `;
}
