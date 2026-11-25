/** view 的分块：preview。逐条展示程序 / AI 预览，支持筛选与取消条目。 */

import {
    filterDeepCleanPreviewItems,
    getPreviewItemModes,
    isAiPreviewRelevant,
    isProgramPreviewRelevant,
} from '../preview.js';
import { deepCleanSafeHtml, deepCleanReviewIdentity, setDeepCleanWorkspaceHeader } from './view-00-selection.js';
import { renderDeepCleanReviewDocument } from './view-01-progress.js';

const LIST_WINDOW = 24;

function readOnlyDocumentHtml(html) {
    return String(html || '')
        .replace(/\s+contenteditable="[^"]*"/g, '')
        .replace(/\s+tabindex="0"/g, '')
        .replace(/\s+role="textbox"/g, '');
}

function previewKey(mode, itemIndex) {
    return `${mode}:${itemIndex}`;
}

function filterCounts(preview) {
    return {
        all: preview.itemIndexes.length,
        program: preview.itemIndexes.filter((itemIndex) => isProgramPreviewRelevant(preview.run, itemIndex)).length,
        ai: preview.itemIndexes.filter((itemIndex) => isAiPreviewRelevant(preview.run, itemIndex)).length,
        skipped: preview.skipped.size,
    };
}

function modeLabel(run, itemIndex) {
    const modes = getPreviewItemModes(run, itemIndex);
    if (run.input?.processingMode === 'program-ai' && modes.includes('ai')) {
        return modes.includes('program') ? '程序 + AI' : 'AI 改写';
    }
    return '程序改写';
}

function renderPreviewList(preview, items, position) {
    if (items.length === 0) {
        return '<p class="blai-deep-clean-empty">当前筛选下没有条目。</p>';
    }
    const start = Math.max(0, position - Math.floor(LIST_WINDOW / 2));
    const end = Math.min(items.length, start + LIST_WINDOW);
    const rows = items.slice(start, end).map((itemIndex) => {
        const item = preview.run.contentItems[itemIndex];
        const included = preview.included.has(itemIndex);
        const active = itemIndex === preview.currentItemIndex;
        return `
            <button type="button"
                class="blai-deep-clean-preview-row ${active ? 'is-active' : ''} ${included ? '' : 'is-skipped'}"
                data-deep-clean-preview-item="${itemIndex}"
                aria-current="${active ? 'true' : 'false'}">
                <span class="blai-deep-clean-preview-row-index">${items.indexOf(itemIndex) + 1}</span>
                <span class="blai-deep-clean-preview-row-copy">
                    <strong>${deepCleanSafeHtml(deepCleanReviewIdentity(item))}</strong>
                    <small>${deepCleanSafeHtml(modeLabel(preview.run, itemIndex))}${included ? '' : ' · 已取消'}</small>
                </span>
                <i class="fas ${included ? 'fa-circle-check' : 'fa-circle-minus'}" aria-hidden="true"></i>
            </button>`;
    }).join('');
    const before = start > 0
        ? `<p class="blai-deep-clean-preview-list-gap">前面还有 ${start} 项</p>`
        : '';
    const after = end < items.length
        ? `<p class="blai-deep-clean-preview-list-gap">后面还有 ${items.length - end} 项</p>`
        : '';
    return `${before}${rows}${after}`;
}

function renderPreviewDocument(preview, itemIndex, entry) {
    const item = preview.run.contentItems[itemIndex];
    if (preview.loadingKey === previewKey(preview.mode, itemIndex)) {
        return '<div class="blai-deep-clean-preview-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><p>正在生成预览…</p></div>';
    }
    if (!entry) {
        return '<p class="blai-deep-clean-empty">切换到「AI 改写预览」并点击「生成 AI 预览」。</p>';
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
    return readOnlyDocumentHtml(renderDeepCleanReviewDocument(reviewItem));
}

export function renderDeepCleanPreview(preview) {
    if (!preview) return;
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

    setDeepCleanWorkspaceHeader('预览并筛选', '逐条查看改写结果，取消不需要的条目后执行。');
    if (items.length === 0) {
        $('#blai-deep-clean-content').html(`
            <section class="blai-deep-clean-preview-preview-empty">
                <p class="blai-deep-clean-empty">当前筛选下没有条目。</p>
                <div class="blai-deep-clean-actions">
                    <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-back>关闭</button>
                    <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-filter="all">查看全部</button>
                </div>
            </section>
        `);
        return;
    }

    const filters = [
        ['all', '全部', counts.all],
        ['program', '程序改写', counts.program],
        ['ai', 'AI 改写', counts.ai],
        ['skipped', '已取消', counts.skipped],
    ];
    const modeButtons = [
        canProgram ? `<button type="button" data-deep-clean-preview-mode="program" aria-pressed="${preview.mode === 'program'}">程序改写预览</button>` : '',
        canAi ? `<button type="button" data-deep-clean-preview-mode="ai" aria-pressed="${preview.mode === 'ai'}">AI 改写预览</button>` : '',
    ].filter(Boolean).join('');
    const viewButtons = [
        ['diff', '差异'],
        ['original', '原文'],
        ['result', '结果'],
    ].map(([value, label]) => `<button type="button" data-deep-clean-preview-view="${value}" aria-pressed="${preview.view === value}">${label}</button>`).join('');
    const generateButton = canAi && preview.mode === 'ai'
        ? `<button type="button" class="blai-deep-clean-secondary-action" data-deep-clean-preview-generate-ai ${preview.loadingKey ? 'disabled' : ''}>${entry?.status === 'failed' ? '重试 AI 预览' : '生成 AI 预览'}</button>`
        : '';
    const aiCacheNote = preview.run.input?.processingMode === 'program-ai'
        ? '<p class="blai-deep-clean-preview-note">已生成的 AI 预览会直接用于执行，不会重复请求。</p>'
        : '';

    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-preview">
            <header class="blai-deep-clean-preview-header">
                <nav class="blai-deep-clean-preview-filters" aria-label="预览筛选">
                    ${filters.map(([value, label, count]) => `<button type="button" data-deep-clean-preview-filter="${value}" aria-pressed="${preview.filter === value}">${label}<span>${count}</span></button>`).join('')}
                </nav>
                ${aiCacheNote}
            </header>
            <div class="blai-deep-clean-preview-main">
                <aside class="blai-deep-clean-preview-list" aria-label="命中条目">${renderPreviewList(preview, items, position)}</aside>
                <main class="blai-deep-clean-preview-detail">
                    <header class="blai-deep-clean-preview-head">
                        <div class="blai-deep-clean-preview-identity">
                            <span class="blai-deep-clean-preview-step">第 ${position + 1} / ${items.length} 项</span>
                            <h3>${deepCleanSafeHtml(deepCleanReviewIdentity(preview.run.contentItems[preview.currentItemIndex]))}</h3>
                            <span class="blai-deep-clean-preview-badge">${deepCleanSafeHtml(modeLabel(preview.run, preview.currentItemIndex))}</span>
                        </div>
                        <label class="blai-deep-clean-preview-include">
                            <input type="checkbox" data-deep-clean-preview-include ${preview.included.has(preview.currentItemIndex) ? 'checked' : ''}>
                            <span>纳入本次清理</span>
                        </label>
                    </header>
                    <div class="blai-deep-clean-preview-toolbar">
                        <nav class="blai-deep-clean-preview-tabs" aria-label="预览方式">${modeButtons}</nav>
                        <nav class="blai-deep-clean-preview-views" aria-label="预览视图">${viewButtons}</nav>
                        <div class="blai-deep-clean-preview-tools">
                            ${generateButton}
                            <button type="button" class="blai-deep-clean-secondary-action" data-deep-clean-preview-nav="previous" ${position <= 0 ? 'disabled' : ''}>上一个</button>
                            <button type="button" class="blai-deep-clean-secondary-action" data-deep-clean-preview-nav="next" ${position >= items.length - 1 ? 'disabled' : ''}>下一个</button>
                        </div>
                    </div>
                    <div class="blai-deep-clean-preview-document" role="document">${renderPreviewDocument(preview, preview.currentItemIndex, entry)}</div>
                </main>
            </div>
            <footer class="blai-deep-clean-preview-actions">
                <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-back>返回扫描结果</button>
                <button class="blai-deep-clean-secondary-action" type="button" data-deep-clean-preview-run-all>全部执行（${preview.itemIndexes.length}）</button>
                <button class="blai-deep-clean-primary-action" type="button" data-deep-clean-preview-run ${selectedCount === 0 ? 'disabled' : ''}>执行所选（${selectedCount}）</button>
            </footer>
        </div>
    `);
}
