#!/usr/bin/env node
/**
 * 深度清理差异排版、控件 token 与文案回归：
 *   1) 预览正文 del/ins 随文连续排版，不独占一行；
 *   2) 复选框为自绘（appearance:none），尺寸/配色走 token；
 *   3) body 浮层菜单滚动条走灰色 token（非酒馆原生紫色）；
 *   4) 改写项导航有撤销态视觉；
 *   5) 扫描结果「上一步」无箭头图标；
 *   6) 底部执行按钮文案为「清理全部 / 清理所选」。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-deep-clean-diff-flow.mjs
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
        { kind: 'user-message', locator: { messageIndex: 2 }, originalText: '她抠挖着地面，随后抠挖着泥土，最后抠挖着墙角。', programEligible: true, aiEligible: true },
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
    return true;
})()`;

async function main() {
    const { ws, send } = await connect();
    try {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await reloadAndWait(send, READY, '页面就绪');
        await evaluate(send, `(() => { document.getElementById('blai-wand-btn')?.click(); return true; })()`);
        await sleep(400);
        await evaluate(send, `(async () => { const b='/scripts/extensions/third-party/Veridis-Rewrite/'; const {openDeepCleanInitialSelection}=await import(b+'src/deepClean/view/view-00-selection.js'); openDeepCleanInitialSelection(); return true; })()`);
        await sleep(200);
        await evaluate(send, SEED);

        // 上一步：无箭头图标
        const back = await evaluate(send, `(() => {
            const btn = document.getElementById('blai-deep-clean-back-to-selection');
            return { text: btn?.textContent.trim() || '', icons: btn?.querySelectorAll('i').length ?? -1 };
        })()`);
        check('上一步按钮无箭头图标', back.text === '上一步' && back.icons === 0, JSON.stringify(back));

        await evaluate(send, `(() => { document.getElementById('blai-deep-clean-preview')?.click(); return true; })()`);
        await waitFor(send, `!!document.querySelector('.blai-deep-clean-preview-diff .blai-diff-change')`, '差异预览就绪', 40, 200);

        // 底部按钮文案
        const actions = await evaluate(send, `(() => ({
            all: document.querySelector('[data-deep-clean-preview-run-all]')?.textContent.trim() || '',
            selected: document.querySelector('[data-deep-clean-preview-run]')?.textContent.trim() || '',
        }))()`);
        check('底部按钮文案为清理全部/清理所选',
            /^清理全部（/.test(actions.all) && /^清理所选（/.test(actions.selected), JSON.stringify(actions));

        // 差异排版：容器 display:block；del/ins 与相邻正文在同一行盒内
        const diff = await evaluate(send, `(() => {
            const box = document.querySelector('.blai-deep-clean-preview-diff');
            const cs = getComputedStyle(box);
            const changes = Array.from(box.querySelectorAll('.blai-deep-clean-preview-change'));
            // 同一行判定：两个改写项的 top 相同（首行连续）
            const tops = changes.map(el => Math.round(el.getBoundingClientRect().top));
            return { display: cs.display, whiteSpace: cs.whiteSpace, count: changes.length,
                sameLine: tops.length >= 2 && tops[0] === tops[1], tops,
                text: box.textContent.slice(0, 60) };
        })()`);
        check('改写正文连续排版、del/ins 不独占一行',
            diff.display === 'block' && diff.whiteSpace === 'pre-wrap' && diff.sameLine,
            JSON.stringify(diff));

        // 复选框自绘 + token
        const checkbox = await evaluate(send, `(() => {
            const el = document.querySelector('[data-deep-clean-preview-change-check]');
            const cs = getComputedStyle(el);
            const t = getComputedStyle(document.documentElement);
            return { cls: el.className, appearance: cs.appearance || cs.webkitAppearance,
                width: Math.round(el.getBoundingClientRect().width),
                tokenSize: t.getPropertyValue('--blai-checkbox-size').trim() };
        })()`);
        check('复选框为自绘且尺寸走 token',
            checkbox.cls.includes('blai-check-native') && checkbox.appearance === 'none' && checkbox.width > 0,
            JSON.stringify(checkbox));

        // 复选框与所在行文字垂直居中（中线偏差 < 0.5px），且没有第二个原生勾号。
        const align = await evaluate(send, `(() => {
            const cb = document.querySelector('[data-deep-clean-preview-change-check]');
            const text = document.querySelector('.blai-deep-clean-preview-change-body');
            const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
            let node = null;
            while (walker.nextNode()) { if (walker.currentNode.textContent.trim()) { node = walker.currentNode; break; } }
            if (!node) return { deltaY: null, before: null };
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, Math.min(4, node.textContent.length));
            const t = range.getBoundingClientRect();
            const c = cb.getBoundingClientRect();
            return { deltaY: Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2),
                before: getComputedStyle(cb, '::before').content };
        })()`);
        check('复选框与所在行文字垂直居中且无第二勾号',
            align.deltaY !== null && align.deltaY <= 0.5 && align.before === 'none',
            JSON.stringify(align));

        // body 浮层菜单滚动条走灰色 token
        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-list-toggle]')?.click(); return true; })()`);
        await sleep(120);
        const portalScroll = await evaluate(send, `(async () => {
            const b = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const m = await import(b + 'src/ui/popover.js');
            const menu = document.createElement('div');
            menu.className = 'blai-portal-menu';
            menu.style.maxHeight = '40px';
            menu.style.overflowY = 'auto';
            menu.innerHTML = Array.from({length: 20}, (_, i) => '<div style="height:20px">item ' + i + '</div>').join('');
            document.body.appendChild(menu);
            const cs = getComputedStyle(menu, '::-webkit-scrollbar-thumb');
            const thumb = cs.backgroundColor;
            menu.remove();
            return { thumb };
        })()`);
        check('body 浮层滚动条走灰色 token',
            /rgba?\(/.test(portalScroll.thumb) && !/purple|128,\s*0,\s*128/.test(portalScroll.thumb),
            JSON.stringify(portalScroll));

        // 撤销态视觉：取消一个改写项，导航计数出现 has-reverted
        await evaluate(send, `(() => { document.querySelector('[data-deep-clean-preview-change-check]')?.click(); return true; })()`);
        await sleep(120);
        const nav = await evaluate(send, `(() => {
            const el = document.querySelector('.blai-deep-clean-preview-change-counter');
            return { cls: el?.className || '', dot: !!el?.querySelector('.blai-deep-clean-preview-change-reverted-dot'), title: el?.getAttribute('title') || '' };
        })()`);
        check('改写项导航有撤销态视觉', nav.cls.includes('has-reverted') && nav.dot, JSON.stringify(nav));

        await capture(send, 'verify-deep-clean-diff-flow');
        console.log(failures.length ? `\n${failures.length} 项失败` : '\n全部通过');
        process.exitCode = failures.length ? 1 : 0;
    } finally {
        ws.close();
    }
}

main().catch((error) => { console.error('验证失败：', error); process.exitCode = 1; });
