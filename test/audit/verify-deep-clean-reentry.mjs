#!/usr/bin/env node
/**
 * 9224 端口回归：深度清理可重复进入、加载态可关闭、手机端不留悬停底色。
 * 用法：CDP_PORT=9224 node test/audit/verify-deep-clean-reentry.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate, waitFor, ensurePageFresh, check as harnessCheck, ROOT } from './_harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = `!!document.getElementById('blai-purifier-popup') && typeof jQuery !== 'undefined'`;

async function main() {
    const { ws, send } = await connect();
    try {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await ensurePageFresh(send, READY, '插件就绪', 120, { cleanState: true });
        await evaluate(send, `(() => { document.getElementById('blai-wand-btn')?.click(); document.querySelector('[data-page-target="clean"]')?.click(); return true; })()`);
        await sleep(300);

        const openAndProbe = async (label) => {
            await evaluate(send, `document.getElementById('blai-deep-clean-btn')?.click(); true`);
            await waitFor(send, `!!document.getElementById('blai-deep-clean-scan')`, `${label}选择界面`, 120, 250);
            return evaluate(send, `(() => ({
                open: document.getElementById('blai-deep-clean-workspace')?.classList.contains('blai-is-open'),
                hasScan: !!document.getElementById('blai-deep-clean-scan'),
                loadingOnly: document.getElementById('blai-deep-clean-content')?.textContent?.includes('正在读取可选资源')
                    && !document.getElementById('blai-deep-clean-scan'),
                errors: (window.__stProbeErrors || []).slice(-4),
            }))()`);
        };
        const first = await openAndProbe('首次');
        check('首次进入显示选择界面而非卡在加载态', first.open && first.hasScan && !first.loadingOnly, JSON.stringify(first));
        await evaluate(send, `document.getElementById('blai-deep-clean-close')?.click(); true`);
        await sleep(250);
        const second = await openAndProbe('二次');
        check('关闭后再次进入仍能显示选择界面', second.open && second.hasScan && !second.loadingOnly, JSON.stringify(second));
        check('重复进入没有浏览器脚本报错', first.errors.length === 0 && second.errors.length === 0,
            JSON.stringify([first.errors, second.errors]));

        await evaluate(send, `(async () => {
            const m = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/deepClean/view/view-00-selection.js');
            m.openDeepCleanInitialSelection();
            return true;
        })()`);
        const loadingClose = await evaluate(send, `!!document.querySelector('#blai-deep-clean-content #blai-deep-clean-close')`);
        check('加载态提供关闭按钮，不会把用户锁死', loadingClose);
        await evaluate(send, `document.getElementById('blai-deep-clean-close')?.click(); true`);
        await sleep(200);

        // 手机模拟器会把鼠标悬停粘在控件上；底色必须保持默认。
        await evaluate(send, `document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); true`);
        const probe = await evaluate(send, `(() => {
            const e = document.querySelector('.blai-global-icon-button');
            if (!e) return null;
            const s = getComputedStyle(e);
            const r = e.getBoundingClientRect();
            return { bg: s.backgroundColor, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);
        if (probe) {
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: probe.x, y: probe.y });
            await sleep(180);
            const hovered = await evaluate(send, `getComputedStyle(document.querySelector('.blai-global-icon-button')).backgroundColor`);
            check('手机端悬停不会给按钮加深底色', hovered === probe.bg, `${probe.bg} -> ${hovered}`);
        }

        const statusSource = fs.readFileSync(path.join(ROOT, 'src/update/status.js'), 'utf8');
        check('更新失败时给出本地副本提示，不直接甩 HTTP 500',
            statusSource.includes('当前副本有未提交的改动，无法在线切换分支更新')
            && !/prop\('hidden', false\)\.text\(error/.test(statusSource));
    } finally {
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }
    if (failures.length) {
        console.error(`\n验证失败：${failures.length} 项未通过`);
        process.exitCode = 1;
    } else {
        console.log('\n验证通过。');
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
