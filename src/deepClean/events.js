// 负责深度净化的用户操作绑定，并把生命周期与复核变更委托给现有深度净化负责人。
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { showConfirmModal } from '../ui/notifications.js';
import { deepCleanRuntimeState } from './state.js';
import { logger } from '../log.js';
import {
    getDeepCleanInitialSelection,
    getDeepCleanLookaheadProgress,
    getDeepCleanReviewSession,
    requestDeepCleanStop,
    setDeepCleanFinalSelection,
    setDeepCleanLocalOption,
    applyDeepCleanPreviewSelection,
    runDeepCleanProgramProcessing,
    runDeepCleanScan,
    runDeepCleanApply,
    returnToDeepCleanSelection,
    startDeepCleanRun,
} from './lifecycle.js';
import {
    cancelDeepCleanReviewComparisons,
    selectDeepCleanReviewBlock,
    setDeepCleanReviewBlockText,
    setDeepCleanReviewEqualText,
    setDeepCleanReviewCurrentItem,
    setDeepCleanReviewViewMode,
    waitForDeepCleanReviewEdits,
} from './review.js';
import {
    closeDeepCleanInitialSelection,
    openDeepCleanInitialSelection,
    renderDeepCleanInitialSelection,
    renderDeepCleanScanProgress,
    renderDeepCleanScanResult,
    renderDeepCleanBatchProgress,
    renderDeepCleanLookaheadProgress,
    renderDeepCleanReview,
    renderDeepCleanApplyProgress,
    renderDeepCleanComplete,
    renderDeepCleanPreview,
    showInitialSelectionError,
} from './view.js';
import { openDeepCleanRevertedModal, closeDeepCleanRevertedModal } from './view/view-04-reverted-modal.js';
import {
    createDeepCleanPreviewSession,
    ensureDeepCleanPreviewEntry,
    setDeepCleanPreviewFilter,
    setDeepCleanPreviewIncluded,
    stepDeepCleanPreview,
    cancelDeepCleanPreviewRequest,
    toggleDeepCleanPreviewBlock,
    listRevertedBlocks,
} from './preview.js';

export function bindDeepCleanEvents() {
const showReviewError = (error) => {
    logger.error('[Deep Clean] Review comparison failed', error);
    if (getDeepCleanReviewSession()) requestDeepCleanStop();
    showInitialSelectionError(error);
};
const withReadyReview = async (action) => {
    const session = getDeepCleanReviewSession();
    if (!session) return;
    try {
        await waitForDeepCleanReviewEdits(session);
        if (getDeepCleanReviewSession() === session) action(session);
    } catch (error) { showReviewError(error); }
};
const renderDeepCleanSelection = (selection = getDeepCleanInitialSelection()) => {
    renderDeepCleanInitialSelection(selection, getAppContext().extension_settings[extensionName]?.presets || {});
};
// 停止后不再进入「已停止」死胡同：回到保留选择的资源页，继续扫描或返回都可用。
const handleDeepCleanStopped = () => {
    const selection = returnToDeepCleanSelection();
    if (selection) renderDeepCleanSelection(selection);
    else closeDeepCleanInitialSelection();
};
const updateDeepCleanFinalSelection = (kind, value, checked) => {
    const selection = getDeepCleanInitialSelection();
    if (!selection) return;
    const propertyByKind = {
        chat: 'chatKeys',
        'world-book': 'worldBookKeys',
    };
    const current = selection[propertyByKind[kind]] || [];
    const next = checked
        ? (current.includes(value) ? current : [...current, value])
        : current.filter((item) => item !== value);
    renderDeepCleanSelection(setDeepCleanFinalSelection(kind, next));
};

$(document).off('click', '#blai-deep-clean-btn').on('click', '#blai-deep-clean-btn', async () => {
    const activeSession = getDeepCleanReviewSession();
    const activePhase = ['frozen', 'scan-result', 'batch-processing', 'review', 'apply', 'stopping'].includes(deepCleanRuntimeState.deepCleanPhase);
    openDeepCleanInitialSelection({ preserveContent: activePhase || Boolean(activeSession) });
    if (activeSession) {
        await withReadyReview(session => renderDeepCleanReview(session, getDeepCleanLookaheadProgress()));
        return;
    }
    if (activePhase) {
        const previewSession = deepCleanRuntimeState.deepCleanSelection?.previewSession;
        if (previewSession) renderDeepCleanPreview(previewSession);
        return;
    }
    // 每次进入初始选择都重新读取资源清单：绑定的世界书/知识书可能在外部变动过，不能复用旧快照。
    try {
        renderDeepCleanSelection(await startDeepCleanRun());
    } catch (error) {
        logger.error('[Deep Clean] 读取 Initial Selection 资源失败', error);
        showInitialSelectionError(error);
    }
});

const confirmDiscardDeepClean = (action = 'close') => {
    const phase = deepCleanRuntimeState.deepCleanPhase;
    const inProgress = ['frozen', 'scan-result', 'batch-processing', 'review', 'apply', 'stopping'].includes(phase);
    if (action === 'stop') {
        return showConfirmModal(
            '停止后本次清理不会写入任何内容，扫描与审核结果将丢弃。确定停止吗？',
            { okText: '停止' },
        );
    }
    return showConfirmModal(
        inProgress
            ? '深度清理尚未完成，关闭后会丢失本次扫描、预览与审核结果。确定关闭吗？'
            : '确定关闭深度清理吗？',
        { okText: '关闭' },
    );
};

$(document).off('click', '#blai-deep-clean-close').on('click', '#blai-deep-clean-close', async function() {
    if ($(this).hasClass('blai-deep-clean-header-icon') && !await confirmDiscardDeepClean()) return;
    closeDeepCleanInitialSelection();
});

$(document).off('click', '#blai-deep-clean-back-to-selection').on('click', '#blai-deep-clean-back-to-selection', () => {
    renderDeepCleanSelection(returnToDeepCleanSelection());
});

$(document).off('click', '#blai-deep-clean-scan').on('click', '#blai-deep-clean-scan', async () => {
    try {
        const run = await runDeepCleanScan({
            onProgress: renderDeepCleanScanProgress,
        });
        if (run?.scanResult) renderDeepCleanScanResult(run.scanResult);
        else if (deepCleanRuntimeState.deepCleanPhase === 'stopped') handleDeepCleanStopped();
    } catch (error) {
        logger.error('[Deep Clean] scan failed', error);
        showInitialSelectionError(error);
    }
});

const startDeepCleanProcessing = async () => {
    try {
        const result = await runDeepCleanProgramProcessing({
            onProgress: renderDeepCleanBatchProgress,
            onLookaheadProgress: renderDeepCleanLookaheadProgress,
        });
        if (result?.complete) renderDeepCleanComplete(result.summary);
        else if (result) renderDeepCleanReview(result, getDeepCleanLookaheadProgress());
        else if (deepCleanRuntimeState.deepCleanPhase === 'stopped') handleDeepCleanStopped();
    } catch (error) {
        logger.error('[Deep Clean] Batch processing failed', error);
        showInitialSelectionError(error);
    }
};

$(document).off('click', '#blai-deep-clean-process-program').on('click', '#blai-deep-clean-process-program', async () => {
    const affected = Number(deepCleanRuntimeState.deepCleanSelection?.run?.scanResult?.affectedItemCount) || 0;
    if (!await showConfirmModal(`本次将处理 ${affected} 个命中内容项并写回正式数据，操作不可撤销。确定执行清理吗？`, { okText: '执行' })) return;
    startDeepCleanProcessing();
});

const currentPreviewSession = () => deepCleanRuntimeState.deepCleanSelection?.previewSession || null;

const loadPreviewEntry = (preview, { retry = false } = {}) => {
    if (!preview || preview.currentItemIndex === null) return;
    const key = `${preview.mode}:${preview.currentItemIndex}`;
    if (!retry && preview.diffCache.has(key)) {
        preview.loadingKey = null;
        renderDeepCleanPreview(preview);
        return;
    }
    cancelDeepCleanPreviewRequest(preview);
    preview.changeIndex = 0;
    const controller = new AbortController();
    preview.abortController = controller;
    preview.loadingKey = key;
    const token = ++preview.renderToken;
    renderDeepCleanPreview(preview);
    ensureDeepCleanPreviewEntry(preview, preview.currentItemIndex, preview.mode, {
        signal: controller.signal,
        retry,
    }).then(() => {
        if (token !== preview.renderToken) return;
        preview.loadingKey = null;
        preview.abortController = null;
        renderDeepCleanPreview(preview);
    }).catch((error) => {
        if (token !== preview.renderToken) return;
        preview.loadingKey = null;
        preview.abortController = null;
        renderDeepCleanPreview(preview);
        logger.error('[Deep Clean] preview failed', error);
    });
};

const commitPreviewAndRun = async (preview, runAll) => {
    if (!preview) return;
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    if (!lifecycle) return;
    if (runAll) {
        preview.skipped.clear();
        preview.included = new Set(preview.itemIndexes);
    }
    if (preview.included.size === 0) return;
    if (!await showConfirmModal(`本次将对 ${preview.included.size} 个内容项执行清理并写回正式数据，操作不可撤销。确定执行吗？`, { okText: '执行' })) return;
    applyDeepCleanPreviewSelection(lifecycle, preview.skipped, preview.aiCache, preview.revertedBlocks);
    // 执行前取消在途预览：否则 AI 预览回调会在处理进度页上重绘预览。
    cancelDeepCleanPreviewRequest(preview);
    lifecycle.previewSession = null;
    startDeepCleanProcessing();
};

$(document).off('click', '#blai-deep-clean-preview').on('click', '#blai-deep-clean-preview', () => {
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    if (!lifecycle?.run?.scanResult) return;
    cancelDeepCleanReviewComparisons(lifecycle.currentReviewSession);
    const preview = createDeepCleanPreviewSession(lifecycle);
    if (!preview) return;
    preview.view = 'diff';
    lifecycle.previewSession = preview;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-filter]').on('click', '[data-deep-clean-preview-filter]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.listOpen = false;
    preview.listScrollTop = 0;
    preview.changeIndex = 0;
    setDeepCleanPreviewFilter(preview, String($(this).attr('data-deep-clean-preview-filter') || 'all'));
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-list-toggle]').on('click', '[data-deep-clean-preview-list-toggle]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.listOpen = preview.listOpen !== true;
    preview.revealActiveRow = preview.listOpen;
    renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-item]').on('click', '[data-deep-clean-preview-item]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.currentItemIndex = Number($(this).attr('data-deep-clean-preview-item'));
    preview.listOpen = false;
    preview.changeIndex = 0;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-nav]').on('click', '[data-deep-clean-preview-nav]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.listOpen = false;
    stepDeepCleanPreview(preview, String($(this).attr('data-deep-clean-preview-nav')) === 'previous' ? -1 : 1);
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-mode]').on('click', '[data-deep-clean-preview-mode]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    const mode = String($(this).attr('data-deep-clean-preview-mode') || 'program');
    if (preview.mode === mode) return;
    preview.mode = mode;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-view]').on('click', '[data-deep-clean-preview-view]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.view = String($(this).attr('data-deep-clean-preview-view') || 'diff');
    renderDeepCleanPreview(preview);
});

$(document).off('change', '[data-deep-clean-preview-include]').on('change', '[data-deep-clean-preview-include]', function() {
    const preview = currentPreviewSession();
    if (!preview || preview.currentItemIndex === null) return;
    setDeepCleanPreviewIncluded(preview, preview.currentItemIndex, this.checked === true);
    const row = document.querySelector(`[data-deep-clean-preview-item="${preview.currentItemIndex}"]`);
    if (row) {
        row.classList.toggle('is-skipped', !this.checked);
        const icon = row.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-circle-check', this.checked);
            icon.classList.toggle('fa-circle-minus', !this.checked);
        }
    }
    $('[data-deep-clean-preview-run]')
        .text(`清理所选（${preview.included.size}）`)
        .attr('aria-label', `清理所选（${preview.included.size}）`)
        .attr('title', `清理所选（${preview.included.size}）`)
        .prop('disabled', preview.included.size === 0);
    $('[data-deep-clean-preview-filter="included"] span').text(String(preview.included.size));
    $('[data-deep-clean-preview-filter="excluded"] span').text(String(preview.skipped.size));
    if (preview.filter === 'included' || preview.filter === 'excluded') renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-generate-ai]').on('click', '[data-deep-clean-preview-generate-ai]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.mode = 'ai';
    loadPreviewEntry(preview, { retry: true });
});

let locatedChangeBlock = null;
let locateHighlightTimer = 0;

const locateDeepCleanPreviewChange = (preview, blockIndex) => {
    const target = document.querySelector(`[data-blai-preview-change-block="${blockIndex}"]`);
    if (!(target instanceof HTMLElement)) return;
    const documentPane = document.querySelector('.blai-deep-clean-preview-document');
    if (documentPane) {
        const offset = target.offsetTop - documentPane.offsetTop;
        documentPane.scrollTop = Math.max(0, offset - documentPane.clientHeight / 2);
        preview.documentScrollTop = documentPane.scrollTop;
    }
    // 高亮落在整段改写项上；聚焦复选框会让已勾选态看起来像被取消勾选。
    if (locatedChangeBlock && locatedChangeBlock !== target) locatedChangeBlock.classList.remove('is-located');
    const active = document.activeElement;
    if (active instanceof HTMLElement && target.contains(active)) active.blur();
    target.classList.add('is-located');
    locatedChangeBlock = target;
    window.clearTimeout(locateHighlightTimer);
    locateHighlightTimer = window.setTimeout(() => {
        target.classList.remove('is-located');
        if (locatedChangeBlock === target) locatedChangeBlock = null;
    }, 1200);
};

$(document).off('click', '[data-deep-clean-preview-change]').on('click', '[data-deep-clean-preview-change]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    const entry = preview.diffCache.get(`${preview.mode}:${preview.currentItemIndex}`);
    const blockIndexes = (entry?.session?.reviewItems?.[0]?.blocks || [])
        .map((block, index) => (block.type === 'diff' ? index : -1))
        .filter(index => index >= 0);
    if (blockIndexes.length === 0) return;
    const direction = String($(this).attr('data-deep-clean-preview-change')) === 'previous' ? -1 : 1;
    preview.changeIndex = (preview.changeIndex + direction + blockIndexes.length) % blockIndexes.length;
    renderDeepCleanPreview(preview);
    locateDeepCleanPreviewChange(preview, blockIndexes[preview.changeIndex]);
});

$(document).off('change', '[data-deep-clean-preview-change-check]').on('change', '[data-deep-clean-preview-change-check]', function() {
    const preview = currentPreviewSession();
    if (!preview || preview.currentItemIndex === null) return;
    const blockIndex = Number($(this).attr('data-deep-clean-preview-change-check'));
    toggleDeepCleanPreviewBlock(preview, preview.currentItemIndex, blockIndex);
    renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-reverted-open]').on('click', '[data-deep-clean-preview-reverted-open]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    const entries = listRevertedBlocks(preview);
    openDeepCleanRevertedModal(entries, (entry) => {
        const active = currentPreviewSession();
        if (!active) return;
        const itemIndex = Number(entry.itemIndex);
        const blockIndex = Number(entry.blockIndex);
        if (active.currentItemIndex !== itemIndex) {
            active.currentItemIndex = itemIndex;
            active.changeIndex = 0;
            loadPreviewEntry(active);
        }
        const session = active.diffCache.get(`${active.mode}:${itemIndex}`);
        const blockIndexes = (session?.session?.reviewItems?.[0]?.blocks || [])
            .map((block, index) => (block.type === 'diff' ? index : -1))
            .filter(index => index >= 0);
        active.changeIndex = Math.max(0, blockIndexes.indexOf(blockIndex));
        renderDeepCleanPreview(active);
        requestAnimationFrame(() => locateDeepCleanPreviewChange(active, blockIndex));
    });
});

$(document).off('click', '[data-deep-clean-preview-back]').on('click', '[data-deep-clean-preview-back]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    closeDeepCleanRevertedModal();
    cancelDeepCleanPreviewRequest(preview);
    deepCleanRuntimeState.deepCleanSelection.previewSession = null;
    renderDeepCleanScanResult(preview.run.scanResult);
});

$(document).off('click', '[data-deep-clean-preview-run]').on('click', '[data-deep-clean-preview-run]', () => {
    commitPreviewAndRun(currentPreviewSession(), false);
});

$(document).off('click', '[data-deep-clean-preview-run-all]').on('click', '[data-deep-clean-preview-run-all]', () => {
    commitPreviewAndRun(currentPreviewSession(), true);
});

const focusDeepCleanReviewBlock = (blockIndex, branch) => {
    const target = document.querySelector(`[data-deep-clean-review-block-branch="${branch}"][data-deep-clean-review-block-index="${blockIndex}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.focus();
    if (target.matches('[data-deep-clean-review-empty-branch]')) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
};
const chooseDeepCleanReviewBlock = (element) => {
    const blockIndex = Number($(element).attr('data-deep-clean-review-block-index'));
    const branch = String($(element).attr('data-deep-clean-review-block-branch') || '');
    const alreadyActive = element.classList.contains('is-active');
    if (alreadyActive) return;
    return withReadyReview(session => {
        selectDeepCleanReviewBlock(session, session.currentItemIndex, blockIndex, branch);
        renderDeepCleanReview(session, getDeepCleanLookaheadProgress());
        focusDeepCleanReviewBlock(blockIndex, branch);
    });
};

$(document).off('click', '[data-deep-clean-review-block-branch]').on('click', '[data-deep-clean-review-block-branch]', function() {
    chooseDeepCleanReviewBlock(this);
});

$(document).off('keydown', '[data-deep-clean-review-block-branch]').on('keydown', '[data-deep-clean-review-block-branch]', function(event) {
    if (this.classList.contains('is-active')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    chooseDeepCleanReviewBlock(this);
});

$(document).off('input', '[data-deep-clean-review-block-branch].is-active').on('input', '[data-deep-clean-review-block-branch].is-active', function() {
    const session = getDeepCleanReviewSession();
    if (!session) return;
    const blockIndex = Number($(this).attr('data-deep-clean-review-block-index'));
    setDeepCleanReviewBlockText(session, session.currentItemIndex, blockIndex, this.innerText).catch(showReviewError);
});

$(document).off('input', '[data-deep-clean-review-equal-block-index]').on('input', '[data-deep-clean-review-equal-block-index]', function() {
    const session = getDeepCleanReviewSession();
    if (!session) return;
    const blockIndex = Number($(this).attr('data-deep-clean-review-equal-block-index'));
    setDeepCleanReviewEqualText(session, session.currentItemIndex, blockIndex, this.innerText).catch(showReviewError);
});

$(document).off('click', '[data-deep-clean-review-view]').on('click', '[data-deep-clean-review-view]', function() {
    const viewMode = String($(this).attr('data-deep-clean-review-view') || '');
    return withReadyReview(session => {
        if (session.viewMode === viewMode) return;
        setDeepCleanReviewViewMode(session, viewMode);
        renderDeepCleanReview(session, getDeepCleanLookaheadProgress());
    });
});

$(document).off('click', '[data-deep-clean-review-nav]').on('click', '[data-deep-clean-review-nav]', function() {
    const direction = String($(this).attr('data-deep-clean-review-nav') || '');
    return withReadyReview(session => {
        const position = session.reviewItemIndexes.indexOf(session.currentItemIndex);
        const nextPosition = direction === 'previous' ? position - 1 : position + 1;
        if (nextPosition < 0 || nextPosition >= session.reviewItemIndexes.length) return;
        setDeepCleanReviewCurrentItem(session, session.reviewItemIndexes[nextPosition]);
        renderDeepCleanReview(session, getDeepCleanLookaheadProgress());
    });
});

$(document).off('click', '#blai-deep-clean-stop').on('click', '#blai-deep-clean-stop', async function() {
    if ($(this).hasClass('blai-deep-clean-header-icon') && !await confirmDiscardDeepClean('stop')) return;
    $(this).prop('disabled', true);
    const stoppedPhase = requestDeepCleanStop();
    if (stoppedPhase === 'stopped') handleDeepCleanStopped();
});

$(document).off('click', '#blai-deep-clean-apply').on('click', '#blai-deep-clean-apply', async function() {
    const session = getDeepCleanReviewSession();
    if (!session) return;
    $(this).prop('disabled', true);
    $('#blai-deep-clean-content [contenteditable="true"]').attr('contenteditable', 'false');
    $('#blai-deep-clean-content [contenteditable="true"]').attr('contenteditable', 'false');
    try {
        const result = await runDeepCleanApply({
            onProgress: renderDeepCleanApplyProgress,
            onLookaheadProgress: renderDeepCleanLookaheadProgress,
        });
        if (result?.stopped) handleDeepCleanStopped();
        else if (result?.nextSession) renderDeepCleanReview(result.nextSession, getDeepCleanLookaheadProgress());
        else if (result?.complete) renderDeepCleanComplete(result.summary);
    } catch (error) {
        logger.error('[Deep Clean] apply failed', error);
        showInitialSelectionError(error);
    }
});

$(document).off('change', '[data-deep-clean-resource]').on('change', '[data-deep-clean-resource]', function() {
    const kind = String($(this).attr('data-deep-clean-resource') || '');
    const value = decodeURIComponent(String($(this).attr('data-deep-clean-value') || ''));
    updateDeepCleanFinalSelection(kind, value, this.checked);
});

$(document).off('click', '[data-deep-clean-search-selection]').on('click', '[data-deep-clean-search-selection]', function() {
    const kind = String($(this).attr('data-deep-clean-search-selection') || '');
    const action = String($(this).attr('data-deep-clean-search-selection-action') || '');
    const selection = getDeepCleanInitialSelection();
    const propertyByKind = {
        chat: 'chatKeys',
        'world-book': 'worldBookKeys',
    };
    const property = propertyByKind[kind];
    if (!selection || !property || (action !== 'select' && action !== 'deselect')) return;
    const currentSearchKeys = $(`[data-deep-clean-resource="${kind}"]`).map((_, input) => (
        decodeURIComponent(String($(input).attr('data-deep-clean-value') || ''))
    )).get();
    const next = action === 'select'
        ? [...selection[property], ...currentSearchKeys.filter((key) => !selection[property].includes(key))]
        : selection[property].filter((key) => !currentSearchKeys.includes(key));
    renderDeepCleanSelection(setDeepCleanFinalSelection(kind, next));
});

$(document).off('change', '[data-deep-clean-option]').on('change', '[data-deep-clean-option]', function() {
    const option = String($(this).attr('data-deep-clean-option') || '');
    // 复选框传 checked 布尔值；单选/下拉传 value。
    const value = this instanceof HTMLInputElement && this.type === 'checkbox' ? this.checked : $(this).val();
    const selection = setDeepCleanLocalOption(option, value);
    if (selection && option === 'includeHidden') renderDeepCleanSelection(selection);
    else if (selection && this instanceof HTMLInputElement && this.type === 'radio') renderDeepCleanSelection(selection);
});

$(document).off('click', '[data-deep-clean-option-choice]').on('click', '[data-deep-clean-option-choice]', function() {
    const selection = setDeepCleanLocalOption(
        String($(this).attr('data-deep-clean-option-choice') || ''),
        String($(this).attr('data-deep-clean-option-value') || ''),
    );
    if (selection) renderDeepCleanSelection(selection);
});

$(document).off('input', '[data-deep-clean-search]').on('input', '[data-deep-clean-search]', function() {
    const searchName = String($(this).attr('data-deep-clean-search') || '');
    const value = String($(this).val() || '');
    renderDeepCleanSelection();
    const input = document.querySelector(`[data-deep-clean-search="${searchName}"]`);
    if (input instanceof HTMLInputElement) {
        input.focus();
        input.setSelectionRange(value.length, value.length);
    }
});

}
