/** view 的分块：selection。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { deepCleanRuntimeState } from '../state.js';

export function deepCleanSafeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function deepCleanSearchValue(name) {
    return String($(`[data-deep-clean-search="${name}"]`).val() || '');
}

function deepCleanMatchesSearch(item, query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return true;
    return String(item.displayLabel || '').toLocaleLowerCase().includes(normalizedQuery)
        || String(item.characterKey || item.personaKey || item.worldBookKey || item.chatId || '')
            .toLocaleLowerCase()
            .includes(normalizedQuery);
}

function renderDeepCleanChoice({ value, checked, title, detail, kind, source }) {
    const encodedValue = encodeURIComponent(value);
    return `
        <label class="blai-deep-clean-choice">
            <input type="checkbox" data-deep-clean-${source}="${kind}" data-deep-clean-value="${encodedValue}" ${checked ? 'checked' : ''}>
            <span class="blai-deep-clean-choice-copy">
                <span class="blai-deep-clean-choice-title">${deepCleanSafeHtml(title)}</span>
                ${detail ? `<span class="blai-deep-clean-choice-meta">${deepCleanSafeHtml(detail)}</span>` : ''}
            </span>
        </label>
    `;
}

export function renderDeepCleanResourcePanel({ kind, title, items, selectionKeys, keyName, searchName, detailFor, showSearch = true }) {
    // 世界书每个角色只有一份，不需要搜索和批量选择；聊天记录有多份，保留搜索。
    const query = showSearch ? deepCleanSearchValue(searchName) : '';
    const visibleItems = showSearch ? items.filter((item) => deepCleanMatchesSearch(item, query)) : items;
    // 保持清单原顺序：勾选只切换 checked，不把已选项挪到前面。
    // 之前勾选后重排会让条目位置跳动，配合整块重渲染还会被拉回顶部，体验像「强制回顶重排」。
    const orderedItems = visibleItems;
    const searchField = showSearch ? `
                <div class="blai-deep-clean-search-field">
                    <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                    <input id="blai-deep-clean-${kind}-search" class="blai-deep-clean-input" type="search" data-deep-clean-search="${searchName}" value="${deepCleanSafeHtml(query)}" placeholder="搜索${title}" aria-label="搜索${title}">
                </div>` : '';
    return `
        <section id="blai-deep-clean-${kind}-panel" class="blai-deep-clean-resource-panel" aria-label="${title}">
            <header class="blai-deep-clean-resource-toolbar">
                <h4 class="blai-deep-clean-resource-title">${deepCleanSafeHtml(title)}</h4>
                <span class="blai-deep-clean-resource-summary">已选择 <strong>${selectionKeys.length}</strong> 项 · 共 ${items.length} 项</span>
            </header>
            ${searchField}
            <div class="blai-deep-clean-resource-list" aria-label="${title}最终选择">
                ${orderedItems.length
        ? orderedItems.map((item) => renderDeepCleanChoice({
            value: item[keyName],
            checked: selectionKeys.includes(item[keyName]),
            title: item.displayLabel,
            detail: detailFor(item),
            kind,
            source: 'resource',
        })).join('')
        : '<p class="blai-deep-clean-empty">没有匹配的资源。</p>'}
            </div>
        </section>
    `;
}
/** 工作区右上角统一叉号：纯图标按钮，文字只留在无障碍名称里。 */
export function deepCleanHeaderCloseAction() {
    return '<button id="blai-deep-clean-close" class="blai-deep-clean-header-icon" type="button" aria-label="关闭" title="关闭"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
}

/** 三个处理阶段共用的「停止处理」按钮。 */
export function renderDeepCleanStopButton() {
    return '<button id="blai-deep-clean-stop" class="blai-deep-clean-secondary-action" type="button">停止处理</button>';
}

export function deepCleanHeaderStopAction() {
    return '<button id="blai-deep-clean-stop" class="blai-deep-clean-header-icon" type="button" aria-label="停止" title="停止"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
}

export function setDeepCleanWorkspaceHeader(title, description, actionHtml = '') {
    $('#blai-deep-clean-title').text(title).prop('hidden', !title);
    $('#blai-deep-clean-description').text(description).prop('hidden', !description);
    $('#blai-deep-clean-header-actions').html(actionHtml);
    // 停止态等无标题页面不留一条 58px 的空白顶栏，避免正文被顶到角落。
    $('#blai-deep-clean-workspace > .blai-deep-clean-header').prop('hidden', !title && !description && !actionHtml);
}

export function openDeepCleanInitialSelection(options = {}) {
    $('#blai-deep-clean-backdrop').addClass('blai-is-open').attr('aria-hidden', 'false');
    $('#blai-deep-clean-workspace').addClass('blai-is-open').attr('aria-hidden', 'false');
    if (options.preserveContent === true) return;
    setDeepCleanWorkspaceHeader('深度清理', '');
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-state blai-deep-clean-loading-state" aria-label="正在读取可选资源">
            <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>正在读取可选资源</h3>
            <p>如果长时间没有响应，可以先关闭后重试。</p>
            <button id="blai-deep-clean-close" type="button">关闭</button>
        </section>
    `);
}

export function closeDeepCleanInitialSelection() {
    $('#blai-deep-clean-backdrop').removeClass('blai-is-open').attr('aria-hidden', 'true');
    $('#blai-deep-clean-workspace').removeClass('blai-is-open').attr('aria-hidden', 'true');
    // 关闭后再次进入必须重新读取资源；旧的冻结快照/预览缓存会让下一屏停在陈旧状态。
    const phase = deepCleanRuntimeState.deepCleanPhase;
    if (phase === 'initial-selection' || phase === 'scan-result' || phase === 'stopped' || phase === 'complete' || phase === null) {
        deepCleanRuntimeState.deepCleanPhase = null;
        deepCleanRuntimeState.deepCleanSelection = null;
    }
}

export function showInitialSelectionError(error) {
    setDeepCleanWorkspaceHeader('深度清理无法完成', '请查看错误信息后结束当前工作区。');
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-state blai-deep-clean-error-state" aria-label="深度清理错误">
            <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
            <p class="blai-deep-clean-error">${deepCleanSafeHtml(error?.message || error)}</p>
            <button id="blai-deep-clean-close" type="button">关闭</button>
        </section>
    `);
}

const deepCleanScanStageLabels = {
    prepare: '准备资源',
    read: '读取内容',
    analyze: '分析规则',
    summarize: '汇总结果',
};

export function deepCleanMeasuredProgress(progress = {}) {
    const current = Number(progress.current);
    const total = Number(progress.total);
    if (!Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total <= 0 || current > total) return null;
    return { current, total, percent: Math.round((current / total) * 100) };
}

function deepCleanFrozenContentItems() {
    return deepCleanRuntimeState.deepCleanSelection?.run?.contentItems || [];
}

export function deepCleanReviewIdentity(item = {}) {
    const locator = item.locator || {};
    const hiddenSuffix = item.isHidden === true ? ' · 已隐藏' : '';
    const messageNumber = Number.isInteger(locator.messageIndex) ? ` · 消息 ${locator.messageIndex + 1}` : '';
    if (item.kind === 'user-message') return `聊天${messageNumber} · 用户${hiddenSuffix}`;
    if (item.kind === 'assistant-swipe') return `聊天${messageNumber}${Number.isInteger(locator.swipeIndex) ? ` · Swipe ${locator.swipeIndex + 1}` : ''}${hiddenSuffix}`;
    if (item.kind === 'embedded-world-book-entry') {
        const ownerName = String(item.ownerDisplayName || locator.characterKey || '').trim();
        const entryName = String(item.displayName || '').trim() || '世界书条目';
        return `内嵌世界书 · ${ownerName} · ${entryName}`;
    }
    if (item.kind === 'external-world-book-entry') {
        const entryName = String(item.displayName || '').trim() || '世界书条目';
        return `世界书 · ${locator.worldBookKey || '世界书'} · ${entryName}`;
    }
    return '内容项';
}

export function deepCleanBatchSummaryBodyHtml({ title, itemIndexes, sourceCharacterCount, status, emptyText, showContents = true }) {
    const contentItems = deepCleanFrozenContentItems();
    const indexes = Array.isArray(itemIndexes) ? itemIndexes : [];
    const identities = showContents ? indexes
        .map((itemIndex) => contentItems[itemIndex])
        .filter(Boolean)
        .map((item) => deepCleanReviewIdentity(item)) : [];
    return `
        <header class="blai-deep-clean-batch-head"><h3>${deepCleanSafeHtml(title)}</h3></header>
        <div class="blai-deep-clean-batch-body">
            ${indexes.length ? `
                <div class="blai-deep-clean-batch-metrics">
                    <span><strong>${Number(sourceCharacterCount || 0).toLocaleString('zh-CN')}</strong> 字符</span>
                    <i aria-hidden="true">·</i>
                    <span><strong>${indexes.length}</strong> 个内容项</span>
                </div>
            ` : ''}
            ${status ? `<p class="blai-deep-clean-batch-status"><span aria-hidden="true"></span>${deepCleanSafeHtml(status)}</p>` : ''}
            ${identities.length ? `
                <div class="blai-deep-clean-batch-contents">
                    <h4>内容</h4>
                    <ul>${identities.map((identity) => `<li>${deepCleanSafeHtml(identity)}</li>`).join('')}</ul>
                </div>
            ` : `<p class="blai-deep-clean-batch-empty">${deepCleanSafeHtml(emptyText || '没有后续审核批次。')}</p>`}
        </div>
    `;
}

export function deepCleanBatchSummaryHtml(options = {}) {
    return `<aside class="blai-deep-clean-batch-summary">${deepCleanBatchSummaryBodyHtml(options)}</aside>`;
}

export function renderDeepCleanScanProgress(progress = {}) {
    const stage = deepCleanScanStageLabels[progress.stage] || '准备资源';
    const measuredProgress = deepCleanMeasuredProgress(progress);
    const detail = measuredProgress
        ? `${measuredProgress.current.toLocaleString('zh-CN')} / ${measuredProgress.total.toLocaleString('zh-CN')} · ${measuredProgress.percent}%`
        : '进行中';
    const stageOrder = ['prepare', 'read', 'analyze', 'summarize'];
    const activeIndex = Math.max(stageOrder.indexOf(progress.stage), 0);
    const stages = stageOrder.map((stageName, index) => ({
        label: deepCleanScanStageLabels[stageName],
        state: index < activeIndex ? 'complete' : (index === activeIndex ? 'active' : 'pending'),
    }));
    const frozenItems = deepCleanRuntimeState.deepCleanSelection?.run?.contentItems || [];
    setDeepCleanWorkspaceHeader('深度清理进行中', '扫描冻结资源；不会写入正式数据。');
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-processing" aria-label="深度清理扫描进度">
            <main class="blai-deep-clean-processing-main">
                <div class="blai-deep-clean-processing-intro">
                    <h3>深度清理进行中</h3>
                    <p>正在读取并分析本次选择的真实内容项。</p>
                </div>
                <ol class="blai-deep-clean-pipeline">
                    ${stages.map((entry, index) => `
                        <li class="is-${entry.state}">
                            <span class="blai-deep-clean-pipeline-marker">${entry.state === 'complete' ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}</span>
                            <div>
                                <strong>${deepCleanSafeHtml(entry.label)}</strong>
                                ${index === activeIndex ? `
                                    <span>${deepCleanSafeHtml(detail)}</span>
                                    ${measuredProgress ? `<progress class="is-determinate" value="${measuredProgress.current}" max="${measuredProgress.total}" aria-label="${deepCleanSafeHtml(stage)}"></progress>` : ''}
                                ` : ''}
                            </div>
                        </li>
                    `).join('')}
                </ol>
                ${renderDeepCleanStopButton()}
            </main>
            ${deepCleanBatchSummaryHtml({
        title: '扫描摘要',
        itemIndexes: frozenItems.map((_, itemIndex) => itemIndex),
        sourceCharacterCount: frozenItems.reduce((total, item) => total + String(item.originalText || '').length, 0),
        emptyText: progress.stage === 'read' ? '正在读取内容项。' : '建立审核批次后显示具体内容。',
        showContents: false,
    })}
        </div>
    `);
}

export function renderDeepCleanScanResult(scanResult = {}) {
    const affectedByType = scanResult.affectedByType || {};
    const metrics = [
        ['已扫描内容项', scanResult.scannedItemCount],
        ['命中内容项', scanResult.affectedItemCount],
        ['程序命中次数', scanResult.programHitCount],
        ['AI 匹配次数', scanResult.aiHitCount],
        ['待处理字符', scanResult.pendingCharacterCount],
    ];
    const categories = [
        ['Message', '聊天记录'],
        ['World Book', '世界书'],
    ];
    const directProgramApply = deepCleanRuntimeState.deepCleanSelection?.run?.input?.processingMode === 'program'
        && deepCleanRuntimeState.deepCleanSelection?.run?.input?.programApplyPolicy === 'direct';
    setDeepCleanWorkspaceHeader(
        '扫描结果',
        directProgramApply ? '确认后按批处理并直接写入。' : '确认后逐批生成审核。',
        deepCleanHeaderCloseAction(),
    );
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-result" aria-label="深度清理扫描结果">
            <header><h3>扫描完成</h3><p>已冻结内容并按当前规则预扫，尚未改写或写入。</p></header>
            <div class="blai-deep-clean-scan-metrics">
                ${metrics.map(([label, value]) => `<div><span>${deepCleanSafeHtml(label)}</span><strong>${Number(value) || 0}</strong></div>`).join('')}
            </div>
            <p class="blai-deep-clean-scan-note">内容项指聊天消息与世界书条目，不是书籍或脚本数量。命中次数按规则计，同一内容项可多次命中；待处理字符只统计命中项的原文长度。</p>
            ${Number(scanResult.deduplicatedEmbeddedCount) > 0 ? `<p class="blai-deep-clean-scan-note blai-deep-clean-scan-dedupe">已跳过 ${Number(scanResult.deduplicatedEmbeddedCount)} 条角色卡内嵌世界书副本：绑定世界书已勾选时，只扫描并改写绑定世界书，不重复匹配内嵌副本；执行后会把绑定世界书的正文覆盖回同名内嵌条目。</p>` : ''}
            <section class="blai-deep-clean-scan-categories" aria-labelledby="blai-deep-clean-scan-categories-title">
                <h3 id="blai-deep-clean-scan-categories-title">命中内容项分布</h3>
                ${categories.map(([key, label]) => `<div><span>${deepCleanSafeHtml(label)}</span><strong>${Number(affectedByType[key]) || 0}</strong></div>`).join('')}
            </section>
            <div class="blai-deep-clean-actions">
                <button id="blai-deep-clean-back-to-selection" class="blai-deep-clean-secondary-action" type="button" aria-label="上一步" title="上一步">上一步</button>
                <button id="blai-deep-clean-preview" class="blai-deep-clean-secondary-action" type="button" aria-label="预览并筛选" title="预览并筛选">预览</button>
                <button id="blai-deep-clean-process-program" class="blai-deep-clean-primary-action" type="button">${directProgramApply ? '直接写入' : '开始清理'}</button>
            </div>
        </section>
    `);
}

export const deepCleanBatchStageLabels = {
    waiting: '等待开始',
    'program-processing': '程序处理',
    'ai-planning': 'AI 规划',
    'ai-processing': '等待 AI 返回',
    'proposed-ready': '准备审核',
    'direct-applying': '直接应用',
    'batch-applied': '批次已应用',
    prepared: '已就绪',
    failed: '下一批处理失败',
};

