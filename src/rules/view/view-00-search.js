/** view 的分块：search。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { safeHtml } from '../../ui/html.js';
import { rulesUiState } from '../state.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { showAlertModal } from '../../ui/notifications.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';
import { fadeOutThen } from '../../ui/motion.js';

export function formatReplacementCandidatePreview(value) {
    const normalized = String(value ?? '').replace(/\r/g, '');
    return normalized ? safeHtml(normalized).replace(/\n/g, ' ↵ ') : '【直接删除】';
}

export function getRewriteMode(sub) {
    return sub?.rewriteMode === 'ai' ? 'ai' : 'program';
}

export function normalizeReplacementList(replacements) {
    return Array.isArray(replacements) ? replacements.map((value) => String(value ?? '')) : [];
}

export function getRulePreviewTagText(mode = 'text') {
    if (mode === 'regex') return '正则';
    if (mode === 'simple') return '简易';
    return '文本';
}

export function getRuleSourcePreviewText(sub = {}) {
    const mode = sub.mode || 'text';
    return safeHtml((sub.targets || []).join(mode === 'text' ? ', ' : ' | ')) || '（空）';
}

function getRuleSearchMenuKey(ruleIndex, subRuleIndex) {
    return `${ruleIndex}:${subRuleIndex}`;
}

function buildRuleSearchHaystack(sub = {}) {
    const mode = sub.mode || 'text';
    const targets = Array.isArray(sub.targets) ? sub.targets.join(mode === 'text' ? ' ' : '\n') : '';
    const replacements = Array.isArray(sub.replacements) ? sub.replacements.join('\n') : '';
    const remark = String(sub.remark || '');
    return `${targets}\n${replacements}\n${remark}`.toLowerCase();
}

export function getRegexReplacementEditIndex() {
    const rawIndex = Number($('#blai-modal-sub-rep').data('regex-edit-index'));
    return Number.isInteger(rawIndex) ? rawIndex : -1;
}

export function getRegexReplacementChipValues() {
    return $('#blai-modal-sub-regex-list').children('.blai-regex-replacement-chip').map(function() {
        return String($(this).data('value') ?? '');
    }).get();
}

export function clearRuleSearchEditFlow() {
    rulesUiState.searchEditFlow.active = false;
    rulesUiState.searchEditFlow.returnMode = '';
    rulesUiState.searchEditFlow.ruleIndex = -1;
    rulesUiState.searchEditFlow.subRuleIndex = -1;
}

export function syncRuleSearchInputUi(options = {}) {
    const { syncValue = false } = options;
    const draftKeyword = String(rulesUiState.ruleSearchDraftKeyword || '');
    const $input = $('#blai-rule-search-input');
    const $field = $input.closest('.blai-rule-search-field');
    const $clear = $('#blai-rule-search-clear');
    if (syncValue && $input.length) $input.val(draftKeyword);
    const hasValue = draftKeyword.length > 0;
    $field.toggleClass('has-value', hasValue);
    $clear.prop('hidden', !hasValue).toggleClass('is-visible', hasValue);
}

export const RULE_SEARCH_HISTORY_LIMIT = 10;

const RULE_SEARCH_HISTORY_STORAGE_KEY = 'blai-rule-search-history';

export const RULE_EDIT_FILTER_LABELS = {
    all: '全部',
    ai: 'AI 改写',
    program: '程序改写',
};

// 菜单打开时会被移到 body（逃出卡片 overflow: hidden），此时 closest('.blai-edit-filter-wrap') 找不到它，
// 所以按 id 取 —— 元素本身没变，只是换了父节点。
function getRuleEditFilterMenuElement() {
    return document.getElementById('blai-edit-filter-menu');
}

export function syncRuleEditFilterUi() {
    const filter = rulesUiState.currentEditingFilter || 'all';
    const $trigger = $('#blai-edit-filter');
    if (!$trigger.length) return;
    $trigger.find('.blai-edit-filter-label').text(RULE_EDIT_FILTER_LABELS[filter] || RULE_EDIT_FILTER_LABELS.all);
    $trigger.toggleClass('is-filtered', filter !== 'all');
    const menu = getRuleEditFilterMenuElement();
    if (!menu) return;
    $(menu).find('.blai-edit-filter-item').each(function syncFilterItem() {
        const isActive = String($(this).attr('data-filter') || '') === filter;
        $(this).toggleClass('is-active', isActive).attr('aria-current', isActive ? 'true' : 'false');
    });
}

// 筛选菜单与「⋯」菜单共用 body 级浮层定位：modal 卡片有 overflow: hidden，原生下拉会被裁掉。
// 开关状态只认菜单自身的 hidden 属性 —— 浮层被外部点击关掉时 closeMenuPopover 会把它重新隐藏。
export function getRuleEditFilterMenu() {
    const $trigger = $('#blai-edit-filter');
    if (!$trigger.length) return null;
    const menu = getRuleEditFilterMenuElement();
    return menu ? { trigger: $trigger.get(0), menu } : null;
}

export function closeRuleEditFilterMenu() {
    const target = getRuleEditFilterMenu();
    if (!target) return;
    closeMenuPopover(target.menu);
    target.menu.setAttribute('hidden', '');
    $('#blai-edit-filter').attr('aria-expanded', 'false');
}

export function toggleRuleEditFilterMenu() {
    const target = getRuleEditFilterMenu();
    if (!target) return;
    if (!target.menu.hasAttribute('hidden')) {
        closeRuleEditFilterMenu();
        return;
    }
    target.menu.removeAttribute('hidden');
    $('#blai-edit-filter').attr('aria-expanded', 'true');
    openMenuPopover(target.trigger, target.menu);
}

export function getRuleSearchScopeEmptyHint() {
    const scope = rulesUiState.ruleSearchScope || 'all';
    if (scope === 'rule' || scope === 'preset') return '当前只在规则条目的查找词、替换词与备注里查找';
    if (scope === 'group') return '当前只在分组名称里查找';
    return '当前搜索分组名称、查找词、替换词与备注';
}

export function syncRuleSearchScopeUi() {
    const scope = rulesUiState.ruleSearchScope || 'all';
    $('#blai-rule-search-scope .blai-rule-search-scope-item').each(function syncScopeItem() {
        const itemScope = String($(this).attr('data-scope') || 'all');
        const isActive = itemScope === scope;
        $(this).toggleClass('is-active', isActive).attr('aria-pressed', String(isActive));
    });
}

export function focusLatestRuleCard() {
    const container = document.getElementById('blai-home-rule-grid');
    if (!container) return;

    const cards = container.querySelectorAll('.blai-home-card');
    const latestCard = cards[cards.length - 1];
    if (!latestCard) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = latestCard.getBoundingClientRect();
    const isVisible = cardRect.top >= containerRect.top && cardRect.bottom <= containerRect.bottom;

    if (!isVisible) {
        latestCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    latestCard.classList.remove('blai-highlight-flash');
    void latestCard.offsetWidth;
    latestCard.classList.add('blai-highlight-flash');

    window.setTimeout(() => {
        latestCard.classList.remove('blai-highlight-flash');
    }, 1600);
}

/**
 * 打开规则分组转移弹窗。mode 为 'copy' / 'move' 时只留对应动作按钮，
 * 批量面板已经把复制与移动拆成两个入口；不传时仍保留原来的双按钮（规则卡菜单）。
 */
export function openTransferModal(ruleIndexOrIndexes, mode = '') {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const presets = settings?.presets || {};
    const currentPreset = settings?.activePreset || "";
    const targetNames = Object.keys(presets).filter(name => name !== currentPreset);
    if (targetNames.length === 0) {
        showAlertModal('没有可用的目标存档。请先创建至少一个其他存档。');
        return;
    }

    const indexes = Array.isArray(ruleIndexOrIndexes) ? ruleIndexOrIndexes : [ruleIndexOrIndexes];
    rulesUiState.currentTransferRuleIndexes = indexes
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0);
    const $select = $('#blai-transfer-target');
    $select.html(targetNames.map((name) => `<option value="${safeHtml(name)}">${safeHtml(name)}</option>`).join(''));
    const isCopy = mode === 'copy';
    const isMove = mode === 'move';
    $('#blai-transfer-title-text').text(isCopy ? '复制规则分组' : isMove ? '移动规则分组' : '复制或移动规则分组');
    $('#blai-transfer-copy').toggle(!isMove);
    $('#blai-transfer-move').toggle(!isCopy);
    $('#blai-rule-transfer-modal').css('display', 'flex');
}

export function closeTransferModal() {
    rulesUiState.currentTransferRuleIndexes = [];
    const $modal = $('#blai-rule-transfer-modal');
    fadeOutThen($modal, () => $modal.hide());
}

let activeSearchMenu = null;

export function closeRuleSearchPopover() {
    if (!activeSearchMenu) return;
    closeMenuPopover(activeSearchMenu);
    activeSearchMenu = null;
}

export function mountRuleSearchMenu() {
    const expandedKey = String(rulesUiState.ruleSearchExpandedMenuKey || '');
    if (!expandedKey) return;
    const $toggle = $('#blai-rule-search-body .blai-rule-search-menu-toggle').filter(function filterByKey() {
        return String($(this).attr('data-key') || '') === expandedKey;
    });
    if (!$toggle.length) return;
    const $menu = $toggle.closest('.blai-rule-search-menu-wrap').find('.blai-rule-search-menu');
    if (!$menu.length) return;
    activeSearchMenu = $menu.get(0);
    openMenuPopover($toggle.get(0), activeSearchMenu);
}

export function formatReplacementPreview(replacements, mode = 'text') {
    if (!Array.isArray(replacements) || replacements.length === 0) return '【直接删除】';
    if (mode === 'regex') {
        return replacements.map((value) => `〔${formatReplacementCandidatePreview(value)}〕`).join(' / ');
    }
    return replacements.map(formatReplacementCandidatePreview).join(', ');
}

export function buildRuleSearchResults(keyword, scope = 'all') {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) return [];

    const { extension_settings } = getAppContext();
    const rules = extension_settings?.[extensionName]?.rules || [];
    const normalizedScope = scope === 'preset' ? 'rule' : scope;
    const searchGroups = normalizedScope !== 'rule';
    const searchEntries = normalizedScope !== 'group';
    const results = [];

    rules.forEach((rule, ruleIndex) => {
        const groupTitle = safeHtml(rule.name || `未命名规则分组 ${ruleIndex + 1}`);
        const subRules = rule.subRules || [];
        if (searchGroups && String(rule.name || '').toLowerCase().includes(normalizedKeyword)) {
            results.push({
                key: `g:${ruleIndex}`,
                kind: 'group',
                ruleIndex,
                subRuleIndex: -1,
                groupName: groupTitle,
                tagText: '分组',
                sourcePreview: groupTitle,
                replacementPreview: `${subRules.length} 条映射`,
                isEnabled: rule.enabled !== false,
            });
        }
        if (!searchEntries) return;
        subRules.forEach((sub, subRuleIndex) => {
            if (!buildRuleSearchHaystack(sub).includes(normalizedKeyword)) return;
            const mode = sub.mode || 'text';
            results.push({
                key: getRuleSearchMenuKey(ruleIndex, subRuleIndex),
                kind: 'entry',
                ruleIndex,
                subRuleIndex,
                groupName: groupTitle,
                tagText: getRulePreviewTagText(mode),
                sourcePreview: getRuleSourcePreviewText(sub),
                replacementPreview: formatReplacementPreview(sub.replacements || [], mode),
                isEnabled: rule.enabled !== false && sub.enabled !== false,
            });
        });
    });

    return results;
}

function buildRegexReplacementChip(value = '') {
    const normalizedValue = String(value ?? '');
    const preview = formatReplacementCandidatePreview(normalizedValue);
    const $chip = $(`
        <div class="blai-regex-replacement-chip" data-index="0">
            <button type="button" class="blai-regex-replacement-chip-main" data-index="0" title="点击编辑替换项"></button>
            <button type="button" class="blai-regex-replacement-chip-remove" data-index="0" title="删除替换项">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `);
    $chip.data('value', normalizedValue);
    $chip.find('.blai-regex-replacement-chip-main').html(preview).attr('title', normalizedValue || '点击编辑替换项');
    return $chip;
}

export function syncRegexReplacementInputState() {
    const $container = $('#blai-modal-sub-regex-list');
    const $textarea = $('#blai-modal-sub-rep');
    $container.children('.blai-regex-replacement-empty').remove();
    const $items = $container.children('.blai-regex-replacement-chip');
    let editIndex = getRegexReplacementEditIndex();
    if (editIndex >= $items.length) {
        editIndex = -1;
        $textarea.data('regex-edit-index', -1);
    }
    $items.each((index, element) => {
        const $element = $(element);
        $element.attr('data-index', index);
        $element.toggleClass('is-active', index === editIndex);
        $element.find('.blai-regex-replacement-chip-main').attr('data-index', index);
        $element.find('.blai-regex-replacement-chip-remove').attr('data-index', index);
    });
    const isEditing = editIndex >= 0;
    const defaultPlaceholder = String($textarea.data('regex-default-placeholder') || '');
    const editPlaceholder = String($textarea.data('regex-edit-placeholder') || defaultPlaceholder);
    const isRegexEditorVisible = !$('#blai-modal-sub-regex-actions').prop('hidden');
    if ($items.length === 0 && isRegexEditorVisible) {
        $container.append(`
            <div class="blai-regex-replacement-empty" aria-live="polite">
                <i class="fas fa-eraser"></i>
                <span>未添加替换项，命中后将直接删除。</span>
            </div>
        `);
    }
    $container.prop('hidden', $items.length === 0 && !isRegexEditorVisible);
    $('#blai-modal-sub-regex-recognize').text(isEditing ? '更新替换项' : '识别为替换项');
    $textarea.attr('placeholder', isEditing ? editPlaceholder : defaultPlaceholder);
}

export function appendRegexReplacementInputs(values = [], options = {}) {
    const normalizedValues = normalizeReplacementList(values);
    const { sync = true } = options;
    if (normalizedValues.length === 0) return $();

    const $container = $('#blai-modal-sub-regex-list');
    const fragment = document.createDocumentFragment();
    const nodes = [];
    normalizedValues.forEach((value) => {
        const node = buildRegexReplacementChip(value)[0];
        nodes.push(node);
        fragment.appendChild(node);
    });
    $container.append(fragment);
    if (sync) syncRegexReplacementInputState();
    return $(nodes);
}

export function resetRuleSearchState() {
    rulesUiState.ruleSearchKeyword = '';
    rulesUiState.ruleSearchDraftKeyword = '';
    rulesUiState.ruleSearchHasSearched = false;
    rulesUiState.ruleSearchExpandedMenuKey = '';
    rulesUiState.ruleSearchHistorySessionOpen = false;
    rulesUiState.ruleSearchLastInputAt = 0;
    clearRuleSearchEditFlow();
}

export function normalizeRuleSearchHistory(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const output = [];
    list.forEach((raw) => {
        const keyword = String(raw || '').trim();
        if (!keyword || seen.has(keyword)) return;
        seen.add(keyword);
        output.push(keyword);
    });
    return output.slice(0, RULE_SEARCH_HISTORY_LIMIT);
}

function readStoredRuleSearchHistory() {
    try {
        const raw = window.localStorage?.getItem(RULE_SEARCH_HISTORY_STORAGE_KEY);
        if (!raw) return [];
        return normalizeRuleSearchHistory(JSON.parse(raw));
    } catch {
        return [];
    }
}

function writeStoredRuleSearchHistory(list) {
    try {
        window.localStorage?.setItem(RULE_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(normalizeRuleSearchHistory(list)));
    } catch {
        /* 隐私模式下写入失败时只保留内存态 */
    }
}

export function hydrateRuleSearchHistory() {
    rulesUiState.ruleSearchHistory = readStoredRuleSearchHistory();
    return rulesUiState.ruleSearchHistory;
}

export function pushRuleSearchHistory(keyword, options = {}) {
    const { replaceLatest = false } = options;
    const nextKeyword = String(keyword || '').trim();
    if (!nextKeyword) return;
    const current = normalizeRuleSearchHistory(rulesUiState.ruleSearchHistory);
    // 同一轮输入的中间态只替换刚写入的那条，不新增历史项。
    const base = replaceLatest ? current.slice(1) : current;
    rulesUiState.ruleSearchHistory = [nextKeyword, ...base.filter((item) => item !== nextKeyword)]
        .slice(0, RULE_SEARCH_HISTORY_LIMIT);
    writeStoredRuleSearchHistory(rulesUiState.ruleSearchHistory);
}

export function removeRuleSearchHistoryItem(keyword) {
    const target = String(keyword || '').trim();
    if (!target) return;
    rulesUiState.ruleSearchHistory = normalizeRuleSearchHistory(rulesUiState.ruleSearchHistory)
        .filter((item) => item !== target);
    writeStoredRuleSearchHistory(rulesUiState.ruleSearchHistory);
}

export function clearRuleSearchHistory() {
    rulesUiState.ruleSearchHistory = [];
    writeStoredRuleSearchHistory([]);
}

export function renderRuleSearchHistoryHtml() {
    const history = normalizeRuleSearchHistory(rulesUiState.ruleSearchHistory);
    if (history.length === 0) return '';
    const chips = history.map((keyword) => `
        <span class="blai-rule-search-history-chip">
            <button type="button" class="blai-rule-search-history-item" data-keyword="${safeHtml(keyword)}">${safeHtml(keyword)}</button>
            <button type="button" class="blai-rule-search-history-remove" data-keyword="${safeHtml(keyword)}" title="移除这条记录" aria-label="移除搜索记录"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        </span>`).join('');
    return `
        <div class="blai-rule-search-history">
            <div class="blai-rule-search-history-head">
                <span>最近搜索</span>
                <button type="button" id="blai-rule-search-history-clear" class="blai-rule-search-history-clear">全部清除</button>
            </div>
            <div class="blai-rule-search-history-list">${chips}</div>
        </div>`;
}
