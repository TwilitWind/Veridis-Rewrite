#!/usr/bin/env node
/**
 * 深度清理预览回归（纯 Node，不需浏览器）：
 *   1) 扫描按条目记录程序 / AI 命中来源；
 *   2) 预览筛选只列对应来源条目；
 *   3) 取消条目不进入正式处理，并计入「已跳过」；
 *   4) AI 预览缓存参与最终结果时，程序改写仍作用在 AI 写回文本之后；
 *   5) 反证：AI 失败项保持原文，不会再执行程序改写。
 *
 * 用法：node test/audit/verify-deep-clean-preview.mjs
 */
import { scanDeepCleanContentItems } from '../../src/deepClean/scan.js';
import { processDeepCleanProgramCandidates } from '../../src/deepClean/programProcessing.js';
import { resolveFinalProposedText } from '../../src/deepClean/aiProcessing.js';
import { deriveDeepCleanCompletionSummary, applyDeepCleanPreviewSelection } from '../../src/deepClean/lifecycle/lifecycle-00-selection.js';
import {
    createDeepCleanPreviewSession,
    filterDeepCleanPreviewItems,
    setDeepCleanPreviewFilter,
    setDeepCleanPreviewIncluded,
} from '../../src/deepClean/preview.js';

const failures = [];
function check(name, ok, detail = '') {
    if (ok) console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
    else { console.log(`FAIL  ${name}${detail ? `  ${detail}` : ''}`); failures.push(name); }
}

const preset = {
    rules: [
        {
            name: '程序规则',
            enabled: true,
            subRules: [{ enabled: true, mode: 'text', rewriteMode: 'program', targets: ['抠挖'], replacements: ['拨弄'] }],
        },
        {
            name: 'AI 规则',
            enabled: true,
            subRules: [{ enabled: true, mode: 'text', rewriteMode: 'ai', targets: ['宛若'], replacements: ['像'] }],
        },
    ],
    aiRewrite: {
        promptTemplate: '{{annotatedSource}}',
        maxItemsPerRequest: 10,
        maxContextChars: 10000,
        timeoutMs: 5000,
        maxRetries: 0,
    },
};

const input = {
    preset,
    processingMode: 'program-ai',
    characterKeys: ['demo'],
    chats: [{ characterKey: 'demo', chatId: 'chat-1' }],
    processingSemantics: { scopeTags: [], scopeTagBuiltinDismissed: [], scopeTagMode: 'protect' },
};
const items = [
    { kind: 'user-message', originalText: '她抠挖着地面。', programEligible: true, aiEligible: true },
    { kind: 'user-message', originalText: '她宛若神明。', programEligible: true, aiEligible: true },
    { kind: 'user-message', originalText: '她抠挖着，宛若神明。', programEligible: true, aiEligible: true },
    { kind: 'user-message', originalText: '她看着地面。', programEligible: true, aiEligible: true },
];

const scanResult = await scanDeepCleanContentItems(input, items);
check('扫描按条目记录命中来源',
    JSON.stringify(scanResult.affectedItemModes) === JSON.stringify({ 0: ['program'], 1: ['ai'], 2: ['program', 'ai'] }),
    `modes=${JSON.stringify(scanResult.affectedItemModes)}`);

const run = { input, contentItems: items, scanResult };
const lifecycle = {
    run,
    affectedItemIndexes: [...scanResult.affectedItemIndexes],
    skippedItemIndexes: new Set(),
    previewAiCache: null,
    processedRuns: [],
    applyResults: [],
};
const preview = createDeepCleanPreviewSession(lifecycle);
check('默认预览列出全部命中条目', filterDeepCleanPreviewItems(preview).length === 3);
setDeepCleanPreviewFilter(preview, 'program');
check('程序筛选排除纯 AI 条目',
    JSON.stringify(filterDeepCleanPreviewItems(preview)) === JSON.stringify([0, 2]),
    `items=${JSON.stringify(filterDeepCleanPreviewItems(preview))}`);
setDeepCleanPreviewFilter(preview, 'ai');
check('AI 筛选排除纯程序条目',
    JSON.stringify(filterDeepCleanPreviewItems(preview)) === JSON.stringify([1, 2]),
    `items=${JSON.stringify(filterDeepCleanPreviewItems(preview))}`);

setDeepCleanPreviewIncluded(preview, 1, false);
applyDeepCleanPreviewSelection(lifecycle, preview.skipped, preview.aiCache);
check('取消条目不进入正式处理',
    JSON.stringify(lifecycle.affectedItemIndexes) === JSON.stringify([0, 2]),
    `affected=${JSON.stringify(lifecycle.affectedItemIndexes)}`);
const summary = deriveDeepCleanCompletionSummary(lifecycle);
check('完成页统计已跳过条目',
    summary.skippedItemCount === 1 && summary.selectedItemCount === 2 && summary.retainedOriginalItemCount === 2,
    `summary=${JSON.stringify(summary)}`);

const itemIndex = 2;
const programResults = processDeepCleanProgramCandidates(input, items, scanResult, [itemIndex]);
const aiCandidate = '她拨弄着，像神明。';
const withCachedAi = {
    input,
    contentItems: items,
    scanResult,
    programProposedResults: programResults,
    aiProposedResults: [{ itemIndex, aiCandidate: '她抠挖着，像神明。' }],
    aiFailedItemIndexes: [],
};
check('AI 预览结果参与后仍继续执行程序改写',
    resolveFinalProposedText(withCachedAi, itemIndex) === aiCandidate,
    `final=${resolveFinalProposedText(withCachedAi, itemIndex)}`);

const aiFailed = { ...withCachedAi, aiProposedResults: [], aiFailedItemIndexes: [itemIndex] };
check('反证：AI 失败项保持原文，不执行程序改写',
    resolveFinalProposedText(aiFailed, itemIndex) === items[itemIndex].originalText,
    `final=${resolveFinalProposedText(aiFailed, itemIndex)}`);

const failed = failures.length;
console.log(`\n结果：${failed === 0 ? '全部通过' : `${failed} 项未通过`}`);
if (failed) process.exit(1);
