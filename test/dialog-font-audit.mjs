// 弹窗字号审计：批量找出「确认/提示/输入」类统一弹窗及同类静态弹窗，
// 用 CDP 在桌面/手机双视口实测正文与小控件（按钮、输入框、下拉）字号，给出推荐档位。
// 用法：node test/dialog-font-audit.mjs
//   CDP_PORT=9224  调试端口（需先启动带 --remote-debugging-port 的 Chrome）
//   OUT=tmp/dialog-font-report.json  结构化结果（可选）
// 只读：临时打开弹窗，测完按 Escape / 直接移除，不改源码与设置。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.CDP_PORT ?? '9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 静态枚举：找出「图1 这种弹窗」的全部生产点 ---------- */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
});
const jsFiles = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'templates', 'purifier.html'), 'utf8');
const producers = ['showConfirmModal', 'showAlertModal', 'showPromptModal', 'showUnsavedChangesModal', 'showRiskConfirmModal', 'showRiskInfoModal'];
const staticCallSites = {};
for (const name of producers) staticCallSites[name] = [];
for (const file of jsFiles) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const name of producers) {
            if (new RegExp(`\\b${name}\\s*\\(`).test(line)) {
                staticCallSites[name].push(`${path.relative(ROOT, file)}:${i + 1}`);
            }
        }
    });
}
const staticShells = [...HTML.matchAll(/<div\s+id="([^"]*(?:modal|dialog)[^"]*)"[^>]*class="[^"]*blai-modal-shell/gi)].map((m) => m[1]);

console.log('=== 弹窗生产点（静态扫描）===');
for (const name of producers) console.log(`  ${name.padEnd(24)} ${String(staticCallSites[name].length).padStart(2)} 处`);
console.log(`  静态 modal shell        ${staticShells.length} 个：${staticShells.join(', ')}`);
const totalCalls = producers.reduce((n, k) => n + staticCallSites[k].length, 0);
console.log(`  合计 ${totalCalls} 个调用点 + ${staticShells.length} 个静态弹窗`);

/* ---------- 2. 运行时实测：按统一外观分族抽样 ---------- */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有可用的 page target，请先启动调试 Chrome');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
});
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');

const CASES = [
    // 注意：show* 返回的是等用户点击的 Promise，这里只触发打开，绝不能 await，否则 Runtime.evaluate 永久挂起。
    { key: 'showConfirmModal', label: '确认弹窗（图1）', open: 'm.showConfirmModal("当前分组有未保存的改动，是否保存？", { okText: "保存" })', close: 'esc', body: '.blai-plugin-dialog-text', ctrl: '.blai-modal-actions button', input: '.blai-plugin-dialog-input' },
    { key: 'showUnsavedChangesModal', label: '未保存三选一（图1原型）', open: 'm.showUnsavedChangesModal()', close: 'esc', body: '.blai-plugin-dialog-text', ctrl: '.blai-modal-actions button', input: null },
    { key: 'showPromptModal', label: '输入弹窗', open: 'm.showPromptModal("输入名称", "默认值")', close: 'esc', body: '.blai-plugin-dialog-text', ctrl: '.blai-modal-actions button', input: '.blai-plugin-dialog-input' },
    { key: 'riskConfirm', label: '风险确认弹窗', open: "$('#blai-risk-confirm-modal').css('display','flex')", close: 'hide:#blai-risk-confirm-modal', body: '#blai-risk-confirm-text', ctrl: '#blai-risk-confirm-modal .blai-modal-actions button', input: null },
    { key: 'transfer', label: '移动规则弹窗（图3）', open: "$('#blai-subrule-transfer-modal').css('display','flex')", close: 'hide:#blai-subrule-transfer-modal', body: '.blai-subrule-transfer-hint', ctrl: '.blai-transfer-actions button', input: '#blai-subrule-transfer-target' },
];

const MEASURE = `((cfg) => {
    const fs = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { px: parseFloat(s.fontSize), weight: s.fontWeight, selector: sel, text: (el.textContent || '').trim().slice(0, 18) };
    };
    return { body: cfg.body ? fs(cfg.body) : null, ctrl: fs(cfg.ctrl), input: cfg.input ? fs(cfg.input) : null };
})`;

const results = {};
for (const [vpName, vp] of [['desktop', { width: 1353, height: 858 }], ['mobile', { width: 390, height: 844 }]]) {
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setDeviceMetricsOverride', { ...vp, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const tiers = await evaluate(`(() => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(['note','body','sub','title','hero'].map(k => [k, parseFloat(s.getPropertyValue('--blai-fs-' + k))])); })()`);
    results[vpName] = { viewport: `${vp.width}x${vp.height}`, tiers, cases: {} };

    for (const c of CASES) {
        const openExpr = `(async () => { const m = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/ui/notifications.js'); ${c.open}; return true; })()`;
        await evaluate(openExpr);
        await sleep(120);
        const measured = await evaluate(`${MEASURE}(${JSON.stringify({ body: c.body, ctrl: c.ctrl, input: c.input })})`);
        measured.ratio = measured.body && measured.ctrl ? +(measured.body.px / measured.ctrl.px).toFixed(2) : null;
        results[vpName].cases[c.key] = { label: c.label, ...measured };
        if (c.close === 'esc') await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        else await evaluate(`$('${c.close.split(':')[1]}').hide()`);
        await sleep(60);
        await evaluate(`document.querySelectorAll('.blai-plugin-dialog').forEach(e => e.remove())`);
    }
}
await send('Emulation.clearDeviceMetricsOverride');
ws.close();

console.log('\n=== 实测字号（px）===');
for (const vpName of Object.keys(results)) {
    const r = results[vpName];
    console.log(`\n[${vpName} ${r.viewport}] 档位 note=${r.tiers.note} body=${r.tiers.body} sub=${r.tiers.sub} title=${r.tiers.title}`);
    console.log('  弹窗                     正文    按钮    输入框   正文/按钮');
    for (const c of Object.values(r.cases)) {
        const f = (x) => x ? String(x.px).padStart(5) : '    -';
        console.log(`  ${c.label.padEnd(22)} ${f(c.body)} ${f(c.ctrl)} ${f(c.input)} ${c.ratio === null ? '   -' : String(c.ratio).padStart(6)}`);
    }
}

const d = results.desktop, m = results.mobile;
const confD = d.cases.showConfirmModal, confM = m.cases.showConfirmModal;
console.log('\n=== 诊断与推荐（依据 E:/Plugin Development/docs/DESIGN.md §3 五档）===');
console.log(`  现状：统一确认弹窗正文 桌面 ${confD.body.px}px / 手机 ${confM.body.px}px，按钮 ${confD.ctrl.px}/${confM.ctrl.px}px，比值 ${confD.ratio}/${confM.ratio}。`);
const inverted = Object.values(results).some((r) => r.cases.showConfirmModal.ratio < 1);
if (inverted) console.log('  问题：手机上正文比按钮小、主次颠倒；note 11px 只该用于辅助浅字，不该承载弹窗主要说明。');
else console.log('  校验：正文不再小于按钮，主次关系正确。');
console.log(`  推荐：正文用 body（桌面 ${d.tiers.body}px / 手机 ${m.tiers.body}px），按钮与输入框同为 body 档并靠字重（600）区分；`);
console.log(`        辅助说明继续用 note（${d.tiers.note}px）；比值 = 1.00。层级靠粗细、颜色、间距，不再靠缩小字号。`);
const trD = d.cases.transfer, trM = m.cases.transfer;
console.log(`  图3：提示 ${trD.body?.px ?? '-'}/${trM.body?.px ?? '-'}px，按钮 ${trD.ctrl.px}/${trM.ctrl.px}px；建议提示与统一弹窗同为 body 档、按钮按内容宽度右对齐。`);

if (process.env.OUT) {
    const out = path.resolve(ROOT, process.env.OUT);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ callSites: staticCallSites, staticShells, results }, null, 2));
    console.log(`\n结构化报告：${out}`);
}
