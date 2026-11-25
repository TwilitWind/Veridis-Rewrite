#!/usr/bin/env node
/**
 * 深度净化回归测试（9224 端口浏览器实测，守用户实际感受得到的行为）：
 *   1) 程序改写链路能跑：matching 模块不再抛 collectVariableUpdateRanges is not defined；
 *   2) 初始选择里勾选复选框后，滚动位置不被强制拉回顶部（只保留小误差）。
 *
 * 关键背景：这两条都曾"改了没改好"——
 *   - matching-00-compile.js 漏导入 collectVariableUpdateRanges，node --check 过、点开才炸；
 *   - 勾选触发整块 .html() 重渲染，滚动容器被重建，scrollTop 归零。
 * 所以本脚本在 9224 端口浏览器里加载真实模块、真实点击，而不是 grep 源码文本。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-deep-clean.mjs
 * 需要 SillyTavern(8000) 已起、且 9224 有调试浏览器打开着 8000 页面。
 * 失败退出码 1，并打印逐项期望/实际。
 */
import {
    connect, evaluate, waitFor, reloadAndWait, capture, check as harnessCheck,
} from './_harness.mjs';

const failures = [];
// 适配旧调用顺序，判定实现仍只有 harness 一处。
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);

const READY = `(() => !!document.getElementById('blai-deep-clean-btn') && typeof jQuery !== 'undefined')()`;
const SELECTION = `!!document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll')`;

async function main() {
    const { ws, send } = await connect();
    try {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 1, mobile: false });
        await reloadAndWait(send, READY, '页面与插件就绪');
        await waitFor(send, READY, '页面/插件未就绪（8000 或扩展加载失败）', 40, 400);

        // === 1) 程序改写链路：9224 端口浏览器加载模块并调用，确认不再 ReferenceError ===
        const program = await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            try {
                const m = await import(base + 'src/aiRewrite/matching/matching-00-compile.js');
                const ranges = m.collectEditableRanges('<UpdateVariable>{"x":1}</UpdateVariable>正文', {}, {});
                m.collectAiMatches('测试文本<UpdateVariable>x</UpdateVariable>', {}, {});
                return { ok: true, ranges: ranges?.length };
            } catch (e) { return { ok: false, error: String(e && (e.message || e)) }; }
        })()`);
        check('程序改写链路无 is not defined', program.ok === true, program.ok ? `ranges=${program.ranges}` : program.error);

        // === 2) 勾选复选框不回顶 ===
        // 打开面板 -> clean 页 -> 深度净化初始选择
        await evaluate(send, `(() => {
            document.getElementById('blai-wand-btn')?.click();
            const t = document.querySelector('[data-page-target="clean"]'); if (t) t.click();
            document.getElementById('blai-deep-clean-btn')?.click();
        })()`);
        await waitFor(send, SELECTION, '深度净化初始选择未打开（可能无角色卡数据）', 20, 400);

        const scroll = await evaluate(send, `(async () => {
            const s = document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll');
            s.scrollTop = s.scrollHeight - s.clientHeight;
            const before = Math.round(s.scrollTop);
            await new Promise(r => setTimeout(r, 120));
            const cb = document.querySelector('#blai-deep-clean-content input[data-deep-clean-option="includeHidden"]');
            cb.click();
            await new Promise(r => setTimeout(r, 400));
            const after = Math.round(document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll')?.scrollTop || 0);
            return { before, after };
        })()`);
        const kept = scroll.before > 100 && Math.abs(scroll.after - scroll.before) < 15;
        check('勾选后不强制回顶', kept, `before=${scroll.before} after=${scroll.after} (允许 15px 内误差)`);

        const shot = await capture(send, 'verify-deep-clean.png', {
            expectOpen: ['#blai-deep-clean-content .blai-deep-clean-selection-scroll'],
            state: { scrollBefore: scroll.before, scrollAfter: scroll.after },
        });
        console.log('截图:', shot);
    } finally {
        // 自己打开的工作区自己收：否则全量回归里下一条脚本的命中测试会被它盖住。
        await evaluate(send, `(async () => {
            const m = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/deepClean/view/view-00-selection.js');
            m.closeDeepCleanInitialSelection();
            return true;
        })()`).catch(() => {});
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }
    const failed = failures.length;
    console.log(`\n结果：${failed === 0 ? '全部通过' : `${failed} 项未通过`}`);
    if (failed) process.exit(1);
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
