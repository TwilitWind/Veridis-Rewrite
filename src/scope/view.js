// 负责作用域标签的 DOM 投影。读取作用域/设置状态，但不改写也不持久化它。
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { showResponsivePage } from '../ui/shell.js';
import { safeHtml } from '../ui/html.js';
import { COT_SCOPE_TAG_DISPLAY_TEXT, DEFAULT_SCOPE_TAG_GROUP_ID, DEFAULT_SCOPE_TAG_GROUP_NAME, isCotScopeTagEntry, mergeScopeTagsWithBuiltins, normalizeScopeTagCollapsedGroupList, normalizeScopeTagGroupList } from './model.js';
function getScopeTagGroupsForSettings(settings = {}) {
    return normalizeScopeTagGroupList(settings?.scopeTagGroups);
}

function getScopeTagCollapsedGroupSet(settings = {}, groups = []) {
    return new Set(normalizeScopeTagCollapsedGroupList(settings?.scopeTagCollapsedGroups, groups));
}

function getScopeTagDisplayGroupId(scopeTag, groupIds) {
    const groupId = String(scopeTag?.groupId || DEFAULT_SCOPE_TAG_GROUP_ID).trim() || DEFAULT_SCOPE_TAG_GROUP_ID;
    return groupIds.has(groupId) ? groupId : DEFAULT_SCOPE_TAG_GROUP_ID;
}

function buildScopeTagChipHtml(scopeTag, editId, index = 0, total = 1) {
    const isEnabled = scopeTag.enabled !== false;
    const checkedAttr = isEnabled ? 'checked' : '';
    const activeClass = scopeTag.id === editId ? 'is-active' : '';
    const disabledClass = isEnabled ? '' : 'is-disabled';
    const labelText = String(scopeTag.label || '').trim();
    const rangeText = isCotScopeTagEntry(scopeTag)
        ? COT_SCOPE_TAG_DISPLAY_TEXT
        : `${scopeTag.startTag} ... ${scopeTag.endTag}`;
    const primaryText = labelText || '标签范围';
    const chipTitle = `${primaryText} · ${rangeText}`;
    // COT 思维链是多个内置标签合并成的展示项，不适合按单项移动。
    const movable = !isCotScopeTagEntry(scopeTag);
    const moveDisabled = (disabled) => (!movable || disabled ? 'disabled' : '');
    return `
        <div class="blai-clean-tag-item ${activeClass} ${disabledClass}" data-id="${safeHtml(scopeTag.id)}">
            <button type="button" class="blai-clean-tag-copy" data-id="${safeHtml(scopeTag.id)}" title="${safeHtml(chipTitle)}">
                <span class="blai-clean-tag-title">${safeHtml(primaryText)}</span>
                <code class="blai-clean-tag-code">${safeHtml(rangeText)}</code>
            </button>
            <div class="blai-clean-tag-actions">
                <label class="blai-clean-tag-switch" title="启用或停用该标签">
                    <input type="checkbox" class="blai-clean-tag-toggle-input" data-id="${safeHtml(scopeTag.id)}" ${checkedAttr}>
                    <span class="blai-clean-switch-track" aria-hidden="true"><i class="fa-solid fa-toggle-off blai-switch-off"></i><i class="fa-solid fa-toggle-on blai-switch-on"></i></span>
                </label>
                <button type="button" class="blai-clean-tag-action blai-clean-tag-edit" data-id="${safeHtml(scopeTag.id)}" title="编辑此标签" aria-label="编辑此标签"><i class="fas fa-pen" aria-hidden="true"></i></button>
                <div class="blai-clean-tag-menu-wrap">
                    <button type="button" class="blai-clean-tag-action blai-clean-tag-menu-open" data-id="${safeHtml(scopeTag.id)}" title="更多操作" aria-label="更多操作" aria-haspopup="true" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                    <div class="blai-clean-tag-menu" hidden>
                        <button type="button" class="blai-clean-group-menu-item blai-clean-tag-move-up" data-id="${safeHtml(scopeTag.id)}" ${moveDisabled(index === 0)}><i class="fas fa-arrow-up" aria-hidden="true"></i>上移</button>
                        <button type="button" class="blai-clean-group-menu-item blai-clean-tag-move-down" data-id="${safeHtml(scopeTag.id)}" ${moveDisabled(index === total - 1)}><i class="fas fa-arrow-down" aria-hidden="true"></i>下移</button>
                        <button type="button" class="blai-clean-group-menu-item blai-clean-group-menu-item--danger blai-clean-tag-delete" data-id="${safeHtml(scopeTag.id)}"><i class="fas fa-trash" aria-hidden="true"></i>删除</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderScopeTagsModal() {
    const $list = $('#blai-scope-tags-list');
    if (!$list.length) return;

    const { extension_settings } = getAppContext();
    const settings = extension_settings?.[extensionName] || {};
    const groups = getScopeTagGroupsForSettings(settings);
    const groupIds = new Set(groups.map((group) => group.id));
    const collapsedGroups = getScopeTagCollapsedGroupSet(settings, groups);
    const scopeTags = mergeScopeTagsWithBuiltins(
        settings.scopeTags,
        settings.scopeTagBuiltinDismissed
    );
    const editId = String($('#blai-scope-tag-input').data('scope-edit-id') || '');
    const isEditing = editId !== '';
    const scopeTagMode = settings.scopeTagMode === 'cleanse-inside' ? 'cleanse-inside' : 'protect';
    const isCleanseInsideMode = scopeTagMode === 'cleanse-inside';
    const displayScopeTags = [];
    let cotDisplayTag = null;

    scopeTags.forEach((scopeTag) => {
        if (!isCotScopeTagEntry(scopeTag)) {
            displayScopeTags.push(scopeTag);
            return;
        }
        if (!cotDisplayTag) {
            cotDisplayTag = {
                ...scopeTag,
                label: scopeTag.label || 'COT思维链',
                enabled: false,
                groupId: getScopeTagDisplayGroupId(scopeTag, groupIds),
            };
            displayScopeTags.push(cotDisplayTag);
        }
        if (scopeTag.enabled !== false) cotDisplayTag.enabled = true;
        if (scopeTag.id === editId) cotDisplayTag.id = scopeTag.id;
    });

    $('#blai-scope-tag-total-count').text(String(displayScopeTags.length));
    $('#blai-scope-tag-editor-title').text(isEditing ? '编辑标签' : '新增标签');
    $('#blai-scope-tag-save').text('确认');
    $('#blai-scope-tag-reset').text('取消');
    $('#blai-scope-mode-protect')
        .toggleClass('is-active', !isCleanseInsideMode)
        .attr('aria-pressed', String(!isCleanseInsideMode))
        .attr('aria-checked', String(!isCleanseInsideMode));
    $('#blai-scope-mode-cleanse')
        .toggleClass('is-active', isCleanseInsideMode)
        .attr('aria-pressed', String(isCleanseInsideMode))
        .attr('aria-checked', String(isCleanseInsideMode));

    const grouped = groups.map((group) => ({ ...group, tags: [] }));
    const groupedMap = new Map(grouped.map((group) => [group.id, group]));
    displayScopeTags.forEach((scopeTag) => {
        const groupId = getScopeTagDisplayGroupId(scopeTag, groupIds);
        const targetGroup = groupedMap.get(groupId) || groupedMap.get(DEFAULT_SCOPE_TAG_GROUP_ID) || grouped[0];
        if (targetGroup) targetGroup.tags.push(scopeTag);
    });

    const html = grouped.map((group, groupIndex) => {
        const isCollapsed = collapsedGroups.has(group.id);
        const groupTitle = safeHtml(group.name || DEFAULT_SCOPE_TAG_GROUP_NAME);
        const isDefaultGroup = group.id === DEFAULT_SCOPE_TAG_GROUP_ID;
        const activeCount = group.tags.filter((scopeTag) => scopeTag.enabled !== false).length;
        const hasTags = group.tags.length > 0;
        const isGroupEnabled = activeCount > 0;
        const isGroupPartial = activeCount > 0 && activeCount < group.tags.length;
        const groupToggleClass = [
            'blai-clean-group-switch',
            isGroupEnabled ? 'is-on' : '',
            isGroupPartial ? 'is-partial' : '',
        ].filter(Boolean).join(' ');
        const groupToggleTitle = hasTags
            ? (isGroupEnabled ? '关闭该分组内全部标签' : '启用该分组内全部标签')
            : '此分组暂无标签';
        const groupToggleDisabled = hasTags ? '' : 'disabled';
        const tagsHtml = group.tags.length > 0
            ? group.tags.map((scopeTag, tagIndex) => buildScopeTagChipHtml(scopeTag, editId, tagIndex, group.tags.length)).join('')
            : '<div class="blai-clean-group-empty">此分组暂无标签。</div>';
        const groupMenuDisabledAttr = (disabled) => (disabled ? 'disabled' : '');
        const groupHeadHtml = `
                <button type="button" class="blai-clean-group-disclosure" data-group-id="${safeHtml(group.id)}" aria-expanded="${String(!isCollapsed)}">
                    <i class="fas fa-chevron-down blai-clean-group-caret" aria-hidden="true"></i>
                    <span class="blai-clean-group-title">${groupTitle}</span>
                    <span class="blai-clean-group-count">${group.tags.length}</span>
                </button>
                <div class="blai-clean-group-controls">
                    <button type="button" class="${groupToggleClass}" data-group-id="${safeHtml(group.id)}" aria-pressed="${String(isGroupEnabled)}" title="${safeHtml(groupToggleTitle)}" ${groupToggleDisabled}>
                        <span class="blai-clean-switch-track" aria-hidden="true"><i class="fa-solid fa-toggle-off blai-switch-off"></i><i class="fa-solid fa-toggle-on blai-switch-on"></i></span>
                    </button>
                    <button type="button" class="blai-clean-tag-action blai-clean-group-edit" data-group-id="${safeHtml(group.id)}" title="编辑分组名称" aria-label="编辑分组名称"><i class="fas fa-pen" aria-hidden="true"></i></button>
                    <div class="blai-clean-group-menu-wrap">
                        <button type="button" class="blai-clean-tag-action blai-clean-group-menu-open" data-group-id="${safeHtml(group.id)}" title="分组操作" aria-label="分组操作" aria-haspopup="true" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                        <div class="blai-clean-group-menu" hidden>
                            <button type="button" class="blai-clean-group-menu-item blai-clean-group-move-up" data-group-id="${safeHtml(group.id)}" ${groupMenuDisabledAttr(groupIndex === 0)}><i class="fas fa-arrow-up" aria-hidden="true"></i>上移</button>
                            <button type="button" class="blai-clean-group-menu-item blai-clean-group-move-down" data-group-id="${safeHtml(group.id)}" ${groupMenuDisabledAttr(groupIndex === grouped.length - 1)}><i class="fas fa-arrow-down" aria-hidden="true"></i>下移</button>
                            <button type="button" class="blai-clean-group-menu-item blai-clean-group-menu-item--danger blai-clean-group-delete" data-group-id="${safeHtml(group.id)}" ${groupMenuDisabledAttr(isDefaultGroup)}><i class="fas fa-trash" aria-hidden="true"></i>删除</button>
                        </div>
                    </div>
                </div>
            `;
        return `
            <section class="blai-clean-tag-group ${isCollapsed ? 'is-collapsed' : ''}" data-group-id="${safeHtml(group.id)}">
                <header class="blai-clean-tag-group-header">
                    ${groupHeadHtml}
                </header>
                <div class="blai-clean-tag-group-body">
                    <div class="blai-clean-tag-group-items">
                        ${tagsHtml}
                    </div>
                </div>
            </section>
        `;
    }).join('');

    $list.html(html || `<div class="blai-empty-state">${isCleanseInsideMode ? '当前没有标签，新增并启用后才会净化标签内内容。' : '当前没有标签，新增后即可保护对应标签内容。'}</div>`);
}

export function openScopeTagsModal() {
    renderScopeTagsModal();
    showResponsivePage('clean');
}

export function closeScopeTagsModal(options = {}) {
    const { reset = false } = options;
    if (reset) {
        $('#blai-scope-tag-input').val('').data('scope-edit-id', '');
        $('#blai-scope-tag-label-input').val('');
        $('#blai-scope-tag-error').removeClass('is-visible').text('');
        $('#blai-scope-tag-input').removeClass('blai-invalid').removeAttr('aria-invalid');
        $('#blai-scope-tag-editor-modal')
            .removeClass('blai-is-open')
            .attr('aria-hidden', 'true');
        $('#blai-scope-tag-action-menu').prop('hidden', true);
        $('#blai-scope-tag-menu-open').attr('aria-expanded', 'false');
        renderScopeTagsModal();
    }
    showResponsivePage('overview');
}
