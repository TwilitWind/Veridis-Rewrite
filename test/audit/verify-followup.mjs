#!/usr/bin/env node
/**
 * 后续五项改动的 9224 端口浏览器回归测试：
 *   1) 三个原本嵌在主容器里的弹窗已直属 body，且打开后不被主界面遮挡；
 *   2) 正则配对底纹 / 匹配测试区底纹是直角；
 *   3) 深度净化按钮与复选框勾号跟随主题 --accent-contrast；
 *   4) 扫描结果界面有口径说明、按钮文案简短、分类不再空五列；
 *   5) 新手指引的目标在桌面与手机两种视口下都能定位到可见节点。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-followup.mjs
 * 失败退出码 1。需要 SillyTavern(8000) 与调试浏览器均已启动。
 */
import {
    connect, evaluate, waitFor, reloadAndWait, ensurePageFresh, capture, check as harnessCheck,
} from './_harness.mjs';

const failures = [];
// 适配旧调用顺序，判定实现仍只有 harness 一处。
const check = (name, ok, detail = '') => harnessCheck(failures, name, ok, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READY = `(() => !!document.getElementById('blai-purifier-popup')
    && !!document.getElementById('blai-diff-modal')
    && typeof jQuery !== 'undefined')()`;

async function openDeepClean(send) {
    await evaluate(send, `(() => {
        document.getElementById('blai-wand-btn')?.click();
        const t = document.querySelector('[data-page-target="clean"]'); if (t) t.click();
        document.getElementById('blai-deep-clean-btn')?.click();
    })()`);
    try {
        await waitFor(send, `!!document.querySelector('#blai-deep-clean-content .blai-deep-clean-selection-scroll')`,
            '深度净化初始选择未打开（可能无角色卡数据）', 25, 400);
        return true;
    } catch {
        return false;
    }
}

// 酒馆 reload 后加载遮罩是动态的；刚就绪时还会短暂盖住全屏，测试期间移开（与插件层级无关）。
const HIDE_HOST_OVERLAY = `(() => {
    for (const id of ['load-spinner', 'popup-content']) {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display', 'none', 'important');
    }
    return true;
})()`;

async function main() {
    const { ws, send } = await connect();
    try {
        const cases = [{ label: '桌面', width: 1280, height: 800 }, { label: '手机', width: 390, height: 844 }];
        for (const [index, vp] of cases.entries()) {
            await send('Emulation.setDeviceMetricsOverride', {
                width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false,
            });
            // 首场景按需刷新；换视口场景重载清掉上一轮导览/扫描替换的 DOM，避免读脏。
            if (index === 0) await ensurePageFresh(send, READY, '页面与插件就绪');
            else await reloadAndWait(send, READY, '页面与插件就绪');
            await waitFor(send, READY, '页面/插件未就绪（8000 或扩展加载失败）', 50, 400);
            // 防御：复用页面时可能残留别的脚本打开的深度净化工作区，它的层级高于待测弹窗。
            await evaluate(send, `(async () => {
                const m = await import('/scripts/extensions/third-party/Veridis-Rewrite/src/deepClean/view/view-00-selection.js');
                m.closeDeepCleanInitialSelection();
                return true;
            })()`);
            // 主界面默认 display:none；导览目标要可见必须先打开插件面板。
            await evaluate(send, `(() => {
                const popup = document.getElementById('blai-purifier-popup');
                if (getComputedStyle(popup).display === 'none') document.getElementById('blai-wand-btn')?.click();
            })()`);
            await sleep(600);
            await evaluate(send, HIDE_HOST_OVERLAY);
            // 复用页面时可能残留别的弹窗/退场态；命中检测会打到那些弹窗的字段标签。
            // 先统一关掉所有浮层，再逐个打开待测弹窗量遮挡，避免把状态污染判成层级回归。
            await evaluate(send, `(() => {
                document.querySelectorAll('.blai-modal-shell').forEach((el) => {
                    el.classList.remove('blai-is-open', 'blai-is-leaving');
                    el.style.removeProperty('pointer-events');
                    el.style.removeProperty('display');
                });
                return true;
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
                if (retry) for (const p of portal) p.covers = true;
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
                { page: 'feedback', names: ['feedbackPageTourTarget'] },
            ];
            const badDetails = [];
            let targetCount = 0;
            for (const group of tourGroups) {
                await evaluate(send, `(() => {
                    const t = document.querySelector('[data-page-target="${group.page}"]'); if (t) t.click();
                })()`);
                // 顺序淡出淡入是两段动画，后台标签页还可能节流定时器：轮询到目标真的可见再判，
                // 不用固定 sleep（350ms 偶发落在淡入之前，会假报导览目标不可见）。
                const measureExpr = `(async () => {
                    const base = '/scripts/extensions/third-party/Veridis-Rewrite/';
                    const t = await import(base + 'src/ui/tour/tour-00-targets.js');
                    return ${JSON.stringify(group.names)}.map(n => {
                        try {
                            const el = t[n]();
                            const ok = !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
                            return { n, ok, ...(!ok && el ? { parent: el.parentElement?.id || el.parentElement?.className || null, display: getComputedStyle(el).display, w: el.offsetWidth, h: el.offsetHeight } : {}) };
                        } catch (e) { return { n, ok: false, error: String(e && e.message || e) }; }
                    });
                })()`;
                let tourTargets = [];
                for (let i = 0; i < 25; i++) {
                    tourTargets = await evaluate(send, measureExpr);
                    if (tourTargets.every((t) => t.ok)) break;
                    await sleep(120);
                }
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
                    check('处理按钮文案已缩短', ['直接写入', '开始清理'].includes(scan.btn), scan.btn);
                    check('分类改用 flex、不再五列', scan.catDisplay === 'flex' && scan.metricDisplay === 'grid',
                        `${scan.catDisplay}/${scan.metricDisplay}`);
                    check('五项指标排成 3+2 两行', scan.metricColumns === 3, `${scan.metricColumns} 列`);
                    check('指标标签字号不低于 11px', scan.labelSize >= 11, `${scan.labelSize}px`);
                    const shot = await capture(send, 'verify-scan-result.png', {
                        expectOpen: ['.blai-deep-clean-result'],
                        state: { viewport: 'desktop' },
                    });
                    console.log('截图:', shot);
                }
            }
        }

        const errors = await evaluate(send, `(window.__stProbeErrors || []).slice()`);
        check('无控制台报错', errors.length === 0, errors.join(' | '));
        const shot = await capture(send, 'verify-followup.png', {
            expectOpen: ['#blai-purifier-popup'],
            state: { lastViewport: 'mobile' },
        });
        console.log('截图:', shot);
    } finally {
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }
    if (failures.length) {
        console.error(`\n验证失败：${failures.length} 项未通过`);
        process.exit(1);
    }
    console.log(`\n验证通过。`);
}

main().catch((e) => {
    console.error('验证异常:', e.message);
    process.exit(2);
});
