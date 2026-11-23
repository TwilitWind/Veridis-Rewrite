#!/usr/bin/env node
/**
 * 深度净化回归测试（真浏览器，守用户实际感受得到的行为）：
 *   1) 程序改写链路能跑：matching 模块不再抛 collectVariableUpdateRanges is not defined；
 *   2) 初始选择里勾选复选框后，滚动位置不被强制拉回顶部（只保留小误差）。
 *
 * 关键背景：这两条都曾"改了没改好"——
 *   - matching-00-compile.js 漏导入 collectVariableUpdateRanges，node --check 过、点开才炸；
 *   - 勾选触发整块 .html() 重渲染，滚动容器被重建，scrollTop 归零。
 * 所以本脚本在真浏览器里加载真实模块、真实点击，而不是 grep 源码文本。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-deep-clean.mjs
 * 需要 SillyTavern(8000) 已起、且 9224 有调试浏览器打开着 8000 页面。
 * 失败退出码 1，并打印逐项期望/实际。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.CDP_PORT ?? '9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:8000'))
        || list.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用的 page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    return { ws, send };
}

async function evaluate(send, expression) {
    const r = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
        throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    }
    return r.result?.value;
}

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const { ws, send } = await connect();
try {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 1, mobile: false });
    await send('Page.reload', { ignoreCache: true });
    // 等页面与插件就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
        await sleep(400);
        ready = await evaluate(send, `(() => !!document.getElementById('blai-deep-clean-btn') && typeof jQuery !== 'undefined')()`);
        if (ready) break;
    }
    if (!ready) throw new Error('页面/插件未就绪（8000 或扩展加载失败）');

    // === 1) 程序改写链路：真浏览器加载模块并调用，确认不再 ReferenceError ===
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
    let inSelection = false;
    for (let i = 0; i < 20; i++) {
        await sleep(400);
        inSelection = await evaluate(send, `!!document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll')`);
        if (inSelection) break;
    }
    if (!inSelection) throw new Error('深度净化初始选择未打开（可能无角色卡数据）');

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
} finally {
    ws.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exit(1);
