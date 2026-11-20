/**
 * view.js 拆分产物（panels）：3 个顶层声明，7639 字节 / 148 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { rulesUiState } from '../state.js';
import { safeHtml } from '../../ui/html.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { formatReplacementPreview, getRewriteMode, getRuleSourcePreviewText, syncRuleEditFilterUi, clearRuleSearchEditFlow } from './view-00-search.js';
import { setSingleRuleReplacementEditor } from './view-01-modal.js';

export function renderSubrulesToModal() {
    const container = $('#blai-edit-subrules-container');
    if (!container.length) return;
    syncRuleEditFilterUi();
    if (rulesUiState.currentEditingSubrules.length === 0) {
        container.html('<div class="blai-subrule-empty">当前合集没有映射规则，请点击下方按钮添加。</div>');
        return;
    }

    const activeFilter = rulesUiState.currentEditingFilter || 'all';
    const visibleSubrules = rulesUiState.currentEditingSubrules
        .map((sub, index) => ({ sub, index }))
        .filter((entry) => activeFilter === 'all' || getRewriteMode(entry.sub) === activeFilter);

    if (visibleSubrules.length === 0) {
        const emptyHint = activeFilter === 'ai'
            ? '当前合集里没有 AI 改写的映射规则。'
            : '当前合集里没有程序改写的映射规则。';
        container.html(`<div class="blai-subrule-empty">${emptyHint}</div>`);
        return;
    }

    const html = visibleSubrules.map(({ sub, index: i }) => {
        const mode = sub.mode || 'text';
        const remark = sub.remark ? sub.remark.trim() : '';
        const subEnabled = sub.enabled !== false;
        const checkedAttr = subEnabled ? 'checked' : '';
        const moveUpDisabled = i === 0 ? 'disabled' : '';
        const moveDownDisabled = i === rulesUiState.currentEditingSubrules.length - 1 ? 'disabled' : '';

        const badgeText = mode === 'regex' ? '正则' : mode === 'simple' ? '简易' : '普通';
        const badgeHTML = `<span class="blai-mapping-badge">${badgeText}</span>`;

        const tPreview = getRuleSourcePreviewText(sub);
        const rPreview = formatReplacementPreview(sub.replacements || [], mode);
        const rewriteBadge = getRewriteMode(sub) === 'ai'
            ? '<span class="blai-mapping-badge">AI 改写</span>'
            : '';

        let remarkHTML = '';
        if (remark) {
            remarkHTML = `
                <div class="blai-subrule-remark" style="margin-top: 8px; padding-top: 10px; border-top: 1px dotted color-mix(in srgb, var(--text-main) 35%, color-mix(in srgb, var(--bg-base) 12%, transparent)); font-size: 11px; color: var(--text-secondary); font-style: italic;">
                    <i class="fas fa-info-circle" style="margin-right: 4px;"></i>${safeHtml(remark)}
                </div>
            `;
        }

        return `
            <div class="blai-subrule-card ${subEnabled ? '' : 'blai-is-disabled'}" style="flex-shrink: 0; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; display: flex; flex-direction: column; box-shadow: 0 4px 10px color-mix(in srgb, var(--bg-base) 12%, transparent);">
                <div class="blai-subrule-header">
                    <div class="blai-subrule-badges">
                        <label class="blai-checkbox-label blai-subrule-enable-label" title="${subEnabled ? '停用此条规则' : '启用此条规则'}">
                            <input type="checkbox" class="blai-subrule-toggle" data-index="${i}" ${checkedAttr}>
                            <span class="blai-custom-checkbox"></span>
                        </label>
                        ${badgeHTML}
                        ${rewriteBadge}
                    </div>
                    <div class="blai-subrule-actions">
                        <button class="blai-edit-subrule-btn blai-subrule-action-btn" type="button" data-index="${i}" title="编辑此条规则" aria-label="编辑此条规则"><i class="fas fa-pen" aria-hidden="true"></i></button>
                        <div class="blai-subrule-menu-wrap">
                            <button class="blai-subrule-menu-toggle blai-subrule-action-btn" type="button" data-index="${i}" title="更多操作" aria-label="更多操作" aria-haspopup="true" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                            <div class="blai-subrule-menu" data-index="${i}" hidden>
                                <button type="button" class="blai-subrule-menu-item" data-subrule-action="up" data-index="${i}" ${moveUpDisabled}><i class="fas fa-arrow-up" aria-hidden="true"></i>上移</button>
                                <button type="button" class="blai-subrule-menu-item" data-subrule-action="down" data-index="${i}" ${moveDownDisabled}><i class="fas fa-arrow-down" aria-hidden="true"></i>下移</button>
                                <button type="button" class="blai-subrule-menu-item" data-subrule-action="copy" data-index="${i}"><i class="fas fa-clone" aria-hidden="true"></i>复制</button>
                                <button type="button" class="blai-subrule-menu-item" data-subrule-action="transfer" data-index="${i}"><i class="fas fa-arrows-turn-right" aria-hidden="true"></i>移动</button>
                                <button type="button" class="blai-subrule-menu-item" data-subrule-action="remark" data-index="${i}"><i class="fas fa-comment-dots" aria-hidden="true"></i>备注</button>
                                <button type="button" class="blai-subrule-menu-item blai-subrule-menu-item--danger" data-subrule-action="delete" data-index="${i}"><i class="fas fa-trash" aria-hidden="true"></i>删除</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="blai-subrule-preview">
                    <span class="blai-subrule-preview-source">${tPreview}</span>
                    <i class="fas fa-arrow-right" style="color: var(--text-secondary); font-size: 11px; margin: 0 6px;"></i>
                    <span class="blai-subrule-preview-replacement">${rPreview}</span>
                </div>
                ${remarkHTML}
            </div>
        `;
    }).join('');

    container.html(html);
}

export function openSingleRuleModal(index, options = {}) {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName] || {};
    rulesUiState.currentSubruleEditIndex = index;
    let mode = 'simple';
    let tStr = '';
    let replacements = [];
    let remark = '';
    let rewriteMode = 'program';
    let aiPromptTemplate = '';

    if (index >= 0 && rulesUiState.currentEditingSubrules[index]) {
        const sub = rulesUiState.currentEditingSubrules[index];
        mode = sub.mode || 'simple';
        tStr = (sub.targets || []).join(mode === 'text' ? ', ' : '\n');
        replacements = Array.isArray(sub.replacements) ? sub.replacements : [];
        remark = sub.remark || '';
        rewriteMode = getRewriteMode(sub);
        aiPromptTemplate = String(sub.aiPromptTemplate || '');
    } else {
        // 新建条目沿用上次使用的语法模式，减少反复切换；编辑已有条目仍用条目自身模式。
        const remembered = String(settings.subruleEditorMode || 'simple');
        mode = ['simple', 'text', 'regex'].includes(remembered) ? remembered : 'simple';
    }

    $('#blai-modal-sub-mode').val(mode).data('current-mode', mode);
    $('#blai-modal-sub-rewrite-mode').val(rewriteMode);
    $('#blai-modal-sub-target').val(tStr);
    setSingleRuleReplacementEditor(mode, replacements);
    $('#blai-modal-sub-remark').val(remark);
    $('#blai-modal-sub-ai-prompt').val(aiPromptTemplate);

    // 测试区文本不缓存：每次打开都从空开始；展开状态沿用上次选择。
    $('#blai-regex-test-text').val('');
    $('#blai-regex-test-highlight').empty().prop('hidden', true);
    $('#blai-regex-test-stat').empty().prop('hidden', true).removeClass('is-hit is-error');
    $('#blai-regex-test-input-wrap').removeClass('has-matches');
    const testOpen = settings.subruleTestPanelOpen === true;
    $('#blai-regex-test-panel').prop('hidden', !testOpen);
    $('#blai-regex-test-toggle').attr('aria-expanded', testOpen ? 'true' : 'false').toggleClass('is-open', testOpen);

    $('#blai-modal-sub-mode').trigger('change');
    $('#blai-modal-sub-rewrite-mode').trigger('change');
    if (options.hideEditModal === true) $('#blai-rule-edit-modal').hide();
    $('#blai-subrule-edit-modal').css('display', 'flex').hide().fadeIn(150);
}

export function openEditModal(index = -1, options = {}) {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const { source = 'main', returnMode = 'group', subRuleIndex = -1 } = options;
    rulesUiState.currentEditingIndex = index;
    if (source === 'search') {
        rulesUiState.searchEditFlow.active = true;
        rulesUiState.searchEditFlow.returnMode = returnMode;
        rulesUiState.searchEditFlow.ruleIndex = index;
        rulesUiState.searchEditFlow.subRuleIndex = subRuleIndex;
    } else {
        clearRuleSearchEditFlow();
    }
    const modal = $('#blai-rule-edit-modal');

    if (index === -1) {
        $('#blai-edit-modal-title').html('<i class="fas fa-folder-plus"></i> 新增规则合集');
        $('#blai-edit-name').val('');
        rulesUiState.currentEditingSubrules = [{ targets: [], replacements: [], mode: 'simple', enabled: true, isEditing: false }];
    } else {
        const rule = settings.rules[index];
        $('#blai-edit-modal-title').html('<i class="fas fa-pen"></i> 编辑规则合集');
        $('#blai-edit-name').val(rule.name || '');
        rulesUiState.currentEditingSubrules = JSON.parse(JSON.stringify(rule.subRules || []));
        rulesUiState.currentEditingSubrules.forEach((sub) => {
            if (sub.enabled === undefined) sub.enabled = true;
            sub.isEditing = false;
        });
    }

    rulesUiState.currentEditingFilter = 'all';
    syncRuleEditFilterUi();
    renderSubrulesToModal();
    modal.css('display', 'flex');
}

