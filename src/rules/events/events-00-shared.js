/***
 * 规则事件共享状态与辅助（ruleObjectIdMap / 搜索防抖 / 批量与转移辅助）
 * 由原 src/rules/events.js 拆分；对外接口不变，调用方仍从 ./events.js 的 bindRuleEvents 进入。
 */
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '.././state.js';
import { getRuleActivationWarning, isRuleActivationWarningEnabled, normalizeRuleActivationSafety } from '.././model.js';
import { compileRegexTarget, validateRegexTargetInput } from '.././regex.js';
import { renderRegexHighlightHtml } from '.././regexHighlight.js';
import { showToast } from '../../ui/notifications.js';
import { clearRuleSearchEditFlow, pushRuleSearchHistory, focusLatestRuleCard, openEditModal, openSingleRuleModal, renderRuleSearchModal, renderTags } from '.././view.js';

const ruleObjectIdMap = new WeakMap();
let nextRuleObjectId = 1;

function ensureRuleObjectId(rule) {
    if (!rule || typeof rule !== 'object') return '';
    let id = ruleObjectIdMap.get(rule);
    if (!id) {
        id = `rule-${nextRuleObjectId++}`;
        ruleObjectIdMap.set(rule, id);
    }
    return id;
}

function getRuleIdsByIndexes(rules, indexes) {
    return indexes.map((idx) => rules[idx]).filter(Boolean).map((rule) => ensureRuleObjectId(rule));
}

export function getSelectedIndexesFromState(rules) {
    const selectedSet = new Set(rulesUiState.batchSelectedRuleIds || []);
    return rules.map((rule, idx) => (selectedSet.has(ensureRuleObjectId(rule)) ? idx : -1)).filter((idx) => idx >= 0);
}

export function syncBatchSelectionStateFromDom(rules) {
    const indexes = $('.batch-item-checkbox:checked').map(function() { return Number($(this).data('index')); }).get().filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < rules.length);
    rulesUiState.batchSelectedRuleIds = getRuleIdsByIndexes(rules, indexes);
}

function applyBatchSelectionStateToDom(rules) {
    const selectedSet = new Set(rulesUiState.batchSelectedRuleIds || []);
    $('.batch-item-checkbox').each(function() {
        const idx = Number($(this).data('index'));
        const rule = rules[idx];
        const checked = Boolean(rule) && selectedSet.has(ensureRuleObjectId(rule));
        $(this).prop('checked', checked);
    });
}

export function getBatchOperationContext(clickedIndex, rules) {
    const isBatchMode = $('#blai-purifier-popup').hasClass('blai-is-batch-mode');
    const selectedIndexes = getSelectedIndexesFromState(rules);
    const selectedSet = new Set(selectedIndexes);
    const shouldBatch = isBatchMode && selectedIndexes.length > 1 && selectedSet.has(clickedIndex);
    return { isBatchMode, selectedIndexes, selectedSet, shouldBatch };
}

export function shouldBatchTransferRule(clickedIndex, rules) {
    if (!Number.isInteger(clickedIndex) || clickedIndex < 0 || clickedIndex >= rules.length) return false;
    return getBatchOperationContext(clickedIndex, rules).shouldBatch;
}

export function deleteSingleRule(rules, index) {
    const deletingRule = rules[index];
    if (!deletingRule) return false;
    const deletingId = ensureRuleObjectId(deletingRule);
    rules.splice(index, 1);
    rulesUiState.batchSelectedRuleIds = (rulesUiState.batchSelectedRuleIds || []).filter((id) => id !== deletingId);
    return true;
}

export function deleteSelectedRules(rules, selectedIndexes) {
    if (!Array.isArray(selectedIndexes) || selectedIndexes.length <= 1) return false;
    const deletingSet = new Set(selectedIndexes);
    const deletingIds = new Set(getRuleIdsByIndexes(rules, selectedIndexes));
    const nextRules = rules.filter((_, idx) => !deletingSet.has(idx));
    rules.splice(0, rules.length, ...nextRules);
    rulesUiState.batchSelectedRuleIds = (rulesUiState.batchSelectedRuleIds || []).filter((id) => !deletingIds.has(id));
    return true;
}

export function handleDeleteRule(index, rules) {
    if (shouldBatchTransferRule(index, rules)) {
        return deleteSelectedRules(rules, getSelectedIndexesFromState(rules));
    }
    return deleteSingleRule(rules, index);
}

export function renderTagsPreserveBatchSelection() {
    const shell = document.getElementById('blai-purifier-popup');
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest('#blai-home-rule-grid')) {
        activeElement.blur();
    }
    if (shell) shell.scrollTop = 0;
    renderTags();
    const { extension_settings } = getAppContext();
    applyBatchSelectionStateToDom(extension_settings[extensionName]?.rules || []);
    if (shell) {
        shell.scrollTop = 0;
        window.requestAnimationFrame(() => {
            if (shell.isConnected) shell.scrollTop = 0;
        });
    }
}

export function batchMoveRules(rules, selectedIndexes, direction) {
    if (selectedIndexes.length <= 1) return false;
    const selectedSet = new Set(selectedIndexes);
    const sorted = [...selectedIndexes].sort((a, b) => a - b);

    if (direction === 'up') {
        if (sorted[0] === 0) return false;
        for (let i = 0; i < sorted.length; i++) {
            const idx = sorted[i];
            const prev = idx - 1;
            if (prev >= 0 && !selectedSet.has(prev)) {
                [rules[prev], rules[idx]] = [rules[idx], rules[prev]];
                selectedSet.delete(idx);
                selectedSet.add(prev);
            }
        }
        return true;
    }

    if (direction === 'down') {
        if (sorted[sorted.length - 1] === rules.length - 1) return false;
        for (let i = sorted.length - 1; i >= 0; i--) {
            const idx = sorted[i];
            const next = idx + 1;
            if (next < rules.length && !selectedSet.has(next)) {
                [rules[idx], rules[next]] = [rules[next], rules[idx]];
                selectedSet.delete(idx);
                selectedSet.add(next);
            }
        }
        return true;
    }
    return false;
}

export function isSearchGroupEditFlow() {
    return rulesUiState.searchEditFlow.active === true && rulesUiState.searchEditFlow.returnMode === 'group';
}

export function isSearchDirectSubruleFlow() {
    return rulesUiState.searchEditFlow.active === true && rulesUiState.searchEditFlow.returnMode === 'subrule';
}

export function isRelatedDirectSubruleFlow() {
    return rulesUiState.searchEditFlow.active === true && rulesUiState.searchEditFlow.returnMode === 'related';
}

export function openRuleEditTarget(ruleIndex, subRuleIndex, returnMode) {
    openEditModal(ruleIndex, { source: 'search', returnMode, subRuleIndex });
    if (subRuleIndex >= 0 && returnMode !== 'group') {
        openSingleRuleModal(subRuleIndex, { hideEditModal: true });
    }
}

export function resetRuleSearchQueryState() {
    rulesUiState.ruleSearchKeyword = '';
    rulesUiState.ruleSearchDraftKeyword = '';
    rulesUiState.ruleSearchHasSearched = false;
    rulesUiState.ruleSearchExpandedMenuKey = '';
    clearRuleSearchEditFlow();
}

function submitRuleSearch() {
    rulesUiState.ruleSearchDraftKeyword = String($('#blai-rule-search-input').val() || '');
    rulesUiState.ruleSearchKeyword = rulesUiState.ruleSearchDraftKeyword.trim();
    rulesUiState.ruleSearchHasSearched = rulesUiState.ruleSearchKeyword.length > 0;
    rulesUiState.ruleSearchExpandedMenuKey = '';
    if (rulesUiState.ruleSearchHasSearched) pushRuleSearchHistory(rulesUiState.ruleSearchKeyword);
    renderRuleSearchModal();
}


export function commitRuleSearchKeyword() {
    const keyword = String($('#blai-rule-search-input').val() || '').trim();
    rulesUiState.ruleSearchKeyword = keyword;
    rulesUiState.ruleSearchHasSearched = keyword.length > 0;
    if (keyword) pushRuleSearchHistory(keyword);
    renderRuleSearchModal();
}

export function saveCurrentEditingRule(options = {}) {
    const {
        toastMessage = '合集保存成功',
        focusLatest = true,
    } = options;
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const rules = extension_settings[extensionName].rules || [];
    const isCreatingNewRule = rulesUiState.currentEditingIndex === -1;
    const nameVal = String($('#blai-edit-name').val() || '').trim();
    const validSubrules = rulesUiState.currentEditingSubrules.filter(sub => sub.targets && sub.targets.length > 0);

    if (validSubrules.length === 0) {
        showToast('合集内至少需要保留一组有效映射！');
        return { ok: false };
    }

    const previousRule = rulesUiState.currentEditingIndex !== -1 ? rules[rulesUiState.currentEditingIndex] : null;
    const isEnabled = previousRule?.enabled !== false;
    const activationWarning = getRuleActivationWarning(previousRule);
    const activationWarningEnabled = isRuleActivationWarningEnabled(previousRule);

    const fallbackName = rulesUiState.currentEditingIndex !== -1
        ? (rules[rulesUiState.currentEditingIndex]?.name || `合集 ${rulesUiState.currentEditingIndex + 1}`)
        : `合集 ${rules.length + 1}`;
    const newRule = normalizeRuleActivationSafety({
        name: nameVal || fallbackName,
        subRules: validSubrules,
        activationWarning,
        activationWarningEnabled,
        enabled: activationWarningEnabled ? false : isEnabled,
    });

    if (rulesUiState.currentEditingIndex === -1) rules.push(newRule);
    else rules[rulesUiState.currentEditingIndex] = newRule;

    markRulesDataDirty();
    saveSettingsDebounced();
    renderTags();
    if (isCreatingNewRule && focusLatest) {
        window.setTimeout(() => {
            focusLatestRuleCard();
        }, 50);
    }
    renderRuleSearchModal();
    if (toastMessage) showToast(toastMessage);
    return { ok: true, isCreatingNewRule, rule: newRule };
}

export function formatRegexTargetError(error) {
    return `第 ${error.line} 行：${error.message}`;
}

export function clearRegexTargetValidationState() {
    $('#blai-modal-sub-target').removeClass('blai-invalid').removeAttr('aria-invalid');
    $('#blai-modal-sub-target-error').removeClass('is-visible').text('');
}

function applyRegexTargetValidationError(error) {
    const message = formatRegexTargetError(error);
    $('#blai-modal-sub-target').addClass('blai-invalid').attr('aria-invalid', 'true');
    $('#blai-modal-sub-target-error').addClass('is-visible').text(message);
    return message;
}

export const subruleModeUIMap = {
    simple: {
        hint: '适合批量覆盖相近表达，支持 {} 组合和 * 通配。',
        targetPlaceholder: "简易语法 (每行一条)\n例如：{宛若,如同}{神明,恶魔}?",
        replacementPlaceholder: "替换后词汇（每行一条，支持随机，可留空）\n留空时，命中后会直接删除",
    },
    text: {
        hint: '按普通词组逐项替换，适合稳定短语，长词会优先处理。',
        targetPlaceholder: "被替换词汇 (逗号/空格分隔)\n例如：嘴角勾起, 并不存在",
        replacementPlaceholder: "替换后词汇（逗号/空格分隔，可留空）\n留空时，命中后会直接删除",
    },
    regex: {
        hint: '适合复杂匹配和捕获组替换；每次命中会从替换项里随机选一个。',
        targetPlaceholder: "正则匹配规则 (每行一条)\n支持裸模式 foo|bar 或 /foo|bar/gmu",
        replacementPlaceholder: "替换模板（每行一条，支持随机；可用 $1、\\n，可留空）\n点“按行识别”后加入下方替换项",
        regexEditPlaceholder: "正在编辑替换项；可用 $1、\\n\n点“更新替换项”保存修改",
    },
};

export function validateRegexTargetField(options = {}) {
    const mode = String($('#blai-modal-sub-mode').val() || '');
    if (mode !== 'regex') {
        clearRegexTargetValidationState();
        return { ok: true, parsed: [] };
    }

    const result = validateRegexTargetInput($('#blai-modal-sub-target').val());
    if (result.ok) {
        clearRegexTargetValidationState();
        return result;
    }

    const uiMessage = applyRegexTargetValidationError(result.error);
    if (options.focus === true) $('#blai-modal-sub-target').trigger('focus');
    if (options.toast === true) showToast(`正则规则有误：${uiMessage}`);
    return { ...result, uiMessage };
}

const REGEX_TEST_MAX_MATCHES = 30;
const REGEX_TEST_MAX_LINES = 20;

function isRegexHighlightEnabled() {
    const { extension_settings } = getAppContext();
    return extension_settings[extensionName]?.regexHighlightEnabled !== false;
}

export function syncRegexHighlightScroll() {
    const $input = $('#blai-modal-sub-target');
    const $preview = $('#blai-regex-target-highlight');
    if (!$input.length || !$preview.length) return;
    $preview.scrollTop($input.scrollTop());
    $preview.scrollLeft($input.scrollLeft());
}

function clearRegexHighlightOverlay() {
    $('#blai-regex-target-highlight').empty().prop('hidden', true);
    $('#blai-regex-input-wrap, .blai-regex-input-wrap').removeClass('is-highlighting');
}

export function renderRegexHighlightPreview() {
    const $preview = $('#blai-regex-target-highlight');
    if (!$preview.length) return;
    const $wrap = $preview.closest('.blai-regex-input-wrap');
    const html = isRegexHighlightEnabled() ? renderRegexHighlightHtml($('#blai-modal-sub-target').val()) : '';
    if (!html) {
        $preview.empty().prop('hidden', true);
        $wrap.removeClass('is-highlighting');
        return;
    }
    $preview.html(html).prop('hidden', false);
    $wrap.addClass('is-highlighting');
    syncRegexHighlightScroll();
}

export function syncRegexTestScroll() {
    const $input = $('#blai-regex-test-text');
    const $overlay = $('#blai-regex-test-highlight');
    if (!$input.length || !$overlay.length) return;
    $overlay.scrollTop($input.scrollTop());
    $overlay.scrollLeft($input.scrollLeft());
}

function setRegexTestStat(text, kind, title) {
    const $stat = $('#blai-regex-test-stat');
    if (!$stat.length) return;
    $stat.text(text).attr('title', title || '').removeClass('is-hit is-error').prop('hidden', !text);
    if (kind) $stat.addClass(kind);
}

function renderRegexTestOverlay(sample, matches) {
    const $overlay = $('#blai-regex-test-highlight');
    const $wrap = $('#blai-regex-test-input-wrap');
    const drawable = matches.filter((m) => m.end > m.start).sort((a, b) => a.start - b.start || b.end - a.end);
    if (!drawable.length) {
        $overlay.empty().prop('hidden', true);
        $wrap.removeClass('has-matches');
        return;
    }
    const merged = [];
    for (const match of drawable) {
        const last = merged[merged.length - 1];
        if (last && match.start <= last.end) last.end = Math.max(last.end, match.end);
        else merged.push({ start: match.start, end: match.end });
    }
    let html = '';
    let cursor = 0;
    for (const match of merged) {
        html += escapeRegexTestHtml(sample.slice(cursor, match.start));
        html += '<mark class="blai-regex-test-mark">' + escapeRegexTestHtml(sample.slice(match.start, match.end)) + '</mark>';
        cursor = match.end;
    }
    html += escapeRegexTestHtml(sample.slice(cursor));
    if (html.endsWith('\n')) html += ' ';
    $overlay.html(html).prop('hidden', false);
    $wrap.addClass('has-matches');
    syncRegexTestScroll();
}

export function runRegexTestPreview() {
    const $panel = $('#blai-regex-test-panel');
    if (!$panel.length || $panel.prop('hidden')) return;

    const sample = String($('#blai-regex-test-text').val() ?? '');
    if (!sample.trim()) {
        renderRegexTestOverlay(sample, []);
        setRegexTestStat('待输入样本', '', '粘贴样本后实时显示命中');
        return;
    }

    const lines = String($('#blai-modal-sub-target').val() ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, REGEX_TEST_MAX_LINES);

    if (!lines.length) {
        renderRegexTestOverlay(sample, []);
        setRegexTestStat('待填写查找', '', '先填写查找内容再测试');
        return;
    }

    const matches = [];
    let errors = 0;
    let valid = 0;
    let capped = false;
    for (const line of lines) {
        const compiled = compileRegexTarget(line);
        if (!compiled.ok) { errors += 1; continue; }
        valid += 1;
        const { regex } = compiled.value;
        let match;
        let count = 0;
        regex.lastIndex = 0;
        while (count < REGEX_TEST_MAX_MATCHES) {
            match = regex.exec(sample);
            if (!match) break;
            matches.push({ start: match.index, end: match.index + match[0].length });
            count += 1;
            if (match[0] === '') regex.lastIndex += 1;
        }
        if (count >= REGEX_TEST_MAX_MATCHES) capped = true;
    }

    renderRegexTestOverlay(sample, matches);
    if (errors) setRegexTestStat('正则错误 ' + errors, 'is-error', errors + ' 条正则无法编译');
    else if (matches.length) setRegexTestStat('命中 ' + matches.length + (capped ? '+' : ''), 'is-hit', valid + ' 条正则 / ' + matches.length + ' 处命中');
    else setRegexTestStat('未命中', '', valid + ' 条正则均未命中');
}

function escapeRegexTestHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function syncRegexAssistUi() {
    const isRegex = String($('#blai-modal-sub-mode').val() || '') === 'regex';
    $('#blai-regex-flags-hint').prop('hidden', !isRegex);
    $('#blai-regex-test-block').prop('hidden', !isRegex);
    $('#blai-regex-highlight-switch').prop('hidden', !isRegex);
    $('#blai-regex-highlight-toggle').prop('checked', isRegexHighlightEnabled()).prop('disabled', !isRegex);
    if (!isRegex) {
        clearRegexHighlightOverlay();
        renderRegexTestOverlay('', []);
        setRegexTestStat('', '', '');
        return;
    }
    renderRegexHighlightPreview();
    runRegexTestPreview();
}

