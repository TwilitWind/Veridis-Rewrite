#!/usr/bin/env node
/**
 * 深度清理预览 UI 收口 + 改写项撤销的浏览器回归：
 *   1) 预览顶栏严格两行，筛选行并入步数/条目开关，标题行并入导航/纳入改写；
 *   2) 扫描结果「命中内容项分布」两项是紧凑 chip，同一行写完；
 *   3) 改写项左侧复选框默认全勾选，取消后出现「已撤销」面板并带来源；
 *   4) 面板项点击可切回对应条目，手机端仍为两行顶栏。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-deep-clean-ui-revert.mjs
 */
import { connect, evaluate, waitFor, reloadAndWait, capture, check as harnessCheck } from './_harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = `(() => !!document.getElementById('blai-purifier-popup') && typeof jQuery !== 'undefined')()`;

const SEED = `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
    const { scanDeepCleanContentItems } = await import(base + 'src/deepClean/scan.js');
    const { deepCleanRuntimeState } = await import(base + 'src/deepClean/state.js');
    const { renderDeepCleanScanResult } = await import(base + 'src/deepClean/view/view-00-selection.js');
    const preset = {
        rules: [{ name: '预览规则', enabled: true, subRules: [
            { enabled: true, mode: 'text', rewriteMode: 'program', targets: ['抠挖'], replacements: ['拨弄'] },
        ] }],
        aiRewrite: { promptTemplate: '{{annotatedSource}}', maxItemsPerRequest: 10, maxContextChars: 10000 },
    };
    const input = {
        preset, processingMode: 'program', characterKeys: ['demo'],
        chats: [{ characterKey: 'demo', chatId: 'chat-1' }],
        processingSemantics: { scopeTags: [], scopeTagBuiltinDismissed: [], scopeTagMode: 'protect' },
    };
    const items = [
        { kind: 'user-message', locator: { messageIndex: 2 }, originalText: '她抠挖着地面。', programEligible: true, aiEligible: true },
        { kind: 'user-message', locator: { messageIndex: 4 }, originalText: '他抠挖着泥土。', programEligible: true, aiEligible: true },
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
        await reloadAndWait(send, READY, '页面就绪');
        await evaluate(send, `(() => { document.getElementById('blai-wand-btn')?.click(); return true; })()`);
        await sleep(400);
        await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(base + 'src/deepClean/view/view-00-selection.js');
            m.openDeepCleanInitialSelection();
            return true;
        })()`);
        await waitFor(send, `(() => { const el = document.getElementById('blai-deep-clean-workspace'); return !!el && el.classList.contains('blai-is-open'); })()`, '深度清理工作区打开', 40, 200);
        await sleep(400);

        // 扫描结果的分布项：两项同一行、宽度不铺满容器。
        await evaluate(send, SEED);
        const chips = await evaluate(send, `(() => {
            const box = document.querySelector('.blai-deep-clean-scan-categories');
            const rows = Array.from(box.querySelectorAll(':scope > div')).map(el => el.getBoundingClientRect());
            const br = box.getBoundingClientRect();
            return { count: rows.length, sameLine: rows.length === 2 && Math.abs(rows[0].top - rows[1].top) < 2,
                fullWidth: rows.some(r => r.width > br.width * 0.8), boxWidth: br.width, widths: rows.map(r => r.width) };
        })()`);
        check('扫描分布项是同排紧凑 chip',
            chips.count === 2 && chips.sameLine && !chips.fullWidth && chips.widths.every(w => w > 0),
            JSON.stringify(chips));

        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview-diff .blai-diff-change')`, '差异预览就绪', 40, 200);

        // 顶栏严格两行：筛选行包含步数与条目开关；标题行包含导航与纳入改写。
        const header = await evaluate(send, `(() => {
            const root = document.querySelector('.blai-deep-clean-preview');
            const bar = root.querySelector('.blai-deep-clean-preview-bar');
            const entry = root.querySelector('.blai-deep-clean-preview-entry-bar');
            const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right, left: r.left }; };
            const filterBtn = bar.querySelector('[data-deep-clean-preview-filter]');
            const barTrailing = bar.querySelector('.blai-deep-clean-preview-bar-trailing');
            const entryTrailing = entry.querySelector('.blai-deep-clean-preview-entry-trailing');
            return {
                barRow: rect(bar), entryRow: rect(entry), filterLeft: rect(filterBtn).left,
                toggleRight: rect(barTrailing).right, navRight: rect(entryTrailing).right,
                barHasStep: !!bar.querySelector('.blai-deep-clean-preview-step'),
                entryHasTitle: !!entry.querySelector('h3'),
                headerHeight: rect(root.querySelector('.blai-deep-clean-preview-header')).bottom - rect(root.querySelector('.blai-deep-clean-preview-header')).top,
            };
        })()`);
        check('预览顶栏是筛选行+标题行两行',
            header.entryRow.top >= header.barRow.bottom - 1 && header.barHasStep && header.entryHasTitle,
            JSON.stringify({ bar: header.barRow, entry: header.entryRow }));
        check('两行右缘对齐成同一列',
            header.toggleRight > 0 && Math.abs(header.toggleRight - header.navRight) <= 2,
            JSON.stringify({ barTrailing: header.toggleRight, entryTrailing: header.navRight }));

        // 改写项复选框默认全勾选。
        const initial = await evaluate(send, `(() => {
            const boxes = Array.from(document.querySelectorAll('[data-deep-clean-preview-change-check]'));
            return { count: boxes.length, checked: boxes.filter(el => el.checked).length };
        })()`);
        check('改写项复选框默认全勾选', initial.count > 0 && initial.count === initial.checked, JSON.stringify(initial));

        // 取消一个改写项：正文切回原文，底栏左下角出现「已撤销」入口。
        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-change-check]')?.click(); return true; })()`);
        await sleep(120);
        const reverted = await evaluate(send, `(() => {
            const btn = document.querySelector('[data-deep-clean-preview-reverted-open]');
            const footer = document.querySelector('.blai-deep-clean-preview-actions');
            const br = btn?.getBoundingClientRect();
            const fr = footer?.getBoundingClientRect();
            return {
                exists: !!btn, text: btn?.textContent.trim() || '',
                bottomLeft: !!br && !!fr && br.left - fr.left < 40,
                originalShown: !!document.querySelector('.blai-deep-clean-preview-change.is-reverted del'),
            };
        })()`);
        check('撤销后底栏左下角出现入口且正文切回原文',
            reverted.exists && reverted.bottomLeft && reverted.originalShown && /已撤销/.test(reverted.text),
            JSON.stringify(reverted));

        // 点击入口打开独立弹窗，列出来源与改写前后文本。
        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-reverted-open]')?.click(); return true; })()`);
        await sleep(150);
        const modal = await evaluate(send, `(() => {
            const m = document.getElementById('blai-deep-clean-reverted-modal');
            const list = m?.querySelector('.blai-deep-clean-reverted-list');
            const card = m?.querySelector('.blai-modal-card');
            return {
                exists: !!m, text: m?.textContent.trim() || '',
                inBody: m?.parentElement === document.body,
                scrollable: !!list && getComputedStyle(list).overflowY === 'auto',
                cardHeight: card ? Math.round(card.getBoundingClientRect().height) : 0,
                rows: m?.querySelectorAll('.blai-deep-clean-reverted-row').length || 0,
            };
        })()`);
        check('撤销详情是独立弹窗且列出来源与改写内容',
            modal.exists && modal.inBody && modal.scrollable && modal.rows >= 1
            && /聊天消息/.test(modal.text) && /原改写/.test(modal.text) && /保留原文/.test(modal.text),
            JSON.stringify(modal));

        // 关闭弹窗后回到预览。
        await evaluate(send, `(() => { document.querySelector('#blai-deep-clean-reverted-modal .blai-secondary-btn')?.click(); return true; })()`);
        await sleep(100);
        const closed = await evaluate(send, `!document.getElementById('blai-deep-clean-reverted-modal')`);
        check('撤销弹窗可关闭', closed, String(closed));

        // 手机端顶栏仍是两行、右缘对齐。
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(250);
        const mobile = await evaluate(send, `(() => {
            const root = document.querySelector('.blai-deep-clean-preview');
            const bar = root.querySelector('.blai-deep-clean-preview-bar').getBoundingClientRect();
            const entry = root.querySelector('.blai-deep-clean-preview-entry-bar').getBoundingClientRect();
            const toggle = root.querySelector('.blai-deep-clean-preview-bar-trailing').getBoundingClientRect();
            const include = root.querySelector('.blai-deep-clean-preview-entry-trailing').getBoundingClientRect();
            return { twoRows: entry.top >= bar.bottom - 1, rightGap: Math.abs(toggle.right - include.right),
                overflow: document.documentElement.scrollWidth - innerWidth };
        })()`);
        check('手机端两行顶栏仍对齐且不横向溢出',
            mobile.twoRows && mobile.rightGap <= 2 && mobile.overflow <= 1, JSON.stringify(mobile));

        // 手机端预览正文与桌面同为 13px，不跟随 body 档位的 +1px 放大。
        const mobileFont = await evaluate(send, `(() => ({
            body: getComputedStyle(document.querySelector('.blai-deep-clean-preview-diff')).fontSize,
            token: getComputedStyle(document.documentElement).getPropertyValue('--blai-fs-deep-preview-body').trim(),
        }))()`);
        check('手机端预览正文字号与桌面同为 13px',
            mobileFont.body === '13px' && mobileFont.token === '13px', JSON.stringify(mobileFont));

        await capture(send, 'verify-deep-clean-ui-revert');
        console.log(failures.length ? `\n${failures.length} 项失败` : '\n全部通过');
        process.exitCode = failures.length ? 1 : 0;
    } finally {
        ws.close();
    }
}

main().catch((error) => { console.error('验证失败：', error); process.exitCode = 1; });
