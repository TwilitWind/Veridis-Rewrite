#!/usr/bin/env node
/**
 * 深度净化世界书回归（纯 Node，不需浏览器）：
 *   1) cleanse-inside 模式下，内嵌/外部世界书条目仍能被扫描命中并改写；
 *   2) program 与 program-ai 两条改写链路结果一致（AI 未回包时最终文本仍走程序改写）；
 *   3) 聊天消息在 cleanse-inside 下依然只处理标签内文本，不被误放开；
 *   4) 反证：若把世界书条目当普通消息处理，旧行为会 0 命中、报假成功。
 *
 * 背景：用户勾选世界书条目后“清理完成”但条目没变。根因是 cleanse-inside 作用域
 * 把没有 <content>/<game> 标签的世界书条目整条跳过，扫描 0 命中却照常报成功。
 *
 * 用法：node test/audit/verify-deep-clean-worldbook.mjs
 * 失败退出码 1。
 */
import { scanDeepCleanContentItems } from '../../src/deepClean/scan.js';
import { processDeepCleanProgramCandidates } from '../../src/deepClean/programProcessing.js';
import { resolveFinalProposedText } from '../../src/deepClean/aiProcessing.js';
import { countScopedProcessorMatches } from '../../src/rules/engine.js';

const failures = [];
function check(name, ok, detail = '') {
    if (ok) console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
    else { console.log(`FAIL  ${name}${detail ? `  ${detail}` : ''}`); failures.push(name); }
}

const preset = {
    rules: [{
        name: '测试规则',
        enabled: true,
        subRules: [{
            enabled: true,
            mode: 'text',
            rewriteMode: 'program',
            targets: ['抠挖'],
            replacements: ['拨弄'],
        }],
    }],
    aiRewrite: {
        promptTemplate: '{{annotatedSource}}',
        maxItemsPerRequest: 10,
        maxContextChars: 10000,
        timeoutMs: 5000,
        maxRetries: 0,
    },
};

const scopeTags = [{ startTag: '<content>', endTag: '</content>', enabled: true }];
const makeInput = (processingMode) => ({
    preset,
    processingMode,
    processingSemantics: { scopeTags, scopeTagBuiltinDismissed: [], scopeTagMode: 'cleanse-inside' },
});

function makeItems() {
    return [
        {
            kind: 'embedded-world-book-entry',
            originalText: '她抠挖着地面。',
            programEligible: true,
            aiEligible: true,
            locator: { characterKey: 'demo', entryId: 1 },
        },
        {
            kind: 'external-world-book-entry',
            originalText: '他抠挖着泥土。',
            programEligible: true,
            aiEligible: true,
            locator: { worldBookKey: 'demo', entryKey: '0' },
        },
        {
            kind: 'user-message',
            originalText: '她抠挖着地面。',
            programEligible: true,
            aiEligible: true,
            locator: {},
        },
        {
            kind: 'user-message',
            originalText: '<content>她抠挖着地面。</content>',
            programEligible: true,
            aiEligible: true,
            locator: {},
        },
    ];
}

async function runMode(processingMode) {
    const input = makeInput(processingMode);
    const items = makeItems();
    const scanResult = await scanDeepCleanContentItems(input, items);
    const proposed = processDeepCleanProgramCandidates(input, items, scanResult, [0, 1, 2, 3]);
    const run = {
        input,
        contentItems: items,
        scanResult,
        programProposedResults: proposed,
        aiProposedResults: [],
        aiFailedItemIndexes: [],
    };
    return {
        scanResult,
        final: [0, 1, 2, 3].map((itemIndex) => resolveFinalProposedText(run, itemIndex)),
    };
}

const program = await runMode('program');
check('程序模式：世界书两条都命中',
    program.scanResult.affectedItemIndexes.includes(0) && program.scanResult.affectedItemIndexes.includes(1),
    `affected=${JSON.stringify(program.scanResult.affectedItemIndexes)}`);
check('程序模式：世界书内容被真正改写',
    program.final[0] === '她拨弄着地面。' && program.final[1] === '他拨弄着泥土。',
    `final=${JSON.stringify(program.final.slice(0, 2))}`);
check('程序模式：无标签聊天消息仍受 cleanse-inside 约束',
    program.final[2] === '她抠挖着地面。',
    `final=${program.final[2]}`);
check('程序模式：标签内聊天消息正常改写',
    program.final[3] === '<content>她拨弄着地面。</content>',
    `final=${program.final[3]}`);

const programAi = await runMode('program-ai');
check('AI 模式：世界书两条都命中',
    programAi.scanResult.affectedItemIndexes.includes(0) && programAi.scanResult.affectedItemIndexes.includes(1),
    `affected=${JSON.stringify(programAi.scanResult.affectedItemIndexes)}`);
check('AI 模式：AI 未回包时仍按程序改写写回世界书',
    programAi.final[0] === '她拨弄着地面。' && programAi.final[1] === '他拨弄着泥土。',
    `final=${JSON.stringify(programAi.final.slice(0, 2))}`);
check('两种模式改写结果一致',
    JSON.stringify(program.final) === JSON.stringify(programAi.final),
    `program=${JSON.stringify(program.final)} ai=${JSON.stringify(programAi.final)}`);

// 反证：不应用修复的世界书豁免时，cleanse-inside 下没有标签的文本必然 0 命中。
const oldCount = countScopedProcessorMatches(
    '她抠挖着地面。',
    [{ regex: /抠挖/g, replacerMap: { 抠挖: ['拨弄'] }, kind: 'text' }],
    makeInput('program').processingSemantics,
);
check('反证：旧行为会把世界书条目当成无标签文本跳过', oldCount === 0, `oldCount=${oldCount}`);

const failed = failures.length;
console.log(`\n结果：${failed === 0 ? '全部通过' : `${failed} 项未通过`}`);
if (failed) process.exit(1);
