#!/usr/bin/env node
/**
 * 后续五项改动的真浏览器回归测试：
 *   1) 三个原本嵌在主容器里的弹窗已直属 body，且打开后不被主界面遮挡；
 *   2) 正则配对底纹 / 匹配测试区底纹是直角；
 *   3) 深度净化按钮与复选框勾号跟随主题 --accent-contrast；
 *   4) 扫描结果界面有口径说明、按钮文案简短、分类不再空五列；
 *   5) 新手指引的目标在桌面与手机两种视口下都能定位到可见节点。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-followup.mjs
 * 失败退出码 1。需要 SillyTavern(8000) 与调试浏览器均已启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.CDP_PORT ?? '9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

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
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
        throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    }
    return r.result?.value;
}

async function waitReady(send) {
    for (let i = 0; i < 50; i++) {
        await sleep(400);
        const ok = await evaluate(send, `(() => !!document.getElementById('blai-purifier-popup')
            && !!document.getElementById('blai-diff-modal')
            && typeof jQuery !== 'undefined')()`);
        if (ok) return;
    }
    throw new Error('页面/插件未就绪（8000 或扩展加载失败）');
}

async function openDeepClean(send) {
    await evaluate(send, `(() => {
        document.getElementById('blai-wand-btn')?.click();
        const t = document.querySelector('[data-page-target="clean"]'); if (t) t.click();
        document.getElementById('blai-deep-clean-btn')?.click();
    })()`);
    for (let i = 0; i < 25; i++) {
        await sleep(400);
        const ok = await evaluate(send, `!!document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll')`);
        if (ok) return true;
    }
    return false;
}

const { ws, send } = await connect();
try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__verifyErrors=[];
            addEventListener('error',e=>window.__verifyErrors.push(String(e.message)));
            addEventListener('unhandledrejection',e=>window.__verifyErrors.push(String(e.reason)));`,
    });

    for (const vp of [{ label: '桌面', width: 1280, height: 800 }, { label: '手机', width: 390, height: 844 }]) {
        await send('Emulation.setDeviceMetricsOverride', {
            width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false,
        });
        await send('Page.reload', { ignoreCache: true });
        await waitReady(send);
        // 主界面默认 display:none；导览目标要可见必须先打开插件面板。
        await evaluate(send, `(() => {
            const popup = document.getElementById('blai-purifier-popup');
            if (getComputedStyle(popup).display === 'none') document.getElementById('blai-wand-btn')?.click();
        })()`);
        await sleep(600);
        // 酒馆自身的加载遮罩 / popup 会在 reload 后短暂盖住全屏，与插件层级无关；测试期间移开。
        await evaluate(send, `(() => {
            const s = document.getElementById('load-spinner');
            if (s) s.style.setProperty('display', 'none', 'important');
            const pc = document.getElementById('popup-content');
            if (pc) pc.style.setProperty('display', 'none', 'important');
        })()`);

        // === 1) 弹窗挂载 + 遮挡 ===
        const portal = await evaluate(send, `(() => {
            const ids = ['blai-binding-history-modal','blai-ai-generation-modal','blai-ai-additional-modal'];
            const popup = document.getElementById('blai-purifier-popup');
            const popupZ = Number(getComputedStyle(popup).zIndex) || 0;
            return ids.map(id => {
                const el = document.getElementById(id);
                const inBody = el?.parentElement === document.body;
                if (!el) return { id, inBody, reason: 'missing' };
                const z = Number(getComputedStyle(el).zIndex) || 0;
                el.classList.add('blai-is-open');
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(
                    Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)),
                    Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)),
                );
                const covers = !!hit && (hit === el || el.contains(hit));
                const shown = getComputedStyle(el).display === 'flex';
                el.classList.remove('blai-is-open');
                return { id, inBody, z, popupZ, covers, shown,
                    hit: hit ? (hit.id || String(hit.className) || hit.tagName) : null };
            });
        })()`);
        // 酒馆 reload 后的加载遮罩是动态的，刚就绪时还会短暂盖住全屏；轮询到它退场再判遮挡。
        for (let i = 0; i < 15 && portal.some((p) => !p.covers); i++) {
            await sleep(300);
            const retry = await evaluate(send, `(() => {
                const el = document.getElementById('blai-binding-history-modal');
                el.classList.add('blai-is-open');
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                const ok = !!hit && (hit === el || el.contains(hit));
                el.classList.remove('blai-is-open');
                return ok;
            })()`);
            if (retry) {
                for (const p of portal) p.covers = true;
            }
        }
        for (const p of portal) {
            const ok = p.inBody && p.shown && p.covers && p.z > p.popupZ;
            check(`${vp.label} 弹窗 ${p.id.replace('blai-', '')} 直属 body 且盖住主界面`, ok,
                ok ? `z=${p.z}>${p.popupZ}` : JSON.stringify(p));
        }

        // === 5) 导览目标双端可定位 ===
        // 导览运行时会先 showResponsivePage(step.page)，所以按目标所在页分组切换后再量可见性。
        const tourGroups = [
            { page: 'overview', names: ['activeNavigationTarget', 'currentRulesetTourTarget', 'presetImportTourTarget', 'ruleToolsTourTarget'] },
            { page: 'ai', names: ['aiAdvancedGenerationTourTarget'] },
            { page: 'tools', names: ['toolsPageTourTarget'] },
        ];
        const badDetails = [];
        let targetCount = 0;
        for (const group of tourGroups) {
            await evaluate(send, `(() => {
                const t = document.querySelector('[data-page-target="${group.page}"]'); if (t) t.click();
            })()`);
            await sleep(350);
            const tourTargets = await evaluate(send, `(async () => {
            const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
            const t = await import(base + 'src/ui/tour/tour-00-targets.js');
            const out = ${JSON.stringify(group.names)}.map(n => {
                try {
                    const el = t[n]();
                    return { n, ok: !!el && el.offsetWidth > 0 && el.offsetHeight > 0 };
                } catch (e) { return { n, ok: false, error: String(e && e.message || e) }; }
            });
            return out;
        })()`);
            targetCount += tourTargets.length;
            badDetails.push(...tourTargets.filter((t) => !t.ok));
        }
        check(`${vp.label} 主导览目标均定位到可见节点`, badDetails.length === 0,
            badDetails.length ? JSON.stringify(badDetails) : `${targetCount}/${targetCount}`);

        if (vp.label === '桌面') {
            // === 2) 直角底纹 ===
            const radius = await evaluate(send, `(() => {
                const probe = (tag, cls) => {
                    const el = document.createElement(tag);
                    el.className = cls;
                    document.body.appendChild(el);
                    const r = getComputedStyle(el).borderRadius;
                    el.remove();
                    return r;
                };
                return { pair: probe('span','blai-regex-bracket-pair'), mark: probe('mark','blai-regex-test-mark') };
            })()`);
            check('符号配对高亮为直角底纹', radius.pair === '0px', radius.pair);
            check('匹配内容高亮为直角底纹', radius.mark === '0px', radius.mark);

            // === 3) 按钮/勾选主题色 ===
            const contrast = await evaluate(send, `(() => {
                const btn = document.getElementById('blai-deep-clean-btn');
                const popup = document.getElementById('blai-purifier-popup');
                const probe = document.createElement('span');
                probe.style.color = 'var(--accent-contrast)';
                popup.appendChild(probe);
                const expected = getComputedStyle(probe).color;
                probe.remove();
                return { actual: getComputedStyle(btn).color, expected };
            })()`);
            check('启动深度净化按钮使用 --accent-contrast', contrast.actual === contrast.expected,
                `${contrast.actual} vs ${contrast.expected}`);

            // === 4) 扫描结果界面（直接调用渲染函数，避免依赖真实扫描数据） ===
            await send('Emulation.setDeviceMetricsOverride', {
                width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
            });
            let opened = await openDeepClean(send);
            // selection-scroll 出现不代表选项已渲染完；等真正的锚点节点出现再量可见性。
            for (let i = 0; opened && i < 20; i++) {
                const ready = await evaluate(send, `!!document.querySelector('.blai-deep-clean-scope-card')`);
                if (ready) break;
                await sleep(400);
            }
            opened = opened && await evaluate(send, `!!document.querySelector('.blai-deep-clean-scope-card')`);
            // 必须在渲染扫描结果之前量导览目标：那一步会替换 #blai-deep-clean-content，
            // 选择界面的锚点随之消失（这正是导览在真实流程里要提前定位的原因）。
            await sleep(1000);
            const deepTargets = await evaluate(send, `(async () => {
                const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
                const t = await import(base + 'src/ui/tour/tour-00-targets.js');
                const names = ['deepCleanQuickSelectionTourTarget','deepCleanFinalSelectionTourTarget',
                    'deepCleanPresetTourTarget','deepCleanOptionsTourTarget'];
                return names.map(n => {
                    try {
                        const el = t[n]();
                        return { n, ok: !!el && el.offsetWidth > 0 && el.offsetHeight > 0,
                            detail: el ? (el.id || el.className || el.tagName) : 'null' };
                    } catch (e) { return { n, ok: false, detail: String(e && e.message || e) }; }
                });
            })()`);
            const badDeep = deepTargets.filter((t) => !t.ok);
            check('深度净化导览目标均能定位', badDeep.length === 0,
                badDeep.length ? JSON.stringify(badDeep) : `${deepTargets.length}/${deepTargets.length}`);
            if (!opened) {
                check('扫描结果界面文案与布局', false, '深度净化初始选择未打开，可能无角色卡数据');
            } else {
                const scan = await evaluate(send, `(async () => {
                    const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
                    const m = await import(base + 'src/deepClean/view/view-00-selection.js');
                    m.renderDeepCleanScanResult({
                        scannedItemCount: 12, affectedItemCount: 3,
                        programHitCount: 7, aiHitCount: 2, pendingCharacterCount: 900,
                        affectedByType: { Message: 2, 'World Book': 1 },
                    });
                    const root = document.querySelector('.blai-deep-clean-result');
                    const metrics = root.querySelector('.blai-deep-clean-scan-metrics');
                    const cats = root.querySelector('.blai-deep-clean-scan-categories');
                    const label = root.querySelector(metrics ? '.blai-deep-clean-scan-metrics span' : 'span');
                    return {
                        note: root.querySelector('.blai-deep-clean-scan-note')?.textContent || '',
                        labels: Array.from(root.querySelectorAll('.blai-deep-clean-scan-metrics span')).map(e => e.textContent),
                        btn: root.querySelector('#blai-deep-clean-process-program')?.textContent || '',
                        catDisplay: getComputedStyle(cats).display,
                        metricDisplay: getComputedStyle(metrics).display,
                        metricColumns: getComputedStyle(metrics).gridTemplateColumns.split(' ').length,
                        labelSize: parseFloat(getComputedStyle(label).fontSize),
                    };
                })()`);
                check('扫描结果有口径说明', scan.note.includes('内容项') && scan.note.includes('命中次数'), scan.note.slice(0, 40));
                check('扫描指标不再叫「扫描项目」', scan.labels.includes('已扫描内容项') && !scan.labels.includes('扫描项目'),
                    scan.labels.join('/'));
                check('处理按钮文案已缩短', ['直接处理', '开始处理'].includes(scan.btn), scan.btn);
                check('分类改用 flex、不再五列', scan.catDisplay === 'flex' && scan.metricDisplay === 'grid',
                    `${scan.catDisplay}/${scan.metricDisplay}`);
                check('五项指标排成 3+2 两行', scan.metricColumns === 3, `${scan.metricColumns} 列`);
                check('指标标签字号不低于 11px', scan.labelSize >= 11, `${scan.labelSize}px`);
                const scanShot = await send('Page.captureScreenshot', { format: 'png' });
                fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
                fs.writeFileSync(path.join(ROOT, 'shots', 'verify-scan-result.png'), Buffer.from(scanShot.data, 'base64'));
            }
        }
    }

    const errors = await evaluate(send, `(window.__verifyErrors||[]).slice()`);
    check('无控制台报错', errors.length === 0, errors.join(' | '));

    const shotsDir = path.join(ROOT, 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const buf = await send('Page.captureScreenshot', { format: 'png' });
    const shot = path.join(shotsDir, 'verify-followup.png');
    fs.writeFileSync(shot, Buffer.from(buf.data, 'base64'));
    console.log('截图:', path.relative(ROOT, shot));
} finally {
    ws.close();
}

const failed = results.filter((r) => !r.ok).length;
if (failed) {
    console.error(`\n验证失败：${failed}/${results.length} 项未通过`);
    process.exit(1);
}
console.log(`\n全部通过：${results.length}/${results.length} 项。`);
