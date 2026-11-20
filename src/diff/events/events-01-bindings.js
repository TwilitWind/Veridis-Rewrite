/**
 * 负责按需的差异弹窗渲染、操作，以及现有 DOM 绑定。
 */
import { getAppContext } from '../../host/appContext.js';
import { extensionName, minTrackedDiffMessages, maxTrackedDiffMessages, diffLineHeightOptions, diffParagraphGapOptions } from '../../settings/defaults.js';
import { openSingleRuleModal, openEditModal } from '../../rules/view.js';
import { diffRuntimeState, getCurrentDiffIndex, refreshDiffViewer } from '../state.js';
import { injectDiffButtons } from '../view.js';

export function bindDiffEventHandlers(core) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const {
        getDiffMessageByIndex,
        closeDiffActionsMenu,
        openDiffActionsMenu,
        syncDiffLimitControlState,
        applyDiffLimitDraft,
        closeDiffRelatedModal,
        syncDiffRelatedModeState,
        showRelatedRulesForDiffElement,
        syncDiffPreferenceMenuState,
        toggleCurrentDiffRevert,
        triggerCurrentDiffAiRewrite,
        setDiffPickMode,
        syncDiffPickConfirmState,
        applySelectedDiffReverts,
        closeDiffModal,
        renderDiffModalContent,
        establishDiffBaselineAtIndex,
    } = core;

diffRuntimeState.diffModalClose = closeDiffModal;

    diffRuntimeState.diffModalRefresh = (index) => {
        if ($('#blai-diff-modal').is(':visible')) renderDiffModalContent(index);
    };


    $(document).off('click', '.blai-diff-btn').on('click', '.blai-diff-btn', function() {
        const index = Number($(this).attr('data-index'));
        if (!Number.isInteger(index) || index < 0) return;
        const msg = getDiffMessageByIndex(index);
        if (!msg) return;
        diffRuntimeState.currentMessage = msg;
        diffRuntimeState.diffPickMode = false;
        closeDiffRelatedModal();
        renderDiffModalContent(index);
        closeDiffActionsMenu();
        $('#blai-diff-modal').css('display', 'flex');
    });


    $(document).off('click', '#blai-diff-menu-toggle').on('click', '#blai-diff-menu-toggle', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if ($('#blai-diff-actions-menu').prop('hidden')) openDiffActionsMenu();
        else closeDiffActionsMenu();
    });


    $(document).off('click', '#blai-diff-actions-menu').on('click', '#blai-diff-actions-menu', function(e) {
        e.stopPropagation();
    });


    $(document).off('click.blai-diff-menu').on('click.blai-diff-menu', function(e) {
        if ($(e.target).closest('#blai-diff-menu-toggle, #blai-diff-actions-menu').length === 0) closeDiffActionsMenu();
    });

    $(document).off('mousedown.blai-diff-portal').on('mousedown.blai-diff-portal', function(e) {
        if (!core.isDiffMenuOpen()) return;
        if ($(e.target).closest('#blai-diff-menu-toggle, #blai-diff-actions-menu').length > 0) return;
        closeDiffActionsMenu();
    });


    $(document).off('click', '#blai-diff-menu-pos-toggle').on('click', '#blai-diff-menu-pos-toggle', function() {
        const settings = extension_settings[extensionName];
        settings.diffButtonInExtraMenu = !settings.diffButtonInExtraMenu;
        saveSettingsDebounced();
        syncDiffPreferenceMenuState();
        closeDiffActionsMenu();
        injectDiffButtons();
    });


    $(document).off('click', '#blai-diff-menu-bottom-toggle').on('click', '#blai-diff-menu-bottom-toggle', function() {
        const settings = extension_settings[extensionName];
        settings.showBottomDiffButton = settings.showBottomDiffButton === false;
        saveSettingsDebounced();
        syncDiffPreferenceMenuState();
        closeDiffActionsMenu();
        injectDiffButtons();
    });


    $(document).off('click', '#blai-diff-line-height-toggle').on('click', '#blai-diff-line-height-toggle', function() {
        const settings = extension_settings[extensionName];
        const index = Math.max(0, diffLineHeightOptions.indexOf(Number(settings.diffLineHeight)));
        settings.diffLineHeight = diffLineHeightOptions[(index + 1) % diffLineHeightOptions.length];
        saveSettingsDebounced();
        syncDiffPreferenceMenuState();
    });


    $(document).off('click', '#blai-diff-paragraph-gap-toggle').on('click', '#blai-diff-paragraph-gap-toggle', function() {
        const settings = extension_settings[extensionName];
        const index = Math.max(0, diffParagraphGapOptions.indexOf(Number(settings.diffParagraphGap)));
        settings.diffParagraphGap = diffParagraphGapOptions[(index + 1) % diffParagraphGapOptions.length];
        saveSettingsDebounced();
        syncDiffPreferenceMenuState();
    });


    $(document).off('click', '#blai-diff-mode-toggle').on('click', '#blai-diff-mode-toggle', function() {
        const settings = extension_settings[extensionName];
        settings.diffViewMode = settings.diffViewMode === 'full' ? 'snippet' : 'full';
        saveSettingsDebounced();
        refreshDiffViewer();
    });


    $(document).off('click', '#blai-diff-related-mode-toggle').on('click', '#blai-diff-related-mode-toggle', function(e) {
        e.preventDefault();
        e.stopPropagation();
        diffRuntimeState.diffRelatedRuleMode = diffRuntimeState.diffRelatedRuleMode !== true;
        syncDiffRelatedModeState();
        closeDiffActionsMenu();
    });


    $(document).off('input', '#blai-diff-limit-input').on('input', '#blai-diff-limit-input', function() {
        const raw = String($(this).val() || '').trim();
        if (!/^\d+$/.test(raw)) return;
        const clamped = Math.max(minTrackedDiffMessages, Math.min(maxTrackedDiffMessages, Number(raw)));
        if (String(clamped) !== raw) $(this).val(clamped);
    });


    $(document).off('change', '#blai-diff-limit-input').on('change', '#blai-diff-limit-input', applyDiffLimitDraft);


    $(document).off('keydown', '#blai-diff-limit-input').on('keydown', '#blai-diff-limit-input', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyDiffLimitDraft();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            syncDiffLimitControlState();
        }
    });


    $(document).off('click', '#blai-diff-revert-toggle').on('click', '#blai-diff-revert-toggle', () => toggleCurrentDiffRevert());

    $(document).off('click', '#blai-diff-ai-rewrite').on('click', '#blai-diff-ai-rewrite', () => triggerCurrentDiffAiRewrite());

    $(document).off('click', '#blai-diff-baseline-btn').on('click', '#blai-diff-baseline-btn', (e) => {
        e.preventDefault();
        e.stopPropagation();
        establishDiffBaselineAtIndex(getCurrentDiffIndex());
    });


    $(document).off('click', '#blai-diff-pick-toggle').on('click', '#blai-diff-pick-toggle', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = getCurrentDiffIndex();
        const msg = getDiffMessageByIndex(index);
        setDiffPickMode(diffRuntimeState.diffPickMode !== true, msg);
        closeDiffActionsMenu();
    });

    $(document).off('click', '#blai-diff-pick-cancel').on('click', '#blai-diff-pick-cancel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDiffPickMode(false, getDiffMessageByIndex(getCurrentDiffIndex()));
    });

    $(document).off('click', '#blai-diff-pick-confirm').on('click', '#blai-diff-pick-confirm', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applySelectedDiffReverts();
    });


    $(document).off('click', '#blai-diff-modal-content del.blai-diff-change, #blai-diff-modal-content ins.blai-diff-change').on('click', '#blai-diff-modal-content del.blai-diff-change, #blai-diff-modal-content ins.blai-diff-change', function(e) {
        if (diffRuntimeState.diffPickMode === true) {
            e.preventDefault();
            e.stopPropagation();
            const id = $(this).attr('data-blai-revert-item');
            const targets = id
                ? $(`#blai-diff-modal-content [data-blai-revert-item="${id}"]`)
                : $(this);
            targets.toggleClass('blai-diff-change-picked');
            syncDiffPickConfirmState();
            return;
        }
        if (diffRuntimeState.diffRelatedRuleMode !== true) return;
        e.preventDefault();
        e.stopPropagation();
        $('#blai-diff-modal-content .blai-diff-change').removeClass('blai-diff-change-selected');
        $(this).addClass('blai-diff-change-selected');
        showRelatedRulesForDiffElement(this);
    });


    $(document).off('click', '.blai-diff-related-candidate').on('click', '.blai-diff-related-candidate', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const ruleIndex = Number($(this).attr('data-rule-index'));
        const subRuleIndex = Number($(this).attr('data-subrule-index'));
        const rules = extension_settings[extensionName]?.rules || [];
        if (!Number.isInteger(ruleIndex) || ruleIndex < 0 || ruleIndex >= rules.length) return;
        if (!Number.isInteger(subRuleIndex) || subRuleIndex < 0 || subRuleIndex >= (rules[ruleIndex]?.subRules || []).length) return;
        closeDiffRelatedModal();
        openEditModal(ruleIndex, { source: 'search', returnMode: 'related', subRuleIndex });
        openSingleRuleModal(subRuleIndex, { hideEditModal: true });
    });


    $(document).off('click', '#blai-diff-related-close').on('click', '#blai-diff-related-close', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeDiffRelatedModal();
    });

    $(document).off('click', '#blai-diff-related-modal').on('click', '#blai-diff-related-modal', function(e) {
        if (e.target && e.target.id === 'blai-diff-related-modal') closeDiffRelatedModal();
    });


    $(document).off('click', '#blai-diff-modal-close').on('click', '#blai-diff-modal-close', () => closeDiffModal());

    $(document).off('click', '#blai-diff-modal').on('click', '#blai-diff-modal', function(e) { if (e.target && e.target.id === 'blai-diff-modal') closeDiffModal(); });
}
