#!/usr/bin/env node
/**
 * 深清「进入预览 → 返回 → 上一步/预览」回归。
 * 覆盖历史 bug：freezeDeepCleanRun 产出裸 lifecycle 丢掉 inventory，
 * 返回选择页时 renderDeepCleanInitialSelection 抛错，页面停在扫描结果且状态已切走，
 * 导致上一步与预览都点不动。
 *
 * 用法：CDP_PORT=9333 node test/audit/verify-deep-clean-back.mjs
 */
import { connect, evaluate, waitFor, reloadAndWait, check as harnessCheck } from './_harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = `(() => !!document.getElementById('blai-purifier-popup') && typeof jQuery !== 'undefined')()`;

// 用真实生命周期产出 lifecycle，再注入一个最小扫描结果，避免用假对象绕过被测代码路径。
const SETUP = `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
    const life = await import(base + 'src/deepClean/lifecycle/lifecycle-00-selection.js');
    const { scanDeepCleanContentItems } = await import(base + 'src/deepClean/scan.js');
    const { deepCleanRuntimeState } = await import(base + 'src/deepClean/state.js');
    const { renderDeepCleanScanResult } = await import(base + 'src/deepClean/view/view-00-selection.js');

    await life.startDeepCleanRun();
    let freezeError = null;
    try { await life.freezeDeepCleanRun(); } catch (e) { freezeError = String(e?.message || e); }
    const lc = deepCleanRuntimeState.deepCleanSelection;

    const preset = { rules: [{ name: '回归规则', enabled: true, subRules: [{ enabled: true, mode: 'text', rewriteMode: 'program', targets: ['抠挖'], replacements: ['拨弄'] }] }] };
    const input = { preset, processingMode: 'program', characterKeys: ['demo'], chats: [{ characterKey: 'demo', chatId: 'chat-1' }], processingSemantics: { scopeTags: [], scopeTagBuiltinDismissed: [], scopeTagMode: 'protect' } };
    const items = [{ kind: 'user-message', originalText: '她抠挖着地面。', programEligible: true }];
    const scanResult = await scanDeepCleanContentItems(input, items);
    lc.run = { input, contentItems: items, scanResult };
    lc.affectedItemIndexes = [...scanResult.affectedItemIndexes];
    lc.skippedItemIndexes = new Set();
    deepCleanRuntimeState.deepCleanPhase = 'scan-result';
    window.__dcState = deepCleanRuntimeState;
    renderDeepCleanScanResult(scanResult);
    return { freezeError, hasInventory: !!lc.inventory, affected: scanResult.affectedItemIndexes.length };
})()`;

const SNAP = `(() => ({
    title: document.getElementById('blai-deep-clean-title')?.textContent || '',
    hasPreviewUi: !!document.querySelector('.blai-deep-clean-preview'),
    hasScanResult: !!document.querySelector('.blai-deep-clean-result'),
    hasSelection: !!document.querySelector('.blai-deep-clean-selection'),
    phase: window.__dcState?.deepCleanPhase,
    hasRun: !!window.__dcState?.deepCleanSelection?.run,
    errors: (window.__stProbeErrors || []).slice(-3),
}))()`;

async function main() {
    const { ws, send } = await connect();
    try {
        await reloadAndWait(send, READY, '页面就绪');
        await evaluate(send, `(() => { document.getElementById('blai-wand-btn')?.click(); return true; })()`);
        await sleep(350);
        await evaluate(send, `(async () => {
            const m = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/deepClean/view/view-00-selection.js');
            m.openDeepCleanInitialSelection();
            return true;
        })()`);
        await waitFor(send, `document.getElementById('blai-deep-clean-workspace')?.classList.contains('blai-is-open')`, '工作区打开', 30, 200);

        const setup = await evaluate(send, SETUP);
        check('冻结运行保留初始选择清单', setup.hasInventory, JSON.stringify(setup));
        check('回归扫描命中一条', setup.affected === 1, `affected=${setup.affected}`);
        await sleep(150);

        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview [data-deep-clean-preview-back]')`, '预览打开', 30, 200);
        const inPreview = await evaluate(send, SNAP);
        check('扫描结果可进入预览', inPreview.hasPreviewUi && !inPreview.hasScanResult, JSON.stringify(inPreview));

        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-back]')?.click(); return true; })()`);
        await waitFor(send, `!!document.getElementById('blai-deep-clean-preview')`, '返回扫描结果', 30, 200);
        const afterBack = await evaluate(send, SNAP);
        check('预览返回后回到扫描结果', afterBack.hasScanResult && afterBack.phase === 'scan-result' && afterBack.hasRun, JSON.stringify(afterBack));

        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview [data-deep-clean-preview-back]')`, '再次进入预览', 30, 200);
        check('返回后「预览」仍可用', await evaluate(send, `!!document.querySelector('.blai-deep-clean-preview')`));

        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-back]')?.click(); return true; })()`);
        await sleep(150);
        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-back-to-selection')?.click(); return true; })()`);
        await sleep(250);
        const afterPrev = await evaluate(send, SNAP);
        check('预览返回后「上一步」渲染选择页', afterPrev.hasSelection && !afterPrev.hasScanResult && afterPrev.phase === 'initial-selection', JSON.stringify(afterPrev));
        check('返回路径没有脚本报错', afterPrev.errors.length === 0, JSON.stringify(afterPrev.errors));
    } finally {
        ws.close();
    }
    if (failures.length) {
        console.error(`\n验证失败：${failures.length} 项未通过`);
        process.exit(1);
    }
    console.log('\n验证通过。');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
