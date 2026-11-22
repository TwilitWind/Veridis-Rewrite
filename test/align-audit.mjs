// 垂直居中审计：追踪 UI 控件是否与所在行的文本垂直居中对齐。
// 前置：SillyTavern 已在本地运行，且有开了 --remote-debugging-port=9224 的 Chrome。
// 用法：node test/align-audit.mjs
//   CDP_PORT=9224  调试端口
//   TOL=4          中线偏差阈值（px），超过即报
//   OUT=report.json 结构化结果
//   NO_MOBILE=1    只测桌面
//   STRICT=1       偏差 > TOL 即退出 1（测得的是真实几何，属判定非线索）
// 只读：不改源码；临时打开面板/弹窗、切视口，退出还原。
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9224';
const TOL = Number(process.env.TOL ?? 2);
const NO_MOBILE = process.env.NO_MOBILE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有可用的 page target');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setDeviceMetricsOverride', { width: 1353, height: 858, deviceScaleFactor: 1, mobile: false });
await sleep(400);

/* 审计函数注入一次，桌面/手机各调用一次，判定一致。
   思路：某个 flex/grid 容器的直接子元素中，若同时存在「单行文本」与「UI 控件」，
   且它们在视觉上处于同一行（垂直区间有交叠），比较垂直中线偏差。 */
const AUDIT = function (tol) {
    const cs = (e) => getComputedStyle(e);
    const vis = (e) => {
        const s = cs(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
    };
    const desc = (e) => {
        const idv = e.id ? '#' + e.id : '';
        const cl = typeof e.className === 'string' && e.className.trim()
            ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        const txt = (e.textContent || '').trim().slice(0, 12);
        return `${e.tagName.toLowerCase()}${idv}${cl}` + (txt ? `「${txt}」` : '');
    };
    const rectOf = (e) => { const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cy: +(r.top + r.height / 2).toFixed(1) }; };

    const isControl = (e) => {
        if (/^(BUTTON|SELECT|INPUT|TEXTAREA)$/.test(e.tagName)) return true;
        const c = (typeof e.className === 'string' ? e.className : '');
        return /switch|trigger|icon-btn|toggle|-btn\b|filter-chip|dropdown/i.test(c) || e.getAttribute('role') === 'button';
    };
    const directText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // 单行文本：自身有直接文本，且高度不超过 ~2 行（用 fontSize 估算），排除多行段落
    const isSingleLineText = (e) => {
        if (!directText(e)) return false;
        const fs = parseFloat(cs(e).fontSize) || 14;
        const r = e.getBoundingClientRect();
        return r.height <= fs * 2.2;
    };

    // 收集所有可见容器（flex/grid）的直接子元素
    const scopeIds = ['blai-purifier-popup', 'blai-rule-edit-modal', 'blai-subrule-edit-modal',
        'blai-diff-modal', 'blai-feedback-workspace', 'blai-scope-tag-editor-modal'];
    const roots = scopeIds.map((s) => document.getElementById(s)).filter(Boolean);
    const issues = [];
    const checked = new Set();
    for (const root of roots) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
            if (!vis(el)) continue;
            const s = cs(el);
            if (!/flex|grid|inline-flex/.test(s.display)) continue;
            const kids = [...el.children].filter(vis);
            const texts = kids.filter(isSingleLineText);
            // 控件可能是容器的直接子元素，也可能包在一层 actions 包装里（如编辑弹窗的
            // .blai-edit-head-actions > .blai-edit-filter-wrap）。所以取容器内所有后代控件，
            // 但仍以本容器为界，靠下面的「垂直区间重叠 + 中线偏差」筛出真正同行者。
            const ctrls = [...el.querySelectorAll('*')].filter((k) => vis(k) && isControl(k) && !isSingleLineText(k));
            if (!texts.length || !ctrls.length) continue;
            for (const t of texts) {
                for (const c of ctrls) {
                    const rt = t.getBoundingClientRect(), rc = c.getBoundingClientRect();
                    // 同一行：垂直区间有交叠（含少量容差）
                    const vOverlap = Math.min(rt.bottom, rc.bottom) - Math.max(rt.top, rc.top);
                    if (vOverlap <= 0) continue;
                    const key = t.id + '|' + c.id + '|' + Math.round(rc.top);
                    if (checked.has(key)) continue;
                    checked.add(key);
                    const delta = +(rc.top + rc.height / 2 - (rt.top + rt.height / 2)).toFixed(1);
                    if (Math.abs(delta) <= tol) continue;
                    // 排除明确的浮层：toast / 底部导航 / rail 导航。
                    // 注意不能按 position:fixed 排除——弹窗 shell 本身就是 fixed，
                    // 会把弹窗内所有控件都误当成浮层，导致这类 bug 全部漏检。
                    let p = c, deco = false;
                    while (p && p !== document.body) {
                        if (/toast|overlay|bottom-nav|rail-nav/i.test(typeof p.className === 'string' ? p.className : '')) { deco = true; break; }
                        p = p.parentElement;
                    }
                    if (deco) continue;
                    issues.push({
                        container: desc(el),
                        text: desc(t), textRect: rectOf(t),
                        control: desc(c), controlRect: rectOf(c),
                        delta,
                    });
                }
            }
        }
    }
    return { viewport: { w: innerWidth, h: innerHeight }, tol, issues };
};

const evalAudit = `(${AUDIT.toString()})(${JSON.stringify(TOL)})`;
const MODALS = ['blai-rule-edit-modal', 'blai-subrule-edit-modal', 'blai-diff-modal', 'blai-scope-tag-editor-modal'];
const hideModals = () => evaluate(`(() => { ${JSON.stringify(MODALS)}.forEach(id => { const m=document.getElementById(id); if(m) m.style.setProperty('display','none','important'); }); })()`);
const runAll = async () => {
    const out = [];
    // 弹窗是全局节点，不属于任何 page-panel；测页面时先全部隐藏，避免每条 page 重复算到弹窗内的控件。
    await hideModals();
    const pages = await evaluate(`[...document.querySelectorAll('.page-panel')].map(p=>p.dataset.page)`);
    for (const p of pages) {
        await evaluate(`(() => { document.querySelectorAll('.page-panel').forEach(x=>x.classList.toggle('active', x.dataset.page===${JSON.stringify(p)})); })()`);
        await sleep(120);
        out.push({ page: p, ...(await evaluate(evalAudit)) });
    }
    // 弹窗：逐个强制显示后测，测完立刻隐藏
    await hideModals();
    for (const m of ['blai-rule-edit-modal', 'blai-subrule-edit-modal']) {
        await evaluate(`(() => { const m=document.getElementById(${JSON.stringify(m)}); if(m) m.style.setProperty('display','flex','important'); })()`);
        await sleep(150);
        out.push({ page: m, ...(await evaluate(evalAudit)) });
        await evaluate(`(() => { const m=document.getElementById(${JSON.stringify(m)}); if(m) m.style.setProperty('display','none','important'); })()`);
    }
    return out;
};

// 打开面板
await evaluate(`(() => { const p=document.getElementById('blai-purifier-popup'); if(p) p.style.setProperty('display','grid','important'); })()`);
await sleep(300);
const desktop = await runAll();
let mobile = null;
if (!NO_MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await sleep(500);
    mobile = await runAll();
    await send('Emulation.clearDeviceMetricsOverride');
}

const result = { meta: { port: PORT, tol: TOL, checkedAt: new Date().toISOString() }, desktop, mobile };
const out = process.env.OUT;
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));

console.log('垂直居中审计（控件 vs 同行文本，阈值 ' + TOL + 'px）');
console.log('─'.repeat(62));
for (const [label, runs] of [['桌面', desktop], ['手机', mobile]]) {
    if (!runs) continue;
    let total = 0;
    console.log(label + ' ' + runs[0]?.viewport.w + '×' + runs[0]?.viewport.h);
    for (const run of runs) {
        total += run.issues.length;
        if (run.issues.length) {
            for (const i of run.issues.slice(0, 8)) {
                console.log(`  [${run.page}] ${i.text} × ${i.control}  偏差 ${i.delta > 0 ? '+' : ''}${i.delta}px`);
            }
        }
    }
    console.log('  合计 ' + total + ' 处偏差' + (total ? '' : '（全部对齐）'));
}
if (out) console.log('结构化结果：' + out);
const STRICT = process.env.STRICT === '1';
const totalIssues = [...desktop, ...(mobile || [])].reduce((n, run) => n + run.issues.length, 0);
if (STRICT) console.log(`\nSTRICT=1 闸门：中线偏差 ${totalIssues} 处（阈值 ${TOL}px）`);
ws.close();
if (STRICT && totalIssues) {
    console.error(`STRICT 失败：${totalIssues} 处控件与文本未垂直居中，请修正对齐或确认是否属白名单例外。`);
    process.exit(1);
}
