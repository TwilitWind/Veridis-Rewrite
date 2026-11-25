/** view 的分块：progress。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { deepCleanRuntimeState } from '../state.js';
import { renderFullTextDiffBlocks } from '../../diff/compare.js';
import { resolveReviewRunsText, resolveDeepCleanReviewedText } from '../review.js';
import { resolveFinalProposedText } from '../aiProcessing.js';
import { deepCleanBatchStageLabels, deepCleanBatchSummaryBodyHtml, deepCleanSafeHtml, setDeepCleanWorkspaceHeader, deepCleanMeasuredProgress, deepCleanBatchSummaryHtml } from './view-00-selection.js';

function deepCleanBatchProgressText(progress = {}) {
    return `${Number(progress.sourceCharacterCount || 0).toLocaleString('zh-CN')} 字符 · ${Number(progress.itemCount) || 0} 个内容项`;
}

export function deepCleanLookaheadHtml(progress = null) {
    if (!progress) return deepCleanBatchSummaryBodyHtml({ title: '下一批', emptyText: '没有后续审核批次。' });
    const stage = deepCleanBatchStageLabels[progress.stage] || progress.stage || '处理中';
    return deepCleanBatchSummaryBodyHtml({
        title: '下一批',
        itemIndexes: progress.itemIndexes,
        sourceCharacterCount: progress.sourceCharacterCount,
        status: progress.error || stage,
        emptyText: progress.stage === 'waiting' ? '正在确定下一批内容。' : '当前没有可显示的批次内容。',
    });
}

export function renderDeepCleanBatchProgress(progress = {}) {
    const input = deepCleanRuntimeState.deepCleanSelection?.run?.input;
    const includeAi = input?.processingMode === 'program-ai';
    const directProgramApply = input?.processingMode === 'program' && input?.programApplyPolicy === 'direct';
    const stage = directProgramApply && progress.stage === 'proposed-ready'
        ? '准备直接应用'
        : (deepCleanBatchStageLabels[progress.stage] || progress.stage || '处理中');
    const measuredProgress = deepCleanMeasuredProgress(progress);
    const completedBatchText = directProgramApply
        ? ` · 已完成 ${Number(progress.completedBatchCount) || 0} 批`
        : '';
    const pipeline = directProgramApply
        ? [
            { id: 'program-processing', label: '程序处理' },
            { id: 'proposed-ready', label: '准备直接应用' },
            { id: 'direct-applying', label: '直接应用' },
            { id: 'batch-applied', label: '批次已应用' },
        ]
        : [
            { id: 'program-processing', label: '程序处理' },
            ...(includeAi ? [
            { id: 'ai-planning', label: 'AI 规划' },
            { id: 'ai-processing', label: '等待 AI 返回' },
            ] : []),
            { id: 'proposed-ready', label: '准备审核' },
        ];
    const activeIndex = Math.max(pipeline.findIndex((entry) => entry.id === progress.stage), 0);
    setDeepCleanWorkspaceHeader(
        '深度清理进行中',
        directProgramApply
            ? '按冻结后受影响内容项的原始顺序处理并直接应用当前批次。'
            : '按冻结后受影响内容项的原始顺序处理当前审核批次。',
    );
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-processing" aria-label="${directProgramApply ? '深度清理直接应用批次处理进度' : '深度清理审核批次处理进度'}">
            <main class="blai-deep-clean-processing-main">
                <div class="blai-deep-clean-processing-intro">
                    <h3>${directProgramApply ? '正在处理并直接应用' : '深度清理进行中'}</h3>
                    <p>${deepCleanSafeHtml(deepCleanBatchProgressText(progress) + completedBatchText)}</p>
                </div>
                <ol class="blai-deep-clean-pipeline">
                    ${pipeline.map((entry, index) => {
        const state = index < activeIndex ? 'complete' : (index === activeIndex ? 'active' : 'pending');
        return `
                            <li class="is-${state}">
                                <span class="blai-deep-clean-pipeline-marker">${state === 'complete' ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}</span>
                                <div>
                                    <strong>${deepCleanSafeHtml(entry.label)}</strong>
                                    ${state === 'active' ? `
                                        <span>${entry.id === 'ai-processing' ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i>' : ''}${deepCleanSafeHtml(measuredProgress ? `${stage} · ${measuredProgress.current.toLocaleString('zh-CN')} / ${measuredProgress.total.toLocaleString('zh-CN')} · ${measuredProgress.percent}%` : stage)}</span>
                                        ${measuredProgress ? `<progress class="is-determinate" value="${measuredProgress.current}" max="${measuredProgress.total}" aria-label="${deepCleanSafeHtml(stage)}"></progress>` : ''}
                                    ` : ''}
                                </div>
                            </li>
                        `;
    }).join('')}
                </ol>
                <button id="blai-deep-clean-stop" class="blai-deep-clean-secondary-action" type="button">停止处理</button>
            </main>
            ${deepCleanBatchSummaryHtml({
        title: '批次摘要',
        itemIndexes: progress.itemIndexes,
        sourceCharacterCount: progress.sourceCharacterCount,
        status: stage,
        emptyText: '批次内容尚未报告。',
    })}
        </div>
    `);
}

export function renderDeepCleanLookaheadProgress(progress = null) {
    const target = $('#blai-deep-clean-lookahead');
    if (target.length) target.html(deepCleanLookaheadHtml(progress));
}

export function renderDeepCleanStopped() {
    setDeepCleanWorkspaceHeader('', '');
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-state blai-deep-clean-stopped-state" aria-label="深度清理已停止">
            <i class="fas fa-stop-circle" aria-hidden="true"></i>
            <h3>深度清理 · 已停止</h3>
            <p>未正式应用的当前审核批次与预处理结果已丢弃；之前成功应用的结果保持不变。</p>
            <button id="blai-deep-clean-close" type="button">关闭</button>
        </section>
    `);
}

export function renderDeepCleanComplete(summary = {}) {
    const renderMetrics = (metrics, className = '') => `
        <dl class="blai-deep-clean-completion-metrics ${className}">
            ${metrics.map(([label, value]) => `
                <div>
                    <dt>${deepCleanSafeHtml(label)}</dt>
                    <dd>${Number(value || 0).toLocaleString('zh-CN')}</dd>
                </div>
            `).join('')}
        </dl>
    `;
    const affected = Number(summary.affectedItemCount) || 0;
    const applied = Number(summary.appliedItemCount) || 0;
    const failed = Number(summary.failedItemCount) || 0;
    const skipped = Number(summary.skippedItemCount) || 0;
    const aiFailed = Number(summary.aiFailedOriginalItemCount) || 0;
    const hasAiSummary = Object.hasOwn(summary, 'totalAiRequestCount');
    const noHits = affected === 0;
    const hasFailures = failed > 0 || aiFailed > 0 || (Number(summary.failedAiRequestCount) || 0) > 0;
    let title = '清理完成';
    let description = skipped > 0
        ? `本次清理已写入 ${applied} 个内容项，${skipped} 个已跳过。`
        : `本次清理已写入 ${applied} 个内容项。`;
    let icon = 'fa-check';
    if (noHits) {
        title = '没有找到需要清理的内容';
        description = '本次扫描命中 0 个内容项，未写入任何更改。';
        icon = 'fa-circle-info';
    } else if (hasFailures) {
        title = '清理已结束，部分内容未写入';
        description = `${applied} 个内容项已写入，${failed} 个未写入；失败项保持原文。`;
        icon = 'fa-triangle-exclamation';
    }
    setDeepCleanWorkspaceHeader('', '');
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-state blai-deep-clean-complete-state" aria-label="${deepCleanSafeHtml(title)}">
            <i class="fas ${icon}" aria-hidden="true"></i>
            <h3>${deepCleanSafeHtml(title)}</h3>
            <p>${deepCleanSafeHtml(description)}</p>
            <div class="blai-deep-clean-completion-summary">
                <section aria-labelledby="blai-deep-clean-completion-scope">
                    <h4 id="blai-deep-clean-completion-scope">处理范围</h4>
                    ${renderMetrics([
        ['角色卡', summary.characterResourceCount],
        ['聊天记录', summary.chatBranchResourceCount],
        ['扫描内容项', summary.scannedItemCount],
        ['命中内容项', summary.affectedItemCount],
    ])}
                </section>
                <section aria-labelledby="blai-deep-clean-completion-outcome">
                    <h4 id="blai-deep-clean-completion-outcome">处理结果</h4>
                    ${renderMetrics([
        ['已写入', summary.appliedItemCount],
        ['保持原文', summary.retainedOriginalItemCount],
        ['写入失败', summary.failedItemCount],
        ['已跳过', summary.skippedItemCount],
    ])}
                </section>
                ${hasAiSummary ? `
                    <section aria-labelledby="blai-deep-clean-completion-ai">
                        <h4 id="blai-deep-clean-completion-ai">AI 调用</h4>
                        ${renderMetrics([
        ['AI 请求数', summary.totalAiRequestCount],
        ['成功请求', summary.successfulAiRequestCount],
        ['失败请求', summary.failedAiRequestCount],
        ['AI 失败项（保持原文）', summary.aiFailedOriginalItemCount],
        ['内容过长，未调用 AI', summary.oversizedAiItemCount],
    ], 'is-ai')}
                        ${aiFailed > 0 ? '<p class="blai-deep-clean-ai-failure-reasons">AI 改写失败的内容保持原文，未执行程序改写。</p>' : ''}
                        ${(summary.aiFailureReasons || []).length > 0 ? `
                            <p class="blai-deep-clean-ai-failure-reasons">未执行原因：${summary.aiFailureReasons.map((reason) => deepCleanSafeHtml(reason)).join('；')}</p>
                        ` : ''}
                    </section>
                ` : ''}
            </div>
            <button id="blai-deep-clean-close" type="button">关闭</button>
        </section>
    `);
}

export function deepCleanProtectionLabel(item = {}) {
    return item.protectionReason === 'mvu'
        ? '疑似 MVU'
        : (item.protectionReason === 'ejs' ? '疑似 EJS' : '');
}

export function renderDeepCleanReviewDocument(entry) {
    const renderRuns = (runs) => (runs || []).map((run) => {
        const text = deepCleanSafeHtml(run.text);
        return run.source === 'manual' ? `<span class="blai-deep-clean-review-manual">${text}</span>` : text;
    }).join('');
    const operations = entry.blocks.flatMap((block, blockIndex) => {
        if (block.type === 'equal') {
            const text = resolveReviewRunsText(block.runs);
            return text === '' ? [] : [{ type: 'equal', text, runs: block.runs, blockIndex, atomic: true }];
        }
        const oldText = resolveReviewRunsText(block.oldRuns);
        const newText = resolveReviewRunsText(block.newRuns);
        return [
            { type: 'delete', text: oldText, runs: block.oldRuns, blockIndex, branch: 'old', active: block.active, isEmpty: oldText === '', isPureDeletion: newText === '', atomic: true, forceRender: oldText === '' },
            { type: 'insert', text: newText, runs: block.newRuns, blockIndex, branch: 'new', active: block.active, isEmpty: newText === '', atomic: true, forceRender: newText === '' },
        ];
    });
    const renderBranch = (operation) => {
        if (operation.type === 'equal') {
            return `<span
                class="blai-deep-clean-review-equal"
                data-deep-clean-review-equal-block-index="${operation.blockIndex}"
                tabindex="0"
                role="textbox"
                contenteditable="plaintext-only"
                aria-multiline="true"
                spellcheck="true"
                aria-label="未变化文本，可直接编辑"
            >${renderRuns(operation.runs)}</span>`;
        }
        const selected = operation.active === operation.branch;
        if (operation.isEmpty) {
            const label = operation.branch === 'old' ? '空原文' : '空净化后文本';
            return `<button
                class="blai-deep-clean-review-empty-branch is-${operation.branch} ${selected ? 'is-active' : 'is-inactive'}"
                type="button"
                data-deep-clean-review-empty-branch
                data-deep-clean-review-block-branch="${operation.branch}"
                data-deep-clean-review-block-index="${operation.blockIndex}"
                aria-pressed="${selected}"
                aria-label="${label}${selected ? '，已选择' : '，点击选择'}"
            >${label}</button>`;
        }
        const isManualOverride = selected && operation.branch === 'old';
        const isRestoredDeletion = isManualOverride && operation.isPureDeletion;
        const tag = operation.branch === 'old'
            ? (selected ? 'span' : 'del')
            : 'ins';
        const label = operation.branch === 'old' ? '原文片段' : '净化后片段';
        return `<${tag}
            class="blai-deep-clean-review-fragment is-${operation.branch} ${selected ? 'is-active' : 'is-inactive'} ${isManualOverride ? 'is-manual-override' : ''} ${isRestoredDeletion ? 'is-restored-deletion' : ''}"
            data-deep-clean-review-block-branch="${operation.branch}"
            data-deep-clean-review-block-index="${operation.blockIndex}"
            tabindex="0"
            role="${selected ? 'textbox' : 'button'}"
            ${selected ? 'contenteditable="plaintext-only" aria-multiline="true" spellcheck="true"' : ''}
            aria-label="${label}${selected ? '，已选择，可直接编辑' : '，点击选择'}"
        >${renderRuns(operation.runs)}</${tag}>`;
    };
    return `<div class="blai-diff-full-text">${renderFullTextDiffBlocks(operations, renderBranch, {
        modified: 'blai-diff-full-modified blai-deep-clean-review-modified',
    })}</div>`;
}

export function renderDeepCleanReviewViewSwitcher(viewMode) {
    return `<nav class="blai-deep-clean-review-views" aria-label="审核视图">
        ${[
            ['review', 'Review'],
            ['original', '原版'],
            ['cleaned', '净化后'],
            ['final', '最终'],
        ].map(([value, label]) => `<button
            type="button"
            data-deep-clean-review-view="${value}"
            aria-pressed="${viewMode === value}"
        >${label}</button>`).join('')}
    </nav>`;
}

export function renderDeepCleanReviewView(session, itemIndex, item, entry) {
    const viewMode = ['review', 'original', 'cleaned', 'final'].includes(session.viewMode)
        ? session.viewMode
        : 'review';
    if (viewMode === 'review') {
        return `<div aria-label="全文差异审核">${renderDeepCleanReviewDocument(entry)}</div>`;
    }
    const projections = {
        original: { label: '冻结原版', text: item.originalText },
        cleaned: { label: '初始净化后结果', text: resolveFinalProposedText(session.processedRun, itemIndex) },
        final: { label: '当前最终结果', text: resolveDeepCleanReviewedText(session, itemIndex) },
    };
    const projection = projections[viewMode];
    return `<div class="blai-deep-clean-review-projection" role="document" aria-label="${projection.label}">${deepCleanSafeHtml(projection.text)}</div>`;
}

