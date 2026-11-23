// Drive the page with REAL CDP input events (trusted, like a user). Synthetic
// element.click() misses hover/mousedown guards and ST's drawer outside-click logic.
// Usage: node st-input.mjs <scenario.js> [snapExpr|@file]
//   scenario body runs with: click(sel,label) hover(sel,label) type(sel,text) key(name)
//   snap(label) evaluate(expr) sleep(ms) send(method,params) log
//   CDP_PORT=9224  VIEWPORT=WxH  STEP=450 (ms after each action)  KEEP_VP=1
import fs from 'node:fs';

const scenarioPath = process.argv[2];
if (!scenarioPath) throw new Error('usage: node st-input.mjs <scenario.js> [snapExpr]');
const scenario = fs.readFileSync(scenarioPath, 'utf8');
let snapExpr = process.argv[3] ?? '';
if (snapExpr.startsWith('@')) snapExpr = fs.readFileSync(snapExpr.slice(1), 'utf8');
if (!snapExpr) {
    snapExpr = '(() => ({ active: document.activeElement?.id || null, errors: (window.__stProbeErrors || []).slice(0, 5), docW: document.documentElement.scrollWidth, vw: innerWidth }))()';
}

const PORT = process.env.CDP_PORT ?? '9224';
const STEP = Number(process.env.STEP ?? 450);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
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
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');

if (process.env.VIEWPORT) {
    const [width, height] = process.env.VIEWPORT.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
}

const log = [];
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails) };
    return r.result?.value;
};
const snap = async (label) => {
    const s = await evaluate(snapExpr);
    log.push([label, s]);
    return s;
};
const center = (selector) => evaluate(
    '(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null;' +
    ' const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;' +
    ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');

const click = async (selector, label) => {
    const pt = await center(selector);
    if (!pt) { log.push([label ?? selector, 'MISSING']); return false; }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(STEP);
    await snap(label ?? selector);
    return true;
};
const hover = async (selector, label) => {
    const pt = await center(selector);
    if (!pt) { log.push([label ?? selector, 'MISSING']); return false; }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
    await sleep(STEP);
    await snap(label ?? selector);
    return true;
};
const type = async (selector, text) => {
    const ok = await click(selector);
    if (!ok) return false;
    for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await sleep(STEP);
    await snap('typed:' + selector);
    return true;
};
const key = async (name) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name });
    await sleep(STEP);
};

try {
    const run = new Function('click', 'hover', 'type', 'key', 'snap', 'sleep', 'evaluate', 'send', 'log',
        'return (async () => { ' + scenario + ' })();');
    await run(click, hover, type, key, snap, sleep, evaluate, send, log);
} catch (e) {
    log.push(['ERROR', String(e)]);
}
console.log(JSON.stringify(log, null, 1));
if (process.env.KEEP_VP !== '1') {
    try { await send('Emulation.clearDeviceMetricsOverride'); } catch { }
}
ws.close();