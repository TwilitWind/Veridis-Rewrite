#!/usr/bin/env node
/**
 * 文案与深度清理预览的 9224 端口浏览器回归：
 *   1) 规则分组 / 规则弹窗不再出现「合集 / 子规则 / 映射规则」；
 *   2) 扫描结果可进入预览，程序预览逐条渲染；
 *   3) 筛选、步骤导航、取消条目与「执行所选」计数可用；
 *   4) 完成页按命中 0 / 有失败分状态，不再显示假成功文案。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-copy-preview.mjs
 */
import { connect, evaluate, waitFor, ensurePageFresh, capture, check as harnessCheck, reloadAndWait } from './_harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = `(() => !!document.getElementById('blai-purifier-popup') && typeof jQuery !== 'undefined')()`;

const SEED_PREVIEW = `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
    const { scanDeepCleanContentItems } = await import(base + 'src/deepClean/scan.js');
    const { deepCleanRuntimeState } = await import(base + 'src/deepClean/state.js');
    const { renderDeepCleanScanResult } = await import(base + 'src/deepClean/view/view-00-selection.js');
    const preset = {
        rules: [{
            name: '预览规则', enabled: true,
            subRules: [{ enabled: true, mode: 'text', rewriteMode: 'program', targets: ['抠挖'], replacements: ['拨弄'] }],
        }],
        aiRewrite: { promptTemplate: '{{annotatedSource}}', maxItemsPerRequest: 10, maxContextChars: 10000 },
    };
    const input = {
        preset, processingMode: 'program', characterKeys: ['demo'],
        chats: [{ characterKey: 'demo', chatId: 'chat-1' }],
        processingSemantics: { scopeTags: [], scopeTagBuiltinDismissed: [], scopeTagMode: 'protect' },
    };
    const items = [
        { kind: 'user-message', originalText: '她抠挖着地面。', programEligible: true, aiEligible: true },
        { kind: 'user-message', originalText: '他抠挖着泥土。', programEligible: true, aiEligible: true },
        { kind: 'user-message', originalText: '她看着地面。', programEligible: true, aiEligible: true },
    ];
    const scanResult = await scanDeepCleanContentItems(input, items);
    const lifecycle = {
        run: { input, contentItems: items, scanResult },
        affectedItemIndexes: [...scanResult.affectedItemIndexes],
        skippedItemIndexes: new Set(), previewAiCache: null, previewSession: null,
        currentReviewSession: null, lookahead: null, stopRequested: false,
        applyResults: [], processedRuns: [],
    };
    deepCleanRuntimeState.deepCleanPhase = 'scan-result';
    deepCleanRuntimeState.deepCleanSelection = lifecycle;
    renderDeepCleanScanResult(scanResult);
    return scanResult.affectedItemIndexes.length;
})()`;

async function main() {
    const { ws, send } = await connect();
    try {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await reloadAndWait(send, READY, '桌面场景重载就绪');
        await evaluate(send, `(() => { document.getElementById('blai-wand-btn')?.click(); return true; })()`);
        await sleep(400);

        const ruleCopy = await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(base + 'src/rules/view/view-02-panels.js');
            m.openEditModal(-1);
            const modal = document.getElementById('blai-rule-edit-modal');
            const groupText = modal.textContent;
            m.openSingleRuleModal(-1);
            const subText = document.getElementById('blai-subrule-edit-modal').textContent;
            const homeText = document.getElementById('blai-home-rule-grid').textContent;
            document.getElementById('blai-subrule-edit-modal').style.display = 'none';
            document.getElementById('blai-rule-edit-modal').style.display = 'none';
            return {
                groupTitle: document.getElementById('blai-edit-modal-title').textContent.trim(),
                groupText, subText, homeText,
                saveLabel: document.getElementById('blai-edit-save').textContent.trim(),
                recognizeLabel: document.getElementById('blai-modal-sub-regex-recognize').textContent.trim(),
            };
        })()`);
        check('规则分组弹窗标题与按钮已统一',
            ruleCopy.groupTitle.includes('新增规则分组') && ruleCopy.saveLabel === '保存规则分组',
            `${ruleCopy.groupTitle} / ${ruleCopy.saveLabel}`);
        check('规则相关界面不再出现合集/子规则/映射规则',
            !/合集|子规则|映射规则/.test(ruleCopy.groupText + ruleCopy.subText + ruleCopy.homeText),
            '三类文案均已扫描');
        check('子规则弹窗语法与替换按钮文案已统一',
            ruleCopy.subText.includes('备注（可选）')
            && ruleCopy.subText.includes('语法高亮')
            && ruleCopy.subText.includes('改写要求（可选）')
            && ruleCopy.recognizeLabel === '识别为替换项',
            ruleCopy.recognizeLabel);

        await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(base + 'src/deepClean/view/view-00-selection.js');
            m.openDeepCleanInitialSelection();
            return true;
        })()`);
        await waitFor(send, `document.getElementById('blai-deep-clean-workspace')?.classList.contains('blai-is-open')`,
            '深度清理工作区未打开', 30, 300);
        const seeded = await evaluate(send, SEED_PREVIEW);
        check('预览样例已写入冻结运行', seeded === 2, `affected=${seeded}`);
        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview-row')`, '预览列表未出现', 30, 300);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview .blai-diff-full-text')`, '程序差异预览未出现', 30, 300);
        const previewUi = await evaluate(send, `(() => {
            const root = document.querySelector('.blai-deep-clean-preview');
            return {
                filters: Array.from(root.querySelectorAll('[data-deep-clean-preview-filter]')).map(b => b.textContent.trim()),
                rows: root.querySelectorAll('[data-deep-clean-preview-item]').length,
                step: root.querySelector('.blai-deep-clean-preview-step')?.textContent || '',
                mode: root.querySelector('[data-deep-clean-preview-mode="program"]')?.getAttribute('aria-pressed'),
                diff: !!root.querySelector('.blai-diff-full-text'),
                runLabel: root.querySelector('[data-deep-clean-preview-run]')?.textContent || '',
            };
        })()`);
        check('预览页提供四种筛选', previewUi.filters.length === 4, previewUi.filters.join(' / '));
        check('程序预览逐条渲染差异', previewUi.rows === 2 && previewUi.step.includes('1 / 2') && previewUi.diff,
            JSON.stringify(previewUi));
        check('默认进入程序改写预览', previewUi.mode === 'true' && previewUi.runLabel.includes('2'), previewUi.runLabel);

        await evaluate(send, `(() => {
            document.querySelector('[data-deep-clean-preview-filter="program"]')?.click();
            return true;
        })()`);
        const programFilter = await evaluate(send, `document.querySelectorAll('[data-deep-clean-preview-item]').length`);
        check('程序筛选只显示命中程序规则的条目', programFilter === 2, `rows=${programFilter}`);

        await evaluate(send, `(() => {
            const rows = document.querySelectorAll('[data-deep-clean-preview-item]');
            rows[1]?.click();
            return true;
        })()`);
        await waitFor(send, `document.querySelector('.blai-deep-clean-preview-step')?.textContent.includes('2 / 2')`,
            '步骤导航未切到第二项', 20, 200);
        await evaluate(send, `(() => {
            const input = document.querySelector('[data-deep-clean-preview-include]');
            if (input) { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); }
            return true;
        })()`);
        const afterSkip = await evaluate(send, `(() => ({
            run: document.querySelector('[data-deep-clean-preview-run]')?.textContent || '',
            skipped: document.querySelector('[data-deep-clean-preview-filter="skipped"] span')?.textContent || '',
            step: document.querySelector('.blai-deep-clean-preview-step')?.textContent || '',
        }))()`);
        check('步骤导航与取消条目即时更新', afterSkip.step.includes('2 / 2') && afterSkip.skipped === '1' && afterSkip.run.includes('1'),
            JSON.stringify(afterSkip));

        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-filter="skipped"]')?.click(); return true; })()`);
        const skippedRows = await evaluate(send, `document.querySelectorAll('[data-deep-clean-preview-item]').length`);
        check('已取消筛选只显示跳过的条目', skippedRows === 1, `rows=${skippedRows}`);

        const shot = await capture(send, 'verify-copy-preview.png', {
            expectOpen: ['.blai-deep-clean-preview'],
            state: { viewport: 'desktop' },
        });
        console.log('截图:', shot);

        const completeCopy = await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(base + 'src/deepClean/view/view-01-progress.js');
            const read = () => ({
                title: document.querySelector('.blai-deep-clean-complete-state h3')?.textContent || '',
                desc: document.querySelector('.blai-deep-clean-complete-state p')?.textContent || '',
                labels: Array.from(document.querySelectorAll('.blai-deep-clean-completion-metrics dt')).map(e => e.textContent),
            });
            m.renderDeepCleanComplete({ affectedItemCount: 0, scannedItemCount: 10 });
            const noHits = read();
            m.renderDeepCleanComplete({
                affectedItemCount: 3, scannedItemCount: 10, appliedItemCount: 1,
                failedItemCount: 1, skippedItemCount: 1, retainedOriginalItemCount: 0,
                totalAiRequestCount: 2, successfulAiRequestCount: 1, failedAiRequestCount: 1,
                aiFailedOriginalItemCount: 1, oversizedAiItemCount: 0, aiFailureReasons: [],
            });
            return { noHits, failed: read() };
        })()`);
        check('命中 0 时不再显示假成功', completeCopy.noHits.title.includes('没有找到') && completeCopy.noHits.desc.includes('未写入任何更改'),
            JSON.stringify(completeCopy.noHits));
        check('有失败时标题与指标直说', completeCopy.failed.title.includes('部分内容未写入') && completeCopy.failed.labels.includes('已跳过'),
            JSON.stringify(completeCopy.failed));

        await reloadAndWait(send, READY, '手机场景重载就绪');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(base + 'src/deepClean/view/view-00-selection.js');
            m.openDeepCleanInitialSelection();
            return true;
        })()`);
        await waitFor(send, `document.getElementById('blai-deep-clean-workspace')?.classList.contains('blai-is-open')`,
            '手机深度清理工作区未打开', 30, 300);
        await evaluate(send, SEED_PREVIEW);
        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview-row')`, '手机预览列表未出现', 30, 300);
        const mobile = await evaluate(send, `(() => {
            const row = document.querySelector('.blai-deep-clean-preview-row');
            const list = document.querySelector('.blai-deep-clean-preview-list');
            const r = row.getBoundingClientRect();
            return { left: r.left, right: r.right, width: innerWidth, listHeight: list.getBoundingClientRect().height };
        })()`);
        check('手机端预览条目不越界', mobile.left >= 0 && mobile.right <= mobile.width && mobile.listHeight <= 160,
            JSON.stringify(mobile));
        console.log('无浏览器报错');
    } finally {
        ws.close();
    }
}

main().then(() => {
    const failed = failures.length;
    console.log(`\n结果：${failed === 0 ? '全部通过' : `${failed} 项未通过`}`);
    if (failed) process.exit(1);
}).catch((error) => {
    console.error('验证失败：', error);
    process.exit(1);
});
