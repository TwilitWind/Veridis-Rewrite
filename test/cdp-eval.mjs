// Evaluate JS in the current CDP page and print JSON result.
//   FRONT=1 -> Page.bringToFront first (background tabs throttle animations/timers).
import fs from 'node:fs';

let expression = process.argv[2] ?? 'document.title';
if (expression.startsWith('@')) expression = fs.readFileSync(expression.slice(1), 'utf8');
const PORT = process.env.CDP_PORT ?? '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
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
if (process.env.FRONT === '1') await send('Page.bringToFront');
if (process.env.VIEWPORT) {
    const [width, height] = process.env.VIEWPORT.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(Number(process.env.SETTLE_MS ?? 400));
}
const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
if (r.exceptionDetails) console.error('EVAL ERROR', JSON.stringify(r.exceptionDetails));
else console.log(JSON.stringify(r.result?.value, null, 2));
if (process.env.KEEP_VP !== '1') {
    try { await send('Emulation.clearDeviceMetricsOverride'); } catch {}
}
ws.close();
