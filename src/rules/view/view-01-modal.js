/** view 的分块：modal。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { rulesUiState, markRulesUiDirty } from '../state.js';
import { closeMenuPopover } from '../../ui/popover.js';
import { parseInputToWords, isRuleActivationWarningEnabled } from '../model.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { safeHtml } from '../../ui/html.js';
import { buildRuleSearchResults, syncRuleSearchInputUi, renderRuleSearchHistoryHtml, getRuleSearchScopeEmptyHint, syncRuleSearchScopeUi, closeRuleSearchPopover, mountRuleSearchMenu, hydrateRuleSearchHistory, resetRuleSearchState, getRegexReplacementEditIndex, syncRegexReplacementInputState, getRegexReplacementChipValues, formatReplacementCandidatePreview, appendRegexReplacementInputs, normalizeReplacementList, formatReplacementPreview, getRewriteMode, getRulePreviewTagText, getRuleSourcePreviewText } from './view-00-search.js';

export function renderRuleSearchModal() {
    const $body = $('#blai-rule-search-body');
    if (!$body.length) return;
    closeRuleSearchPopover();

    const keyword = String(rulesUiState.ruleSearchKeyword || '').trim();
    syncRuleSearchInputUi();
    syncRuleSearchScopeUi();

    if (!rulesUiState.ruleSearchHasSearched || !keyword) {
        $body.html(`${renderRuleSearchHistoryHtml()}
            <div class="blai-rule-search-empty">
                <div class="blai-rule-search-empty-icon"><i class="fas fa-magnifying-glass"></i></div>
                <div class="blai-rule-search-empty-title">边打字边搜索</div>
                <div class="blai-rule-search-empty-text">输入关键词后会立即在下方列出匹配规则</div>
            </div>
        `);
        return;
    }

    const results = buildRuleSearchResults(keyword, rulesUiState.ruleSearchScope || 'all');
    if (results.length === 0) {
        $body.html(`
            <div class="blai-rule-search-empty">
                <div class="blai-rule-search-empty-icon"><i class="fas fa-circle-info"></i></div>
                <div class="blai-rule-search-empty-title">未找到匹配规则</div>
                <div class="blai-rule-search-empty-text">${getRuleSearchScopeEmptyHint()}</div>
            </div>
        `);
        return;
    }

    const html = results.map((item) => {
        const entryMenuItem = item.kind === 'group'
            ? ''
            : `
                    <button type="button" class="blai-rule-search-menu-item" data-action="subrule" data-rule-index="${item.ruleIndex}" data-subrule-index="${item.subRuleIndex}">
                        编辑条目
                    </button>
            `;
        const menuHtml = rulesUiState.ruleSearchExpandedMenuKey === item.key
            ? `
                <div class="blai-rule-search-menu">
                    <button type="button" class="blai-rule-search-menu-item" data-action="group" data-rule-index="${item.ruleIndex}" data-subrule-index="${item.subRuleIndex}">
                        分组详情
                    </button>
                    ${entryMenuItem}
                </div>
            `
            : '';

        return `
            <div class="blai-rule-search-result-card ${item.isEnabled ? '' : 'blai-is-disabled'}" data-rule-index="${item.ruleIndex}" data-subrule-index="${item.subRuleIndex}">
                <div class="blai-rule-search-result-head">
                    <div class="blai-rule-search-result-group">
                        <i class="fas fa-folder-open"></i>
                        所属分组：${item.groupName}
                    </div>
                    <div class="blai-rule-search-menu-wrap">
                        <button type="button" class="blai-icon-btn blai-rule-search-menu-toggle" data-key="${item.key}" title="更多操作">
                            <i class="fas fa-ellipsis"></i>
                        </button>
                        ${menuHtml}
                    </div>
                </div>
                <div class="blai-rule-search-result-preview">
                    <span class="blai-tag">${item.tagText}</span>
                    <span class="blai-source">${item.sourcePreview}</span>
                    <i class="fas fa-arrow-right blai-arrow"></i>
                    <span class="blai-target">${item.replacementPreview}</span>
                </div>
            </div>
        `;
    }).join('');

    $body.html(`<div class="blai-rule-search-results">${html}</div>`);
    mountRuleSearchMenu();
}

export function openRuleSearchModal() {
    const activeCardMenu = document.getElementById('blai-rule-card-menu-active');
    if (activeCardMenu) {
        activeCardMenu.id = '';
        activeCardMenu.setAttribute('hidden', '');
        closeMenuPopover(activeCardMenu);
    }
    $('.blai-home-card-menu-toggle').attr('aria-expanded', 'false');
    hydrateRuleSearchHistory();
    syncRuleSearchInputUi({ syncValue: true });
    renderRuleSearchModal();
    $('#blai-rule-search-modal').css('display', 'flex').hide().fadeIn(150);
    window.setTimeout(() => {
        $('#blai-rule-search-input').trigger('focus');
    }, 20);
}

export function closeRuleSearchModal(options = {}) {
    closeRuleSearchPopover();
    const { reset = false } = options;
    if (reset) {
        resetRuleSearchState();
        syncRuleSearchInputUi({ syncValue: true });
        renderRuleSearchModal();
    }
    $('#blai-rule-search-modal').fadeOut(150);
}

export function removeRegexReplacementInput(index) {
    const normalizedIndex = Number(index);
    const $items = $('#blai-modal-sub-regex-list').children('.blai-regex-replacement-chip');
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= $items.length) return;
    const currentEditIndex = getRegexReplacementEditIndex();
    $items.eq(normalizedIndex).remove();
    if (currentEditIndex === normalizedIndex) {
        $('#blai-modal-sub-rep').data('regex-edit-index', -1);
    } else if (currentEditIndex > normalizedIndex) {
        $('#blai-modal-sub-rep').data('regex-edit-index', currentEditIndex - 1);
    }
    syncRegexReplacementInputState();
}

export function startEditingRegexReplacementInput(index) {
    const normalizedIndex = Number(index);
    const values = getRegexReplacementChipValues();
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= values.length) return false;
    $('#blai-modal-sub-rep').val(values[normalizedIndex]).data('regex-edit-index', normalizedIndex);
    syncRegexReplacementInputState();
    return true;
}

export function recognizeRegexReplacementInput() {
    const $textarea = $('#blai-modal-sub-rep');
    const draft = String($textarea.val() ?? '');
    if (draft.trim() === '') return { ok: false, reason: 'empty' };

    const editIndex = getRegexReplacementEditIndex();
    const $items = $('#blai-modal-sub-regex-list').children('.blai-regex-replacement-chip');
    if (editIndex >= 0 && editIndex < $items.length) {
        const $item = $items.eq(editIndex);
        $item.data('value', draft);
        $item.find('.blai-regex-replacement-chip-main')
            .html(formatReplacementCandidatePreview(draft))
            .attr('title', draft || '点击编辑替换项');
        $textarea.val('').data('regex-edit-index', -1);
        syncRegexReplacementInputState();
        return { ok: true, mode: 'update' };
    }

    const lines = draft.replace(/\r/g, '').split('\n').map((line) => (line.trim() === '' ? '' : line));
    if (lines.length === 0) return { ok: false, reason: 'empty' };
    appendRegexReplacementInputs(lines, { sync: false });
    $textarea.val('').data('regex-edit-index', -1);
    syncRegexReplacementInputState();
    return { ok: true, mode: 'append', count: lines.length };
}

export function hasPendingRegexReplacementInput() {
    const draft = String($('#blai-modal-sub-rep').val() ?? '');
    if (draft.trim() === '') return false;
    const editIndex = getRegexReplacementEditIndex();
    const values = getRegexReplacementChipValues();
    return editIndex < 0 || editIndex >= values.length || draft !== values[editIndex];
}

export function setSingleRuleReplacementEditor(mode, replacements = []) {
    const normalized = normalizeReplacementList(replacements);
    const isRegexMode = mode === 'regex';
    const $textarea = $('#blai-modal-sub-rep');
    const $actions = $('#blai-modal-sub-regex-actions');
    const $list = $('#blai-modal-sub-regex-list');
    $textarea.data('regex-edit-index', -1);

    if (isRegexMode) {
        $textarea.val('');
        $list.empty();
        appendRegexReplacementInputs(normalized, { sync: false });
        $actions.prop('hidden', false);
        syncRegexReplacementInputState();
        return;
    }

    $list.empty().prop('hidden', true);
    $actions.prop('hidden', true);
    $textarea
        .val(normalized.join(mode === 'text' ? ', ' : '\n'))
        .removeData('regex-default-placeholder')
        .removeData('regex-edit-placeholder');
}

export function getSingleRuleReplacementValues(mode) {
    if (mode === 'regex') {
        return getRegexReplacementChipValues();
    }

    const rawValue = String($('#blai-modal-sub-rep').val() ?? '');
    return parseInputToWords(rawValue, mode === 'text' ? 'text' : 'regex', { isTarget: false });
}

export function renderTags() {
    const container = $('#blai-home-rule-grid');
    if (!container.length) return;
    if (!rulesUiState.rulesUiDirty && container.children().length > 0) return;

    const { extension_settings } = getAppContext();
    const rules = extension_settings[extensionName]?.rules || [];
    const html = rules.map((r, i) => {
        const name = safeHtml(r.name) || `未命名合集 ${i + 1}`;
        const subRules = r.subRules || [];
        const maxPreview = 3;

        const subRulesHtml = subRules.slice(0, maxPreview).map((sub) => {
            const mode = sub.mode || 'text';
            const tagText = getRulePreviewTagText(mode);
            const tPreview = getRuleSourcePreviewText(sub);
            const rPreview = getRewriteMode(sub) === 'ai'
                ? 'AI 运行时生成'
                : formatReplacementPreview(sub.replacements || [], mode);
            const subEnabled = sub.enabled !== false;
            const rewriteBadge = getRewriteMode(sub) === 'ai'
                ? '<span class="blai-home-rule-badge">AI 改写</span>'
                : '';
            return `
                <div class="blai-home-rule-item ${subEnabled ? '' : 'blai-is-disabled'}">
                    <div class="blai-home-rule-source">
                        <div class="blai-home-rule-labels">
                            <span class="blai-home-rule-badge">${tagText}</span>
                            ${rewriteBadge}
                        </div>
                        <span class="blai-home-source-text">${tPreview}</span>
                    </div>
                    <i class="fas fa-arrow-right blai-home-rule-arrow" aria-hidden="true"></i>
                    <div class="blai-home-rule-target">
                        <span class="blai-home-preview-label">改写预览</span>
                        <span class="blai-home-target-text">${rPreview}</span>
                    </div>
                </div>`;
        }).join('');

        const moreHtml = subRules.length > maxPreview
            ? `<div class="blai-home-more-text">... 以及其他 ${subRules.length - maxPreview} 组映射</div>`
            : '';
        const bodyHtml = subRules.length > 0
            ? `<div class="blai-home-card-body">${subRulesHtml}${moreHtml}</div>`
            : '<div class="blai-home-card-empty">此合集暂无规则</div>';

        const isEnabled = r.enabled !== false;
        const riskIndicatorHtml = isRuleActivationWarningEnabled(r)
            ? `<i class="fas fa-circle-exclamation blai-rule-risk-indicator blai-home-card-risk"
                  data-index="${i}"
                  title="查看启用风险提示"
                  aria-label="查看高风险规则组提示"
                  role="button"
                  tabindex="0"></i>`
            : '';
        const checkedAttr = isEnabled ? 'checked' : '';

        return `
            <article class="blai-home-card ${!isEnabled ? 'blai-is-disabled' : ''}" data-index="${i}">
                <header class="blai-home-card-header">
                    <div class="blai-home-card-heading">
                        <label class="blai-batch-checkbox-label blai-home-selection-control" title="选择此规则合集">
                            <input type="checkbox" class="batch-item-checkbox" data-index="${i}">
                            <span class="blai-home-selection-indicator" aria-hidden="true"></span>
                            <span class="blai-visually-hidden">选择 ${name}</span>
                        </label>
                        <label class="blai-home-enabled-control" title="启用或停用此规则组">
                            <input type="checkbox" class="blai-rule-toggle" data-index="${i}" ${checkedAttr}>
                            <span class="blai-home-enabled-indicator" aria-hidden="true"></span>
                            <span class="blai-home-card-title">${name}</span>
                            <span class="blai-home-card-count">${subRules.length} 条</span>
                        </label>
                    </div>
                    <div class="blai-home-card-actions">
                        ${riskIndicatorHtml}
                        <button class="blai-rule-edit blai-home-card-pencil" type="button" data-index="${i}" title="编辑此规则集合" aria-label="编辑此规则集合"><i class="fas fa-pen" aria-hidden="true"></i></button>
                        <div class="blai-home-card-menu-wrap">
                            <button class="blai-home-card-menu-toggle" type="button" data-index="${i}" title="更多操作" aria-label="更多操作" aria-haspopup="true" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                            <div class="blai-home-card-menu" hidden>
                                <button type="button" class="blai-rule-menu-item" data-rule-action="up" data-index="${i}" ${i === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up" aria-hidden="true"></i>上移</button>
                                <button type="button" class="blai-rule-menu-item" data-rule-action="down" data-index="${i}" ${i === rules.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down" aria-hidden="true"></i>下移</button>
                                <button type="button" class="blai-rule-menu-item" data-rule-action="copy" data-index="${i}"><i class="fas fa-clone" aria-hidden="true"></i>复制</button>
                                <button type="button" class="blai-rule-menu-item" data-rule-action="transfer" data-index="${i}"><i class="fas fa-arrows-turn-right" aria-hidden="true"></i>移动</button>
                                <button type="button" class="blai-rule-menu-item blai-rule-menu-item--danger" data-rule-action="delete" data-index="${i}"><i class="fas fa-trash" aria-hidden="true"></i>删除</button>
                            </div>
                        </div>
                    </div>
                </header>
                ${bodyHtml}
            </article>`;
    }).join('');

    container.html(html || '<div class="blai-home-empty-state"><i class="fas fa-folder-open" aria-hidden="true"></i><strong>当前没有规则合集</strong><span>点击“添加”创建第一个合集</span></div>');
    const aiRuleCount = rules.reduce((count, rule) => count + (Array.isArray(rule?.subRules)
        ? rule.subRules.filter((sub) => sub?.rewriteMode === 'ai').length
        : 0), 0);
    $('#blai-rule-group-count').text(String(rules.length));
    $('#blai-ai-rule-count').text(String(aiRuleCount));
    markRulesUiDirty(false);
}

