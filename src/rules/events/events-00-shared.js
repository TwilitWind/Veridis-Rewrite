/** 规则事件：ruleObjectIdMap / 搜索防抖 / 批量与转移辅助。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '.././state.js';
import { getRuleActivationWarning, isRuleActivationWarningEnabled, normalizeRuleActivationSafety } from '.././model.js';
import { compileRegexTarget, validateRegexTargetInput } from '.././regex.js';
import { findBracketPairAt, renderRegexHighlightHtml, renderSimpleHighlightHtml } from '.././regexHighlight.js';
import { buildSimpleTargetPattern, buildTargetLiteralPattern } from '../engine/engine-00-patterns.js';
import { parseInputToWords } from '.././model.js';
import { showConfirmModal, showToast } from '../../ui/notifications.js';
import { clearRuleSearchEditFlow, pushRuleSearchHistory, focusLatestRuleCard, openEditModal, openSingleRuleModal, renderRuleSearchModal, renderTags } from '.././view.js';

const ruleObjectIdMap = new WeakMap();
let nextRuleObjectId = 1;

// 同一轮连续输入的历史合并窗口：超过这个间隔就视为新的一次搜索。
const RULE_SEARCH_HISTORY_SESSION_GAP_MS = 1500;

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

/** 删除规则分组的唯一编排：确认文案、批量计数、写回与 toast 都在这里，卡片菜单与列表按钮共用。 */
export async function deleteRulesWithConfirm(index, rules) {
    if (!await showConfirmModal('确定要删除这个规则分组吗？删除后无法恢复。', { danger: true, okText: '删除' })) return false;
    const deletingCount = shouldBatchTransferRule(index, rules) ? getSelectedIndexesFromState(rules).length : 1;
    if (!handleDeleteRule(index, rules)) return false;
    markRulesDataDirty();
    getAppContext().saveSettingsDebounced();
    renderTagsPreserveBatchSelection();
    showToast(deletingCount > 1 ? `已删除 ${deletingCount} 个规则` : '已删除规则', undefined, 'success');
    return true;
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
    rulesUiState.ruleSearchHistorySessionOpen = false;
    rulesUiState.ruleSearchLastInputAt = 0;
    clearRuleSearchEditFlow();
}

// 每次输入都打点；间隔超过窗口就视为新搜索，避免把两次独立搜索合并。
export function noteRuleSearchInput() {
    const now = Date.now();
    const last = rulesUiState.ruleSearchLastInputAt || 0;
    if (!last || now - last > RULE_SEARCH_HISTORY_SESSION_GAP_MS) {
        rulesUiState.ruleSearchHistorySessionOpen = false;
    }
    rulesUiState.ruleSearchLastInputAt = now;
}

export function commitRuleSearchKeyword(options = {}) {
    const { recordHistory = true, endSession = false } = options;
    const keyword = String($('#blai-rule-search-input').val() || '').trim();
    rulesUiState.ruleSearchKeyword = keyword;
    rulesUiState.ruleSearchHasSearched = keyword.length > 0;
    if (recordHistory && keyword) {
        // 同一轮输入只替换刚写入的中间词，最终结果留在历史里；不依赖 Enter，手机端也可用。
        pushRuleSearchHistory(keyword, { replaceLatest: rulesUiState.ruleSearchHistorySessionOpen });
        rulesUiState.ruleSearchHistorySessionOpen = true;
    }
    if (endSession) {
        rulesUiState.ruleSearchHistorySessionOpen = false;
        rulesUiState.ruleSearchLastInputAt = 0;
    }
    renderRuleSearchModal();
}

export function saveCurrentEditingRule(options = {}) {
    const {
        toastMessage = '已保存规则分组',
        toastType = 'success',
        focusLatest = true,
    } = options;
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const rules = extension_settings[extensionName].rules || [];
    const isCreatingNewRule = rulesUiState.currentEditingIndex === -1;
    const nameVal = String($('#blai-edit-name').val() || '').trim();
    const allSubrules = Array.isArray(rulesUiState.currentEditingSubrules) ? rulesUiState.currentEditingSubrules : [];
    const emptyIndex = allSubrules.findIndex(sub => !Array.isArray(sub?.targets) || sub.targets.length === 0);

    if (emptyIndex >= 0) {
        showToast(`第 ${emptyIndex + 1} 条规则未填写查找内容，请补全或删除后再保存。`, undefined, 'error');
        return { ok: false };
    }
    if (allSubrules.length === 0) {
        showToast('规则分组至少需要一条填写了查找内容的规则。', undefined, 'error');
        return { ok: false };
    }
    const subrulesToSave = allSubrules;

    const previousRule = rulesUiState.currentEditingIndex !== -1 ? rules[rulesUiState.currentEditingIndex] : null;
    const isEnabled = previousRule?.enabled !== false;
    const activationWarning = getRuleActivationWarning(previousRule);
    const activationWarningEnabled = isRuleActivationWarningEnabled(previousRule);

    const fallbackName = rulesUiState.currentEditingIndex !== -1
        ? (rules[rulesUiState.currentEditingIndex]?.name || `规则分组 ${rulesUiState.currentEditingIndex + 1}`)
        : `规则分组 ${rules.length + 1}`;
    const newRule = normalizeRuleActivationSafety({
        name: nameVal || fallbackName,
        subRules: subrulesToSave,
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
    if (toastMessage) showToast(toastMessage, undefined, toastType);
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
        hint: '适合批量替换相近表达，支持 {} 组合和 * 通配。',
        targetPlaceholder: "简易组合（每行一条）\n例如：{宛若,如同}{神明,恶魔}?",
        replacementPlaceholder: "替换内容（每行一条；可写多项，随机使用）\n留空时，命中内容会被删除",
    },
    text: {
        hint: '适合替换固定短语；长词会优先匹配。',
        targetPlaceholder: "普通文本（用逗号或空格分隔）\n例如：嘴角勾起, 并不存在",
        replacementPlaceholder: "替换内容（用逗号或空格分隔；可写多项，随机使用）\n留空时，命中内容会被删除",
    },
    regex: {
        hint: '适合复杂匹配和捕获组替换；每次命中随机使用一个替换项。',
        targetPlaceholder: "正则表达式（每行一条）\n支持 foo|bar 或 /foo|bar/gmu",
        replacementPlaceholder: "替换内容（每行一条；支持 $1、\\n，可写多项随机使用）\n点「识别为替换项」后加入下方替换项",
        regexEditPlaceholder: "正在编辑替换项；支持 $1、\\n\n点「更新替换项」保存修改",
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
    if (options.toast === true) showToast(`正则写法有误：${uiMessage}`, undefined, 'error');
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

let activeBracketPairKey = '';

export function renderRegexHighlightPreview(pairRange = null) {
    const $preview = $('#blai-regex-target-highlight');
    if (!$preview.length) return;
    const $wrap = $preview.closest('.blai-regex-input-wrap');
    const mode = String($('#blai-modal-sub-mode').val() || 'simple');
    // 普通文本没有语法符号，即便开关开着也不着色（开关本身仍显示，见 syncRegexAssistUi）。
    const source = $('#blai-modal-sub-target').val();
    let html = '';
    if (isRegexHighlightEnabled() && (mode === 'regex' || mode === 'simple')) {
        html = mode === 'regex'
            ? renderRegexHighlightHtml(source, pairRange)
            : renderSimpleHighlightHtml(source, pairRange);
    }
    activeBracketPairKey = pairRange ? pairRange.start + '-' + pairRange.end : '';
    if (!html) {
        $preview.empty().prop('hidden', true);
        $wrap.removeClass('is-highlighting');
        return;
    }
    $preview.html(html).prop('hidden', false);
    $wrap.addClass('is-highlighting');
    syncRegexHighlightScroll();
}

/** 光标贴着括号时给整对闭合范围加底纹；只在范围真的变化时才重绘高亮层。
    只在真实的 click/keyup/select 里调用：打开弹窗时 `.val()` 会把光标留在开头符号上，
    若此时调用会被误判成「光标贴着括号」而自动高亮。 */
export function syncRegexBracketPairHighlight() {
    const $input = $('#blai-modal-sub-target');
    const $preview = $('#blai-regex-target-highlight');
    if (!$input.length || !$preview.length || $preview.prop('hidden')) return;
    const caret = Number($input.get(0)?.selectionStart ?? 0);
    const pair = findBracketPairAt($input.val(), caret);
    const key = pair ? pair.start + '-' + pair.end : '';
    if (key === activeBracketPairKey) return;
    renderRegexHighlightPreview(pair);
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

/**
 * 按当前语法模式把查找内容编译成一组「字面区间」匹配器。
 * regex 走 compileRegexTarget；simple 走通配符模式；text 走逗号/空格分词 + 字面转义。
 */
function buildTestMatchers(mode, lines) {
    const matchers = [];
    if (mode === 'text') {
        const words = parseInputToWords(lines.join(' '), 'text').slice(0, REGEX_TEST_MAX_LINES);
        for (const word of words) {
            const pattern = buildTargetLiteralPattern(word);
            try {
                matchers.push(new RegExp(pattern, 'gmu'));
            } catch (e) {
                // 字面转义理论上不会产生非法正则，忽略即可
            }
        }
        return { matchers, errors: 0 };
    }
    for (const line of lines) {
        if (mode === 'simple') {
            try {
                matchers.push(new RegExp(buildSimpleTargetPattern(line), 'gmu'));
            } catch (e) {
                // 简易模式由安全转义拼装，异常概率极低
            }
            continue;
        }
        const compiled = compileRegexTarget(line);
        if (!compiled.ok) continue;
        matchers.push(compiled.value.regex);
    }
    return { matchers, errors: 0 };
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

    const mode = String($('#blai-modal-sub-mode').val() || 'simple');
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

    const { matchers } = buildTestMatchers(mode, lines);
    const matches = [];
    let capped = false;
    for (const regex of matchers) {
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
    if (matches.length) setRegexTestStat('命中 ' + matches.length + (capped ? '+' : ''), 'is-hit', matchers.length + ' 条规则 / ' + matches.length + ' 处命中');
    else setRegexTestStat('未命中', '', matchers.length + ' 条规则均未命中');
}

export function clearRegexTestArea() {
    $('#blai-regex-test-text').val('');
    renderRegexTestOverlay('', []);
    setRegexTestStat('', '', '');
}

function escapeRegexTestHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function syncRegexAssistUi() {
    const mode = String($('#blai-modal-sub-mode').val() || 'simple');
    $('#blai-regex-flags-hint').prop('hidden', mode !== 'regex');
    // 测试区与代码高亮开关三个模式都显示；开关状态由各自 setter 记忆，不随模式重置。
    $('#blai-regex-test-block').prop('hidden', false);
    $('#blai-regex-highlight-switch').prop('hidden', false);
    $('#blai-regex-highlight-toggle').prop('checked', isRegexHighlightEnabled()).prop('disabled', false);
    // 打开/切模式时先清掉配对底纹：此时光标是浏览器默认位置，贴到开头符号上并非用户意图。
    activeBracketPairKey = '';
    renderRegexHighlightPreview();
    runRegexTestPreview();
}

