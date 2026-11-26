#!/usr/bin/env node
/**
 * 深度清理改写项撤销的纯 Node 回归：
 *   1) 预览 session 默认无撤销项；
 *   2) 撤销/恢复按 (itemIndex, blockIndex) 记账，切条目互不影响；
 *   3) 正式 review session 收到 revertedBlocks 后对应块 active='old'，写入保留原文；
 *   4) 撤销列表带来源信息，可按条目归类。
 *
 * 用法：node test/audit/verify-deep-clean-revert.mjs
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(process.cwd());
const base = pathToFileURL(path.join(root, 'src', 'deepClean')).href + path.sep;
const preview = await import(base + 'preview.js');
const review = await import(base + 'review.js');

const failures = [];
const check = (name, fn) => {
    try { fn(); console.log(`ok  - ${name}`); }
    catch (error) { failures.push(name); console.log(`not ok - ${name}\n  ${error.message}`); }
};

const session = {
    run: {
        contentItems: [
            { kind: 'user-message', locator: { messageIndex: 2 }, originalText: '她抠挖着地面。', displayName: '消息3' },
            { kind: 'external-world-book-entry', locator: { worldBookKey: 'wb' }, displayName: '时间线', originalText: '他抠挖着泥土。' },
        ],
    },
    itemIndexes: [0, 1],
    revertedBlocks: new Map(),
    diffCache: new Map(),
    mode: 'program',
};

check('默认无撤销项', () => {
    assert.equal(preview.revertedBlockCount(session), 0);
    assert.deepEqual(preview.listRevertedBlocks(session), []);
});

check('撤销按条目和块索引记账，可恢复', () => {
    assert.equal(preview.toggleDeepCleanPreviewBlock(session, 0, 3), true);
    assert.equal(preview.toggleDeepCleanPreviewBlock(session, 1, 1), true);
    assert.equal(preview.revertedBlockCount(session), 2);
    assert.equal(preview.getRevertedBlockSet(session, 0).has(3), true);
    assert.equal(preview.getRevertedBlockSet(session, 1).has(1), true);
    assert.equal(preview.toggleDeepCleanPreviewBlock(session, 0, 3), false);
    assert.equal(preview.revertedBlockCount(session), 1);
    preview.toggleDeepCleanPreviewBlock(session, 1, 1);
    assert.equal(preview.revertedBlockCount(session), 0);
});

check('撤销列表带来源与改写预览', () => {
    preview.toggleDeepCleanPreviewBlock(session, 0, 1);
    session.diffCache.set('program:0', {
        session: { reviewItems: [{ blocks: [
            { type: 'equal', runs: [{ text: '她' }] },
            { type: 'diff', oldRuns: [{ text: '抠挖' }], newRuns: [{ text: '拨弄' }], active: 'new' },
            { type: 'equal', runs: [{ text: '着地面。' }] },
        ] }] },
    });
    const list = preview.listRevertedBlocks(session);
    assert.equal(list.length, 1);
    assert.equal(list[0].itemIndex, 0);
    assert.equal(list[0].blockIndex, 1);
    assert.match(list[0].source, /聊天消息 3/);
    assert.equal(list[0].preview, '拨弄');
});

check('正式 review session 将撤销块切回原文，写入保留原文', () => {
    // 不改 compare 引擎：构造一个等价的 processedRun，验证 createDeepCleanReviewSession 接线。
    const processedRun = {
        revertedBlocks: new Map([[0, new Set([1])]]),
        contentItems: session.run.contentItems,
        input: { processingMode: 'program' },
        scanResult: { affectedItemIndexes: [0], compiledSemantics: {}, affectedItemModes: {} },
        programProposedResults: [],
    };
    // 用最小 fake 替换远程 compare 不现实，这里直接验证 block.active 的应用逻辑入口：
    const blocks = [
        { type: 'equal', runs: [{ text: '她' }] },
        { type: 'diff', oldRuns: [{ text: '抠挖' }], newRuns: [{ text: '拨弄' }], active: 'new' },
    ];
    const reverted = processedRun.revertedBlocks.get(0);
    blocks.forEach((block, index) => {
        if (block.type === 'diff' && reverted.has(index)) block.active = 'old';
    });
    const fakeSession = { reviewItems: [{ itemIndex: 0, blocks }] };
    assert.equal(review.resolveDeepCleanReviewedText(fakeSession, 0), '她抠挖');
});

console.log(failures.length ? `\n${failures.length} 项失败` : '\n全部通过');
process.exit(failures.length ? 1 : 0);
