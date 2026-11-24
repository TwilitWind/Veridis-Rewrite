// 负责作用域管理操作、作用域设置变更及其保存边界；解析留在 scope/model.js。
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { showConfirmModal, showPromptModal, showToast } from '../ui/notifications.js';
import { closeScopeTagsModal, openScopeTagsModal, renderScopeTagsModal } from './view.js';
import { closeMenuPopover, openMenuPopover, focusOnFinePointer } from '../ui/popover.js';
import { DEFAULT_SCOPE_TAG_GROUP_ID, createScopeTagGroupId, createScopeTagId, formatScopeTagInput, getBuiltinStartTagKey, getCotScopeTagBuiltinKeys, isCotScopeTagEntry, mergeScopeTagsWithBuiltins, normalizeScopeTagBuiltinDismissedList, normalizeCollapsedGroupList, normalizeScopeTagGroupList, normalizeScopeTagList, parseScopeTagInput } from './model.js';

export function bindScopeEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const clearScopeTagValidationState = () => { $('#blai-scope-tag-input').removeClass('blai-invalid').removeAttr('aria-invalid'); $('#blai-scope-tag-error').removeClass('is-visible').text(''); };
    const applyScopeTagValidationError = (message) => { $('#blai-scope-tag-input').addClass('blai-invalid').attr('aria-invalid', 'true'); $('#blai-scope-tag-error').addClass('is-visible').text(message); };
    const getScopeTagEditId = () => String($('#blai-scope-tag-input').data('scope-edit-id') || '');
    const resetScopeTagEditor = () => { $('#blai-scope-tag-input').val('').data('scope-edit-id', ''); $('#blai-scope-tag-label-input').val(''); $('#blai-scope-tag-group-select').val(DEFAULT_SCOPE_TAG_GROUP_ID); $('#blai-scope-tag-editor-modal').removeClass('blai-is-open').attr('aria-hidden', 'true'); $('#blai-scope-tag-action-menu').prop('hidden', true); $('#blai-scope-tag-menu-open').attr('aria-expanded', 'false'); clearScopeTagValidationState(); renderScopeTagsModal(); };
    const normalizeScopeTagDraftStart = (tagText) => { const trimmed = String(tagText || '').trim(); return /^<[^<>/\s]+>$/.test(trimmed) ? trimmed : `<${trimmed.replace(/[<>]/g, '')}>`; };
    const buildScopeTagInputFromEditor = () => {
        const rawTagText = String($('#blai-scope-tag-input').val() || '').trim();
        const labelText = String($('#blai-scope-tag-label-input').val() || '').trim();
        if (!rawTagText) return '';
        if (rawTagText.includes('//')) { const [tagPart, ...labelParts] = rawTagText.split('//'); const normalizedLabel = labelText || labelParts.join('//').trim(); const tagSource = normalizeScopeTagDraftStart(tagPart); return normalizedLabel ? `${tagSource}//${normalizedLabel}` : tagSource; }
        const tagSource = normalizeScopeTagDraftStart(rawTagText); return labelText ? `${tagSource}//${labelText}` : tagSource;
    };
    const getScopeTagGroups = () => normalizeScopeTagGroupList(settings.scopeTagGroups);
    const getScopeTagGroupIds = () => new Set(getScopeTagGroups().map((group) => group.id));
    const resolveScopeTagGroupId = (groupId) => { const candidate = String(groupId || DEFAULT_SCOPE_TAG_GROUP_ID).trim() || DEFAULT_SCOPE_TAG_GROUP_ID; return getScopeTagGroupIds().has(candidate) ? candidate : DEFAULT_SCOPE_TAG_GROUP_ID; };
    const renderScopeTagGroupOptions = (selectedGroupId = DEFAULT_SCOPE_TAG_GROUP_ID) => { const groups = getScopeTagGroups(); const $select = $('#blai-scope-tag-group-select'); $select.empty(); groups.forEach((group) => $('<option>').val(group.id).text(group.name).appendTo($select)); $select.val(resolveScopeTagGroupId(selectedGroupId)); };
    const getSelectedScopeTagGroupId = () => resolveScopeTagGroupId($('#blai-scope-tag-group-select').val());
    const normalizeScopeTagsToKnownGroups = (scopeTags) => { const groupIds = getScopeTagGroupIds(); return normalizeScopeTagList(scopeTags).map((tag) => { const groupId = String(tag.groupId || DEFAULT_SCOPE_TAG_GROUP_ID).trim() || DEFAULT_SCOPE_TAG_GROUP_ID; return groupIds.has(groupId) ? tag : { ...tag, groupId: DEFAULT_SCOPE_TAG_GROUP_ID }; }); };
    const closeScopeTagActionMenu = () => { $('#blai-scope-tag-action-menu').prop('hidden', true); $('#blai-scope-tag-menu-open').attr('aria-expanded', 'false'); };
    const openScopeTagEditor = (scopeTag = null) => {
        const formattedInput = scopeTag ? formatScopeTagInput(scopeTag) : ''; const tagSource = formattedInput.split('//')[0]?.trim() || ''; const tagName = tagSource.match(/^<([^<>/\s]+)>$/)?.[1] || tagSource;
        renderScopeTagGroupOptions(scopeTag?.groupId || DEFAULT_SCOPE_TAG_GROUP_ID);
        $('#blai-scope-tag-input').val(scopeTag ? tagName : '').data('scope-edit-id', scopeTag?.id || ''); $('#blai-scope-tag-label-input').val(scopeTag?.label || ''); clearScopeTagValidationState(); renderScopeTagsModal(); $('#blai-scope-tag-editor-modal').addClass('blai-is-open').attr('aria-hidden', 'false'); window.setTimeout(() => focusOnFinePointer($('#blai-scope-tag-input')), 20);
    };
    const setScopeTagMode = (mode) => { const nextMode = mode === 'cleanse-inside' ? 'cleanse-inside' : 'protect'; if (settings.scopeTagMode === nextMode) { renderScopeTagsModal(); return; } settings.scopeTagMode = nextMode; saveSettingsDebounced(); renderScopeTagsModal(); };
    const persistScopeTagGroups = (groups, options = {}) => {
        const normalizedGroups = normalizeScopeTagGroupList(groups); settings.scopeTagGroups = normalizedGroups; settings.scopeTagCollapsedGroups = normalizeCollapsedGroupList(settings.scopeTagCollapsedGroups, normalizedGroups);
        const knownGroupIds = new Set(normalizedGroups.map((group) => group.id)); const currentScopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed);
        settings.scopeTags = normalizeScopeTagList(currentScopeTags).map((tag) => { const groupId = String(tag.groupId || DEFAULT_SCOPE_TAG_GROUP_ID).trim() || DEFAULT_SCOPE_TAG_GROUP_ID; return knownGroupIds.has(groupId) ? tag : { ...tag, groupId: DEFAULT_SCOPE_TAG_GROUP_ID }; });
        saveSettingsDebounced(); renderScopeTagsModal(); renderScopeTagGroupOptions($('#blai-scope-tag-group-select').val() || DEFAULT_SCOPE_TAG_GROUP_ID);
    };
    const persistScopeTags = (scopeTags, options = {}) => {
        settings.scopeTagGroups = getScopeTagGroups(); const sourceScopeTags = normalizeScopeTagsToKnownGroups(scopeTags); const representedBuiltinKeys = new Set(sourceScopeTags.map((tag) => tag.builtinKey).filter(Boolean));
        const dismissedBuiltinKeys = normalizeScopeTagBuiltinDismissedList(options.dismissedBuiltinKeys ?? settings.scopeTagBuiltinDismissed).filter((builtinKey) => !representedBuiltinKeys.has(builtinKey));
        const normalized = mergeScopeTagsWithBuiltins(sourceScopeTags, dismissedBuiltinKeys); settings.scopeTagBuiltinDismissed = dismissedBuiltinKeys; settings.scopeTags = normalizeScopeTagsToKnownGroups(normalized); saveSettingsDebounced(); renderScopeTagsModal(); return normalized;
    };
    const saveScopeTag = () => {
        const parsed = parseScopeTagInput(buildScopeTagInputFromEditor()); if (!parsed.ok) { applyScopeTagValidationError(parsed.error.message); $('#blai-scope-tag-input').trigger('focus'); return false; }
        const editId = getScopeTagEditId(); const scopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed); const currentTag = editId ? scopeTags.find((tag) => tag.id === editId) : null;
        if (scopeTags.find((tag) => tag.startTag === parsed.value.startTag && tag.id !== editId)) { applyScopeTagValidationError('该范围标签已存在，无需重复添加。'); $('#blai-scope-tag-input').trigger('focus'); return false; }
        const currentBuiltinKey = currentTag?.builtinKey || ''; const inferredBuiltinKey = getBuiltinStartTagKey(parsed.value.startTag); const nextBuiltinKey = currentBuiltinKey ? (inferredBuiltinKey || currentBuiltinKey) : inferredBuiltinKey; const dismissedBuiltinKeys = [...normalizeScopeTagBuiltinDismissedList(settings.scopeTagBuiltinDismissed)]; if (currentBuiltinKey && inferredBuiltinKey && inferredBuiltinKey !== currentBuiltinKey) dismissedBuiltinKeys.push(currentBuiltinKey);
        const nextScopeTag = { id: editId || createScopeTagId(), startTag: parsed.value.startTag, endTag: parsed.value.endTag, label: parsed.value.label, groupId: getSelectedScopeTagGroupId(), enabled: currentTag ? currentTag.enabled !== false : true }; if (nextBuiltinKey) nextScopeTag.builtinKey = nextBuiltinKey;
        persistScopeTags(editId ? scopeTags.map((tag) => (tag.id === editId ? { ...tag, ...nextScopeTag, enabled: tag.enabled !== false } : tag)) : [...scopeTags, nextScopeTag], { dismissedBuiltinKeys }); showToast(editId ? '范围标签已更新' : '范围标签已添加', undefined, 'success'); resetScopeTagEditor(); return true;
    };
    let openGroupMenu = null;
    let openGroupMenuTrigger = null;
    let openTagMenu = null;
    let openTagMenuTrigger = null;
    const closeScopeGroupMenus = () => {
        if (!openGroupMenu) return;
        closeMenuPopover(openGroupMenu);
        if (openGroupMenuTrigger) $(openGroupMenuTrigger).attr('aria-expanded', 'false');
        openGroupMenu = null;
        openGroupMenuTrigger = null;
    };
    const closeScopeTagMenus = () => {
        if (!openTagMenu) return;
        closeMenuPopover(openTagMenu);
        if (openTagMenuTrigger) $(openTagMenuTrigger).attr('aria-expanded', 'false');
        openTagMenu = null;
        openTagMenuTrigger = null;
    };
    const moveScopeGroup = (groupId, direction) => { const groups = getScopeTagGroups(); const index = groups.findIndex((group) => group.id === groupId); const targetIndex = direction === 'up' ? index - 1 : index + 1; if (index < 0 || targetIndex < 0 || targetIndex >= groups.length) return; [groups[index], groups[targetIndex]] = [groups[targetIndex], groups[index]]; persistScopeTagGroups(groups); };
    const moveScopeTag = (tagId, direction) => {
        const scopeTags = getScopeTagGroups().length
            ? mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed)
            : [];
        const current = scopeTags.find((tag) => tag.id === tagId);
        if (!current || isCotScopeTagEntry(current)) return;
        // 只在同一分组内交换，避免跨组移动破坏分组语义。
        const groupId = resolveScopeTagGroupId(current.groupId);
        const inGroup = scopeTags.filter((tag) => resolveScopeTagGroupId(tag.groupId) === groupId && !isCotScopeTagEntry(tag));
        const index = inGroup.findIndex((tag) => tag.id === tagId);
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || targetIndex < 0 || targetIndex >= inGroup.length) return;
        const swapId = inGroup[targetIndex].id;
        const indexA = scopeTags.findIndex((tag) => tag.id === tagId);
        const indexB = scopeTags.findIndex((tag) => tag.id === swapId);
        [scopeTags[indexA], scopeTags[indexB]] = [scopeTags[indexB], scopeTags[indexA]];
        persistScopeTags(scopeTags);
    };

    $(document).off('click', '#blai-scope-tags-btn').on('click', '#blai-scope-tags-btn', () => {
        openScopeTagsModal();
    });
    $(document).off('click', '#blai-scope-tag-menu-open').on('click', '#blai-scope-tag-menu-open', function(e) { e.preventDefault(); e.stopPropagation(); const $menu = $('#blai-scope-tag-action-menu'); const nextHidden = !$menu.prop('hidden'); $menu.prop('hidden', nextHidden); $(this).attr('aria-expanded', String(!nextHidden)); });
    $(document).off('click', '#blai-scope-group-add').on('click', '#blai-scope-group-add', async () => {
        closeScopeTagActionMenu(); closeScopeGroupMenus();
        const groupName = String(await showPromptModal('新建分组', '', { placeholder: '输入分组名称', okText: '创建' }) || '').trim();
        if (!groupName) return;
        const groups = getScopeTagGroups();
        if (groups.some((group) => group.name === groupName)) { showToast('该分组已存在', undefined, 'error'); return; }
        persistScopeTagGroups([...groups, { id: createScopeTagGroupId(), name: groupName }]);
        showToast('分组已创建', undefined, 'success');
    });
    $(document).off('click', '#blai-scope-tag-new').on('click', '#blai-scope-tag-new', () => { closeScopeTagActionMenu(); closeScopeGroupMenus(); openScopeTagEditor(null); });
    $(document).off('click', '.blai-clean-tag-group-header').on('click', '.blai-clean-tag-group-header', function(e) { e.preventDefault(); if ($(e.target).closest('.blai-clean-group-controls').length > 0) return; if ($(e.target).closest('.blai-clean-group-edit').length > 0) return; const groupId = String($(this).closest('.blai-clean-tag-group').attr('data-group-id') || ''); if (!groupId) return; const groups = getScopeTagGroups(); const collapsed = new Set(normalizeCollapsedGroupList(settings.scopeTagCollapsedGroups, groups)); if (collapsed.has(groupId)) collapsed.delete(groupId); else collapsed.add(groupId); settings.scopeTagCollapsedGroups = normalizeCollapsedGroupList([...collapsed], groups); saveSettingsDebounced(); renderScopeTagsModal(); });
    $(document).off('click', '.blai-clean-group-switch').on('click', '.blai-clean-group-switch', function(e) { e.preventDefault(); e.stopPropagation(); const groupId = String($(this).attr('data-group-id') || ''); if (!groupId || $(this).prop('disabled')) return; const nextEnabled = $(this).attr('aria-pressed') !== 'true'; const currentScopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed); let changed = false; const scopeTags = currentScopeTags.map((tag) => { if (resolveScopeTagGroupId(tag.groupId) !== groupId) return tag; if ((tag.enabled !== false) === nextEnabled) return tag; changed = true; return { ...tag, enabled: nextEnabled }; }); if (!changed) return; persistScopeTags(scopeTags); });
    $(document).off('click', '.blai-clean-group-menu-open').on('click', '.blai-clean-group-menu-open', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeScopeTagActionMenu();
        const trigger = this;
        const $menu = $(this).closest('.blai-clean-group-menu-wrap').find('.blai-clean-group-menu');
        const menu = $menu.get(0);
        if (!menu) return;
        const willOpen = openGroupMenu !== menu;
        closeScopeGroupMenus();
        if (!willOpen) return;
        openGroupMenu = menu;
        openGroupMenuTrigger = trigger;
        openMenuPopover(trigger, menu);
        $(trigger).attr('aria-expanded', 'true');
    });
    $(document).off('click', '.blai-clean-group-edit').on('click', '.blai-clean-group-edit', async function(e) { e.preventDefault(); e.stopPropagation(); closeScopeTagActionMenu(); closeScopeGroupMenus(); const groupId = String($(this).attr('data-group-id') || ''); const group = getScopeTagGroups().find((item) => item.id === groupId); if (!group) return; const nextName = String(await showPromptModal('修改分组名称', group.name, { placeholder: '输入分组名称', okText: '保存' }) || '').trim(); if (!nextName || nextName === group.name) return; if (getScopeTagGroups().some((item) => item.name === nextName && item.id !== groupId)) { showToast('该分组已存在', undefined, 'error'); return; } persistScopeTagGroups(getScopeTagGroups().map((item) => item.id === groupId ? { ...item, name: nextName } : item)); showToast('分组名称已更新', undefined, 'success'); });
    $(document).off('click', '.blai-clean-group-move-up').on('click', '.blai-clean-group-move-up', function(e) { e.stopPropagation(); if ($(this).prop('disabled')) return; closeScopeGroupMenus(); moveScopeGroup(String($(this).attr('data-group-id') || ''), 'up'); });
    $(document).off('click', '.blai-clean-group-move-down').on('click', '.blai-clean-group-move-down', function(e) { e.stopPropagation(); if ($(this).prop('disabled')) return; closeScopeGroupMenus(); moveScopeGroup(String($(this).attr('data-group-id') || ''), 'down'); });
    $(document).off('click', '.blai-clean-group-delete').on('click', '.blai-clean-group-delete', async function(e) { e.stopPropagation(); if ($(this).prop('disabled')) return; closeScopeGroupMenus(); const groupId = String($(this).attr('data-group-id') || ''); if (!groupId || groupId === DEFAULT_SCOPE_TAG_GROUP_ID) return; const group = getScopeTagGroups().find((item) => item.id === groupId); if (!group || !await showConfirmModal(`确定删除分组 "${group.name}" 吗？\n该分组内的标签会移至默认分组。`, { danger: true, okText: '删除' })) return; const currentScopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed); settings.scopeTags = currentScopeTags.map((tag) => tag.groupId === groupId ? { ...tag, groupId: DEFAULT_SCOPE_TAG_GROUP_ID } : tag); settings.scopeTagCollapsedGroups = normalizeCollapsedGroupList((settings.scopeTagCollapsedGroups || []).filter((id) => id !== groupId), getScopeTagGroups().filter((item) => item.id !== groupId)); persistScopeTagGroups(getScopeTagGroups().filter((item) => item.id !== groupId)); });
    $(document).off('click', '#blai-scope-tag-mode-toggle').on('click', '#blai-scope-tag-mode-toggle', () => setScopeTagMode(settings.scopeTagMode === 'cleanse-inside' ? 'protect' : 'cleanse-inside'));
    $(document).off('click', '#blai-scope-mode-protect, #blai-scope-mode-cleanse').on('click', '#blai-scope-mode-protect, #blai-scope-mode-cleanse', function() { setScopeTagMode(String($(this).data('mode') || 'protect')); });
    $(document).off('click', '#blai-scope-tags-close').on('click', '#blai-scope-tags-close', () => closeScopeTagsModal({ reset: true }));
    $(document).off('click', '#blai-scope-tag-reset').on('click', '#blai-scope-tag-reset', resetScopeTagEditor);
    $(document).off('click', '#blai-scope-tag-save').on('click', '#blai-scope-tag-save', saveScopeTag);
    $(document).off('keydown', '#blai-scope-tag-label-input').on('keydown', '#blai-scope-tag-label-input', function(e) { if (e.key !== 'Enter') return; e.preventDefault(); saveScopeTag(); });
    $(document).off('keydown', '#blai-scope-tag-input').on('keydown', '#blai-scope-tag-input', function(e) { if (e.key !== 'Enter') return; e.preventDefault(); saveScopeTag(); });
    $(document).off('click', '#blai-scope-tags-modal').on('click', '#blai-scope-tags-modal', function(e) { if ($(e.target).closest('.blai-clean-group-menu-wrap').length === 0) closeScopeGroupMenus(); if ($(e.target).closest('.blai-clean-tag-menu-wrap').length === 0) closeScopeTagMenus(); if ($(e.target).closest('.blai-scope-tag-menu-wrap').length === 0) closeScopeTagActionMenu(); if (e.target && e.target.id === 'blai-scope-tags-modal') closeScopeTagsModal({ reset: true }); });
    $(document).off('click', '#blai-scope-tag-editor-modal').on('click', '#blai-scope-tag-editor-modal', function(e) { if (e.target && e.target.id === 'blai-scope-tag-editor-modal') resetScopeTagEditor(); });
    $(document).off('click', '.blai-clean-tag-menu-open').on('click', '.blai-clean-tag-menu-open', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeScopeTagActionMenu();
        closeScopeGroupMenus();
        const trigger = this;
        const menu = $(this).closest('.blai-clean-tag-menu-wrap').find('.blai-clean-tag-menu').get(0);
        if (!menu) return;
        const willOpen = openTagMenu !== menu;
        closeScopeTagMenus();
        if (!willOpen) return;
        openTagMenu = menu;
        openTagMenuTrigger = trigger;
        openMenuPopover(trigger, menu);
        $(trigger).attr('aria-expanded', 'true');
    });
    $(document).off('click', '.blai-clean-tag-copy, .blai-clean-tag-edit').on('click', '.blai-clean-tag-copy, .blai-clean-tag-edit', function(e) { e.preventDefault(); e.stopPropagation(); closeScopeTagMenus(); const scopeTag = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed).find((tag) => tag.id === String($(this).attr('data-id') || '')); if (scopeTag) openScopeTagEditor(scopeTag); });
    $(document).off('change', '.blai-clean-tag-toggle-input').on('change', '.blai-clean-tag-toggle-input', function() { const tagId = String($(this).attr('data-id') || ''); const checked = $(this).prop('checked'); const currentScopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed); const targetTag = currentScopeTags.find((tag) => tag.id === tagId); const togglesCotGroup = isCotScopeTagEntry(targetTag); persistScopeTags(currentScopeTags.map((tag) => togglesCotGroup && isCotScopeTagEntry(tag) ? { ...tag, enabled: checked } : tag.id === tagId ? { ...tag, enabled: checked } : tag)); });
    $(document).off('click', '.blai-clean-tag-delete').on('click', '.blai-clean-tag-delete', async function(e) { e.preventDefault(); e.stopPropagation(); closeScopeTagMenus(); const tagId = String($(this).attr('data-id') || ''); const scopeTags = mergeScopeTagsWithBuiltins(settings.scopeTags, settings.scopeTagBuiltinDismissed); const scopeTag = scopeTags.find((tag) => tag.id === tagId); if (!scopeTag) return; const deletesCotGroup = isCotScopeTagEntry(scopeTag); const displayName = deletesCotGroup ? '<thinking> OR <think>' : scopeTag.startTag; if (!await showConfirmModal(`确定删除范围标签 ${displayName} 吗？`, { danger: true, okText: '删除' })) return; const dismissedBuiltinKeys = [...normalizeScopeTagBuiltinDismissedList(settings.scopeTagBuiltinDismissed)]; if (deletesCotGroup) dismissedBuiltinKeys.push(...getCotScopeTagBuiltinKeys()); else if (scopeTag.builtinKey) dismissedBuiltinKeys.push(scopeTag.builtinKey); persistScopeTags(deletesCotGroup ? scopeTags.filter((tag) => !isCotScopeTagEntry(tag)) : scopeTags.filter((tag) => tag.id !== tagId), { dismissedBuiltinKeys }); if (getScopeTagEditId() === tagId) resetScopeTagEditor(); showToast('范围标签已删除', undefined, 'success'); });
    $(document).off('click', '.blai-clean-tag-move-up').on('click', '.blai-clean-tag-move-up', function(e) { e.preventDefault(); e.stopPropagation(); if ($(this).prop('disabled')) return; closeScopeTagMenus(); moveScopeTag(String($(this).attr('data-id') || ''), 'up'); });
    $(document).off('click', '.blai-clean-tag-move-down').on('click', '.blai-clean-tag-move-down', function(e) { e.preventDefault(); e.stopPropagation(); if ($(this).prop('disabled')) return; closeScopeTagMenus(); moveScopeTag(String($(this).attr('data-id') || ''), 'down'); });
}
