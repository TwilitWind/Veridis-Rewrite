/** view 的分块：preview。桌面/手机同一套两行顶栏：条目列表在左，条目导航与筛选在右；复选框在标题左侧。 */

import {
    filterDeepCleanPreviewItems,
    getRevertedBlockSet,
    isAiPreviewRelevant,
    isProgramPreviewRelevant,
    listRevertedBlocks,
    revertedBlockCount,
} from '../preview.js';
import { deepCleanSafeHtml, setDeepCleanWorkspaceHeader } from './view-00-selection.js';
import { renderDiffChangeTag } from '../../diff/compare.js';
import { deepCleanRuntimeState } from '../state.js';
import { resolveReviewRunsText } from '../review.js';

function previewKey(mode, itemIndex) {
    return `${mode}:${itemIndex}`;
}

function compactIdentity(item = {}) {
    const locator = item.locator || {};
    const hidden = item.isHidden === true ? ' · 已隐藏' : '';
    const number = Number.isInteger(locator.messageIndex) ? `消息 ${locator.messageIndex + 1}` : '聊天';
    if (item.kind === 'user-message') return `${number} · 用户${hidden}`;
    if (item.kind === 'assistant-swipe') {
        return `${number}${Number.isInteger(locator.swipeIndex) ? ` · Swipe ${locator.swipeIndex + 1}` : ''}${hidden}`;
    }
    if (item.kind === 'embedded-world-book-entry') return String(item.displayName || '世界书条目');
    if (item.kind === 'external-world-book-entry') {
        return `${item.displayName || '条目'}`;
    }
    return '内容项';
}

function characterName(run) {
    const key = String(run?.input?.characterKeys?.[0] || '');
    const characters = deepCleanRuntimeState.deepCleanSelection?.inventory?.characters;
    const character = Array.isArray(characters) ? characters.find((item) => item?.characterKey === key) : null;
    return character?.displayLabel || key || '未选择角色卡';
}

function filterCounts(preview) {
    return {
        all: preview.itemIndexes.length,
        program: preview.itemIndexes.filter((itemIndex) => isProgramPreviewRelevant(preview.run, itemIndex)).length,
        ai: preview.itemIndexes.filter((itemIndex) => isAiPreviewRelevant(preview.run, itemIndex)).length,
        included: preview.included.size,
        excluded: preview.skipped.size,
    };
}

function renderPreviewList(preview, items) {
    if (items.length === 0) return '<p class="blai-deep-clean-empty">当前筛选下没有条目。</p>';
    return items.map((itemIndex, listIndex) => {
        const item = preview.run.contentItems[itemIndex];
        const included = preview.included.has(itemIndex);
        const active = itemIndex === preview.currentItemIndex;
        return `
            <button type="button"
                class="blai-deep-clean-preview-row ${active ? 'is-active' : ''} ${included ? '' : 'is-skipped'}"
                data-deep-clean-preview-item="${itemIndex}"
                aria-current="${active ? 'true' : 'false'}"
                title="${deepCleanSafeHtml(compactIdentity(item))}">
                <span class="blai-deep-clean-preview-row-index">${listIndex + 1}</span>
                <span class="blai-deep-clean-preview-row-name">${deepCleanSafeHtml(compactIdentity(item))}</span>
                <i class="fas ${included ? 'fa-circle-check' : 'fa-circle-minus'}" aria-hidden="true"></i>
            </button>`;
    }).join('');
}

/** 预览差异与透视净化共用 del/ins 标记契约：删除线 + 来源色底纹，不复用审核态的选中样式。
    每个改写项左侧的复选框默认勾选；取消勾选 = 该项撤销改写、保留原文。 */
function renderPreviewDiffDocument(preview, reviewItem) {
    const section = preview.mode === 'ai' ? 'ai' : 'program';
    const itemIndex = preview.currentItemIndex;
    const reverted = getRevertedBlockSet(preview, itemIndex) || new Set();
    const blocks = reviewItem?.blocks || [];
    let changeIndex = -1;
    const renderBlock = (block, blockIndex) => {
        if (block.type === 'equal') {
            const text = resolveReviewRunsText(block.runs);
            if (!text) return '';
            return `<span class="blai-deep-clean-preview-equal">${deepCleanSafeHtml(text)}</span>`;
        }
        changeIndex += 1;
        const isReverted = reverted.has(blockIndex);
        const oldText = resolveReviewRunsText(block.oldRuns);
        const newText = resolveReviewRunsText(block.newRuns);
        const checkId = `blai-preview-change-${itemIndex}-${blockIndex}`;
        const deleted = oldText ? renderDiffChangeTag('delete', deepCleanSafeHtml(oldText), section) : '';
        const body = isReverted
            ? renderDiffChangeTag('delete', deepCleanSafeHtml(oldText), section)
            : `${deleted}${renderDiffChangeTag('insert', deepCleanSafeHtml(newText), section)}`;
        // 容器是 white-space:pre-wrap：模板里的缩进/换行会被当作正文显示，必须零空白拼接。
        return `<span class="blai-deep-clean-preview-change ${isReverted ? 'is-reverted' : ''}" data-blai-preview-change-block="${blockIndex}" data-blai-preview-change-index="${changeIndex}">`
            + `<span class="blai-deep-clean-preview-change-check">`
            + `<input id="${checkId}" class="blai-check-native" type="checkbox" data-deep-clean-preview-change-check="${blockIndex}" ${isReverted ? '' : 'checked'} aria-label="启用第 ${changeIndex + 1} 项改写">`
            + `</span><span class="blai-deep-clean-preview-change-body">${body}</span></span>`;
    };
    return `<div class="blai-diff-full-text blai-deep-clean-preview-diff">${blocks.map(renderBlock).join('')}</div>`;
}

function renderPreviewDocument(preview, itemIndex, entry) {
    const item = preview.run.contentItems[itemIndex];
    if (preview.loadingKey === previewKey(preview.mode, itemIndex)) {
        return '<div class="blai-deep-clean-preview-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><p>正在生成预览…</p></div>';
    }
    if (!entry) {
        return '<p class="blai-deep-clean-empty">切换到「AI 预览」并点击「生成 AI 预览」。</p>';
    }
    if (entry.status === 'oversized') {
        return '<p class="blai-deep-clean-empty">这条内容过长，未生成 AI 预览；执行时会保持原文。</p>';
    }
    if (entry.status === 'failed') {
        return '<p class="blai-deep-clean-empty">AI 预览失败，暂按原文显示。可以重试，也可以继续执行。</p>';
    }
    if (preview.view === 'original') {
        return `<div class="blai-deep-clean-preview-projection">${deepCleanSafeHtml(item?.originalText || '')}</div>`;
    }
    if (preview.view === 'result') {
        return `<div class="blai-deep-clean-preview-projection">${deepCleanSafeHtml(entry.text)}</div>`;
    }
    const reviewItem = entry.session?.reviewItems?.[0];
    if (!reviewItem) return '<p class="blai-deep-clean-empty">暂时无法生成差异预览。</p>';
    return renderPreviewDiffDocument(preview, reviewItem);
}

export function renderDeepCleanPreview(preview) {
    if (!preview) return;
    const content = document.getElementById('blai-deep-clean-content');
    // 整块重绘会丢失原生滚动位置；勾选与切条目都必须把这两处滚回原处。
    const oldList = content?.querySelector('.blai-deep-clean-preview-list');
    const oldDocument = content?.querySelector('.blai-deep-clean-preview-document');
    if (oldList) preview.listScrollTop = oldList.scrollTop;
    if (oldDocument) preview.documentScrollTop = oldDocument.scrollTop;

    const items = filterDeepCleanPreviewItems(preview);
    if (!items.includes(preview.currentItemIndex)) preview.currentItemIndex = items[0] ?? null;
    const position = items.indexOf(preview.currentItemIndex);
    const counts = filterCounts(preview);
    const canAi = isAiPreviewRelevant(preview.run, preview.currentItemIndex);
    const canProgram = isProgramPreviewRelevant(preview.run, preview.currentItemIndex);
    const entry = preview.currentItemIndex === null
        ? null
        : preview.diffCache.get(previewKey(preview.mode, preview.currentItemIndex));
    const selectedCount = preview.included.size;
    const allBlocks = entry?.session?.reviewItems?.[0]?.blocks || [];
    const changeBlockIndexes = allBlocks
        .map((block, index) => (block.type === 'diff' ? index : -1))
        .filter(index => index >= 0);
    const blockCount = changeBlockIndexes.length;
    if (preview.changeIndex >= blockCount) preview.changeIndex = Math.max(0, blockCount - 1);
    const currentRevertedCount = getRevertedBlockSet(preview, preview.currentItemIndex)?.size || 0;
    const revertedEntries = listRevertedBlocks(preview);

    setDeepCleanWorkspaceHeader(`预览并筛选 · ${characterName(preview.run)}`, '');
    if (items.length === 0) {
        $('#blai-deep-clean-content').html(`
            <section class="blai-deep-clean-preview-preview-empty">
                <p class="blai-deep-clean-empty">当前筛选下没有条目。</p>
                <div class="blai-deep-clean-actions">
                    <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-back aria-label="返回扫描结果" title="返回扫描结果">返回</button>
                    <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-filter="all">查看全部</button>
                </div>
            </section>
        `);
        return;
    }

    const filters = [
        ['all', '全部', counts.all],
        ['program', '程序', counts.program],
        ['ai', 'AI', counts.ai],
        ['included', '勾选', counts.included],
        ['excluded', '排除', counts.excluded],
    ];
    const activeFilter = filters.find(([value]) => value === preview.filter) || filters[0];
    const generateButton = canAi && preview.mode === 'ai'
        ? `<button type="button" data-deep-clean-preview-generate-ai aria-label="${entry?.status === 'failed' ? '重试 AI 预览' : '生成 AI 预览'}" title="${entry?.status === 'failed' ? '重试 AI 预览' : '生成 AI 预览'}" ${preview.loadingKey ? 'disabled' : ''}>${entry?.status === 'failed' ? '重试' : '生成'}</button>`
        : '';
    const listOpen = preview.listOpen === true;
    const currentItem = preview.run.contentItems[preview.currentItemIndex];

    // 同一组导航在桌面顶栏与手机底栏各渲染一次，靠 CSS 只显示当前断点需要的一份；
    // data 属性不变，事件仍走原来的委托绑定。
    const itemNavHtml = (mobile = false) => `
        <nav class="blai-deep-clean-preview-item-nav ${mobile ? 'is-mobile-nav' : ''}" aria-label="条目导航">
            <button type="button" data-deep-clean-preview-nav="previous" aria-label="上一个条目" title="上一个条目" ${position <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
            <span class="blai-deep-clean-preview-item-step"><span class="blai-deep-clean-preview-item-step-label">条目 </span>${position + 1}/${items.length}</span>
            <button type="button" data-deep-clean-preview-nav="next" aria-label="下一个条目" title="下一个条目" ${position >= items.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </nav>`;
    const entryBarHtml = (mobile = false) => `
        <div class="blai-deep-clean-preview-entry-bar ${mobile ? 'is-mobile-entry' : ''}">
            <label class="blai-deep-clean-preview-include" title="勾选后本条纳入本次清理，取消勾选则跳过"><input class="blai-check-native" type="checkbox" data-deep-clean-preview-include ${preview.included.has(preview.currentItemIndex) ? 'checked' : ''} aria-label="本条纳入清理"></label>
            <h3>条目·${deepCleanSafeHtml(compactIdentity(currentItem))}</h3>
            <div class="blai-deep-clean-preview-entry-trailing">${generateButton}</div>
        </div>`;
    const changeNavHtml = blockCount ? `
        <div class="blai-deep-clean-preview-change-nav" aria-label="改写项导航">
            <button type="button" data-deep-clean-preview-change="previous" aria-label="上一个改写项" title="上一个改写项"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
            <span class="blai-deep-clean-preview-change-counter ${currentRevertedCount ? 'has-reverted' : ''}" ${currentRevertedCount ? `title="本条目已撤销 ${currentRevertedCount} 项改写"` : ''}>改写 ${preview.changeIndex + 1}/${blockCount}${currentRevertedCount ? `<i class="fas fa-circle-minus blai-deep-clean-preview-change-reverted-dot" aria-hidden="true"></i>` : ''}</span>
            <button type="button" data-deep-clean-preview-change="next" aria-label="下一个改写项" title="下一个改写项"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </div>` : '';

    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-preview ${listOpen ? 'is-list-open' : ''}">
            <header class="blai-deep-clean-preview-header">
                <div class="blai-deep-clean-preview-bar">
                    <button type="button" class="blai-deep-clean-preview-list-toggle" data-deep-clean-preview-list-toggle aria-expanded="${listOpen}" aria-label="条目列表（${items.length}）" title="条目列表（${items.length}）"><i class="fas fa-list" aria-hidden="true"></i><span>${items.length}</span></button>
                    <div class="blai-deep-clean-preview-bar-trailing">
                        ${itemNavHtml(false)}
                        <div class="blai-deep-clean-preview-filter-wrap">
                            <button type="button" class="blai-deep-clean-preview-filter-trigger" data-deep-clean-preview-filter-trigger aria-haspopup="true" aria-expanded="false" aria-label="筛选：${activeFilter[1]} ${activeFilter[2]}"><span class="blai-deep-clean-preview-filter-trigger-label">${activeFilter[1]}</span><span class="blai-deep-clean-preview-filter-trigger-count">${activeFilter[2]}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
                            <div class="blai-deep-clean-preview-filter-menu" hidden>
                                ${filters.map(([value, label, count]) => `<button type="button" class="blai-deep-clean-preview-filter-option" data-deep-clean-preview-filter="${value}" aria-pressed="${preview.filter === value}"><span>${label}</span><span class="blai-deep-clean-preview-filter-option-count">${count}</span></button>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                ${entryBarHtml(false)}
            </header>
            ${listOpen ? `<nav class="blai-deep-clean-preview-list" aria-label="命中条目">${renderPreviewList(preview, items)}</nav>` : ''}
            <main class="blai-deep-clean-preview-detail">
                <div class="blai-deep-clean-preview-document" role="document">
                    ${renderPreviewDocument(preview, preview.currentItemIndex, entry)}
                </div>
            </main>
            <div class="blai-deep-clean-preview-toolbar">
                ${entryBarHtml(true)}
                <div class="blai-deep-clean-preview-nav-strip">
                    ${itemNavHtml(true)}
                    ${changeNavHtml}
                </div>
            </div>
            <footer class="blai-deep-clean-preview-actions">
                ${revertedEntries.length ? `<button class="blai-deep-clean-preview-reverted-open" type="button" data-deep-clean-preview-reverted-open aria-label="查看已撤销改写（${revertedEntries.length}）" title="查看已撤销改写（${revertedEntries.length}）"><i class="fas fa-rotate-left" aria-hidden="true"></i>已撤销 ${revertedEntries.length}</button>` : ''}
                <span class="blai-deep-clean-preview-actions-spacer"></span>
                <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-back aria-label="返回扫描结果" title="返回扫描结果">返回</button>
                <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-run-all aria-label="清理全部（${preview.itemIndexes.length}）" title="清理全部（${preview.itemIndexes.length}）">清理全部（${preview.itemIndexes.length}）</button>
                <button class="blai-deep-clean-primary-action" type="button" data-deep-clean-preview-run aria-label="清理所选（${selectedCount}）" title="清理所选（${selectedCount}）" ${selectedCount === 0 ? 'disabled' : ''}>清理所选（${selectedCount}）</button>
            </footer>
        </div>
    `);

    const list = content?.querySelector('.blai-deep-clean-preview-list');
    if (list) {
        list.scrollTop = Number(preview.listScrollTop) || 0;
        const active = list.querySelector('.blai-deep-clean-preview-row.is-active');
        if (active && preview.revealActiveRow === true) active.scrollIntoView({ block: 'nearest' });
    }
    preview.revealActiveRow = false;
    const documentPane = content?.querySelector('.blai-deep-clean-preview-document');
    if (documentPane) documentPane.scrollTop = Number(preview.documentScrollTop) || 0;
}
