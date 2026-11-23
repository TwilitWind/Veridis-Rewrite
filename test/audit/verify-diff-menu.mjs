#!/usr/bin/env node
/**
 * 净化透视弹窗「顶栏 / ⋮ 菜单镜像互斥」真浏览器回归测试。
 *
 * 守的就是用户感受得到的行为：顶栏上有的功能，⋮ 菜单里不许重复；
 * 顶栏被收起的功能（手机断点 / reverted 状态），必须在 ⋮ 菜单里露出。
 *
 * 关键背景：菜单打开时会被 popover.js portal 到 <body>，任何依赖
 * #blai-diff-modal 祖先的 CSS 选择器都会失效。所以本测试在菜单「打开后」
 * 实测计算样式，而不是读源码里的 CSS 文本——后者是曾经骗过人的形式主义。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-diff-menu.mjs
 * 失败时进程退出码 1，并打印逐项期望/实际，便于定位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // 脚本在 test/audit/，项目根上两级
const PORT = process.env.CDP_PORT ?? '9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADER_IDS = [
    'blai-diff-pick-toggle',
    'blai-diff-revert-toggle',
    'blai-diff-mode-toggle',
];

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
    return { ws, send, page };
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

// 在给定视口下，真浏览器打开弹窗与菜单，返回顶栏/镜像的可见性快照。
async function snapshot(send, width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(400);
    // 重新加载确保 JS 状态干净（避免上一场景残留的 inline style 干扰）。
    await send('Page.reload', { ignoreCache: true });
    // 轮询等待页面就绪 + diff 按钮可点，不靠固定 sleep 猜时间。
    let ready = false;
    for (let i = 0; i < 40; i++) {
        await sleep(400);
        ready = await evaluate(send, `(() => {
            const b = document.querySelector('.blai-diff-btn-bottom');
            return document.readyState === 'complete' && !!b && b.offsetParent !== null;
        })()`);
        if (ready) break;
    }
    if (!ready) throw new Error(`${width}px: 页面未就绪 / diff 按钮不可点`);

    // 打开透视弹窗：点击后轮询等待 display 变为 flex。
    let modalOk = false;
    for (let i = 0; i < 15 && !modalOk; i++) {
        modalOk = await evaluate(send, `(() => {
            const b = document.querySelector('.blai-diff-btn-bottom');
            const modal = document.getElementById('blai-diff-modal');
            if (b && getComputedStyle(modal).display === 'none') b.click();
            return getComputedStyle(modal).display !== 'none';
        })()`);
        if (!modalOk) await sleep(300);
    }
    if (!modalOk) throw new Error(`${width}px: 透视弹窗未能打开`);

    // 真点击 ⋮，走 openDiffActionsMenu 的完整逻辑（含 portal + 可见性同步）。
    const data = await evaluate(send, `(() => {
        const toggle = document.getElementById('blai-diff-menu-toggle');
        const menu = document.getElementById('blai-diff-actions-menu');
        toggle.click();
        const headerVisible = ${JSON.stringify(HEADER_IDS)}.map(id => {
            const b = document.getElementById(id);
            return !!b && b.offsetParent !== null && getComputedStyle(b).display !== 'none';
        });
        const mirrors = Array.from(document.querySelectorAll('.blai-diff-menu-action')).map(i => {
            const act = i.getAttribute('data-blai-header-action');
            const idx = ${JSON.stringify(HEADER_IDS)}.indexOf(act);
            return { act, idx, visible: getComputedStyle(i).display !== 'none', headerVisible: headerVisible[idx] };
        }).filter(m => m.idx >= 0);
        const divider = menu.querySelector('.blai-diff-menu-divider');
        return {
            innerW: innerWidth,
            menuInBody: menu.parentElement === document.body,
            // AI 改写入口已移除，重新净化按 AI 开关自动串接；这里守住旧 DOM 不回归。
            aiRewriteGone: !document.getElementById('blai-diff-ai-rewrite')
                && !document.querySelector('[data-blai-header-action="blai-diff-ai-rewrite"]'),
            headerVisible,
            mirrors,
            dividerVisible: getComputedStyle(divider).display !== 'none',
            anyMirrorVisible: mirrors.some(m => m.visible),
        };
    })()`);
    return data;
}

function assertSnapshot(label, snap) {
    const failures = [];
    if (!snap.menuInBody) failures.push('菜单未被 portal 到 body（测试前提不成立）');
    if (!snap.aiRewriteGone) failures.push('AI 改写按钮仍存在（应已删除，由重新净化自动串接）');
    snap.mirrors.forEach((m) => {
        // 核心规则：顶栏可见 ⇔ 菜单镜像隐藏（严格互斥）。
        if (m.headerVisible && m.visible) {
            failures.push(`${m.act}: 顶栏可见，但菜单里重复出现了`);
        }
        if (!m.headerVisible && !m.visible) {
            failures.push(`${m.act}: 顶栏已隐藏，但菜单里也没有（功能丢失）`);
        }
    });
    if (snap.dividerVisible !== snap.anyMirrorVisible) {
        failures.push(`分隔线显示=${snap.dividerVisible} 与是否有镜像露出=${snap.anyMirrorVisible} 不一致`);
    }
    return failures;
}

async function main() {
    const { ws, send } = await connect();
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__verifyErrors=[];
            addEventListener('error',e=>window.__verifyErrors.push(String(e.message)));
            addEventListener('unhandledrejection',e=>window.__verifyErrors.push(String(e.reason)));`,
    });

    const cases = [
        { label: '桌面 1280', width: 1280, height: 800 },
        { label: '手机 390', width: 390, height: 844 },
    ];
    let failed = 0;
    const shotsDir = path.join(ROOT, 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });

    for (const c of cases) {
        const snap = await snapshot(send, c.width, c.height);
        const failures = assertSnapshot(c.label, snap);
        const errors = await evaluate(send, `(window.__verifyErrors||[]).slice()`);
        console.log(`\n[${c.label}] viewport=${snap.innerW}px  menuInBody=${snap.menuInBody}`);
        console.log('  顶栏可见:', snap.headerVisible.map((v, i) => `${HEADER_IDS[i].replace('blai-diff-', '')}=${v}`).join(' '));
        console.log('  菜单镜像:', snap.mirrors.map(m => `${m.act.replace('blai-diff-', '')}=${m.visible ? '显' : '隐'}`).join(' '));
        if (errors.length) failures.push('控制台报错: ' + errors.join(' | '));
        if (failures.length) {
            failed++;
            failures.forEach(f => console.log('  ✗ ' + f));
        } else {
            console.log('  ✓ 顶栏与菜单严格互斥，分隔线一致，无控制台报错');
        }
        const shot = path.join(shotsDir, `verify-diff-menu-${c.width}.png`);
        const buf = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(shot, Buffer.from(buf.data, 'base64'));
        console.log('  截图:', path.relative(ROOT, shot));
    }

    ws.close();
    if (failed) {
        console.error(`\n验证失败：${failed}/${cases.length} 个场景未通过`);
        process.exit(1);
    }
    console.log(`\n全部通过：${cases.length}/${cases.length} 个场景，顶栏与 ⋮ 菜单无重复、无遗漏。`);
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
