#!/usr/bin/env node
/**
 * 透视弹窗「来源图例 + 右侧可折叠多选筛选行 + 逐条定位」真浏览器回归测试。
 *
 * 守的用户可见行为：
 * 1. 原文/程序/AI/手改四项是纯颜色图例（span，不可点选筛选），原文不计数字、
 *    圆点与正文同色，控件不带边框；来源、定位、筛选依次从左到右同一行。
 * 2. 「筛选」带图标且位于最右；点开后在下方新增右对齐的一行（程序/AI/手改），
 *    无分隔线、无边框，可多选、可折叠；点来源图例不再触发筛选。
 * 3. 程序/AI 数字是当前差异改写项数，手改是插件产出后用户连续改动段数；
 *    撤回后归零，重新净化后按新差异重算，筛选只改可见集合不改数字。
 * 4. 说明文字统一浅字 + 行首图标；定位高亮是 2px 单线、无投影、无叠加边框；
 *    手机端「重新净化 / 撤回净化」四字完整可见。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-diff-stats-legend.mjs
 * 失败时退出码 1，并打印逐项期望/实际；截图落在 shots/ 下。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDiffStats } from '../../src/diff/diffStats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'shots');
const PORT = process.env.CDP_PORT ?? '9224';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE = `(() => {
    const modal = document.getElementById('blai-diff-modal');
    const content = document.getElementById('blai-diff-modal-content');
    const toolbar = document.getElementById('blai-diff-toolbar');
    const panel = document.getElementById('blai-diff-filter-panel');
    const seen = new Set();
    const visibleIds = new Set();
    const bySection = { program: 0, ai: 0, other: 0 };
    let groups = 0;
    content?.querySelectorAll('[data-blai-revert-item]').forEach((node) => {
        const id = node.getAttribute('data-blai-revert-item');
        if (!id || seen.has(id)) return;
        seen.add(id);
        groups++;
        const section = node.getAttribute('data-blai-diff-section');
        if (section === 'program' || section === 'ai') bySection[section]++;
        else bySection.other++;
        if (node.offsetParent !== null) visibleIds.add(id);
    });
    const readControl = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        const dot = node.querySelector('i');
        const dotStyle = dot ? getComputedStyle(dot) : null;
        const rect = node.getBoundingClientRect();
        return {
            label: [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(''),
            text: node.textContent.trim(),
            tag: node.tagName.toLowerCase(),
            source: node.getAttribute('data-blai-diff-source'),
            filterSource: node.getAttribute('data-blai-diff-filter-source'),
            count: node.querySelector('strong')?.textContent ?? null,
            visible: node.offsetParent !== null,
            color: style.color,
            dotColor: dotStyle ? dotStyle.backgroundColor : null,
            border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
            background: style.backgroundColor,
            active: node.classList.contains('is-active'),
            pressed: node.getAttribute('aria-pressed'),
            centerY: rect.top + rect.height / 2,
            left: rect.left,
            right: rect.right,
            width: rect.width,
        };
    };
    const sources = [...document.querySelectorAll('#blai-diff-toolbar .blai-diff-source')].map(readControl);
    const toggleNode = document.getElementById('blai-diff-filter-toggle');
    const toggle = readControl(toggleNode);
    const navNode = document.querySelector('#blai-diff-toolbar .blai-diff-nav');
    const navRect = navNode?.getBoundingClientRect();
    const sourcesRect = document.querySelector('.blai-diff-sources')?.getBoundingClientRect();
    const chips = [...document.querySelectorAll('#blai-diff-filter-panel [data-blai-diff-filter-source]')].map(readControl);
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
    const navButtons = [...document.querySelectorAll('#blai-diff-toolbar .blai-diff-nav-btn')].map(readControl);
    const navCenterY = navButtons.length ? (navButtons[0].centerY + navButtons[1].centerY) / 2 : 0;
    const currentNode = content?.querySelector('.blai-diff-nav-current');
    const currentStyle = currentNode ? getComputedStyle(currentNode) : null;
    const notices = [...(content?.querySelectorAll('.blai-diff-empty') || [])].map((node) => {
        const style = getComputedStyle(node);
        const icon = node.querySelector(':scope > i');
        return {
            text: node.textContent.trim().slice(0, 24),
            color: style.color,
            icon: icon?.className || '',
            iconColor: icon ? getComputedStyle(icon).color : '',
            section: node.getAttribute('data-diff-section') || '',
            visible: node.offsetParent !== null,
        };
    });
    const revertTextNode = document.getElementById('blai-diff-revert-text');
    const titleTextNode = document.querySelector('.blai-diff-title-text');
    return {
        modalOpen: !!modal && getComputedStyle(modal).display !== 'none',
        filterEnabled: modal?.getAttribute('data-diff-filter-enabled') || '',
        stats: ['blai-diff-stat-program', 'blai-diff-stat-ai', 'blai-diff-stat-manual']
            .map((id) => document.getElementById(id)?.textContent ?? ''),
        expectedStats: [String(bySection.program), String(bySection.ai), '0'],
        nav: document.getElementById('blai-diff-nav-count')?.textContent ?? '',
        groups,
        visibleGroups: visibleIds.size,
        bySection,
        navCenterY,
        navButtons,
        contentColor: content ? getComputedStyle(content).color : '',
        sources,
        toggle,
        toggleIcon: toggleNode?.querySelector('i')?.className || '',
        toggleExpanded: toggleNode?.getAttribute('aria-expanded') || '',
        order: {
            sourcesRight: sourcesRect?.right || 0,
            navLeft: navRect?.left || 0,
            navRight: navRect?.right || 0,
            toggleLeft: toggle?.left || 0,
        },
        panel: {
            exists: !!panel,
            hidden: panel ? panel.hidden : null,
            visible: !!panel && panel.offsetParent !== null,
            justify: panelStyle?.justifyContent || '',
            border: panelStyle ? [panelStyle.borderTopWidth, panelStyle.borderRightWidth, panelStyle.borderBottomWidth, panelStyle.borderLeftWidth] : [],
            right: panel ? panel.getBoundingClientRect().right : 0,
            chips,
        },
        toolbar: {
            height: toolbar ? toolbar.getBoundingClientRect().height : 0,
            color: toolbarStyle?.color || '',
            borderBottom: toolbarStyle?.borderBottomWidth || '',
        },
        highlight: currentStyle ? {
            outlineWidth: currentStyle.outlineWidth,
            outlineOffset: currentStyle.outlineOffset,
            boxShadow: currentStyle.boxShadow,
            background: currentStyle.backgroundColor,
            outlineVar: currentStyle.getPropertyValue('--blai-border-2'),
            zoom: currentStyle.zoom,
        } : null,
        decorationThickness: (() => {
            const delNode = content?.querySelector('del.blai-diff-change');
            return delNode ? getComputedStyle(delNode).textDecorationThickness : '';
        })(),
        // Chrome 会按设备像素量化 outline-width（DPR≠1 时 2px 可能回读成 1.53846px），
        // 因此用同页 2px 参考值作比较，确认高亮确实走 2px 而不是被改成 1px/3px。
        outlineReference: (() => {
            if (!content) return '';
            const probe = document.createElement('span');
            probe.style.cssText = 'outline: 2px solid red; outline-offset: 0';
            content.appendChild(probe);
            const width = getComputedStyle(probe).outlineWidth;
            probe.remove();
            return width;
        })(),
        notices,
        reverted: (content?.textContent || '').includes('已撤回'),
        comparing: (content?.textContent || '').includes('正在比较文本'),
        revert: {
            text: revertTextNode?.textContent ?? '',
            visible: !!revertTextNode && getComputedStyle(revertTextNode).display !== 'none' && revertTextNode.offsetParent !== null,
            buttonWidth: toggleNode && document.getElementById('blai-diff-revert-toggle')
                ? document.getElementById('blai-diff-revert-toggle').getBoundingClientRect().width : 0,
        },
        title: {
            text: titleTextNode?.textContent ?? '',
            clipped: !!titleTextNode && titleTextNode.scrollWidth > titleTextNode.clientWidth + 1,
        },
    };
})()`;

async function connect() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.url.includes('127.0.0.1:8000'))
        || list.find((target) => target.type === 'page');
    if (!page) throw new Error('没有可用的调试页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    return { ws, send };
}

async function evaluate(send, expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
        throw new Error('页面脚本异常：' + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails));
    }
    return result.result?.value;
}

async function waitFor(send, expression, label, tries = 50) {
    for (let i = 0; i < tries; i++) {
        if (await evaluate(send, expression)) return;
        await sleep(300);
    }
    throw new Error(`等待超时：${label}`);
}

function check(failures, condition, message) {
    if (!condition) failures.push(message);
}

function checkStats(failures, label, snapshot) {
    // 手改数由 diffStats 单测单独守口径；浏览器里只要求与手改提示的有无一致。
    check(failures, snapshot.stats[0] === snapshot.expectedStats[0] && snapshot.stats[1] === snapshot.expectedStats[1],
        `${label}：程序/AI 计数应为 ${snapshot.expectedStats.slice(0, 2).join('/')}，实际 ${snapshot.stats.slice(0, 2).join('/')}`);
    const hasManualNotice = snapshot.notices.some((notice) => notice.section === 'manual');
    check(failures, (Number(snapshot.stats[2]) > 0) === hasManualNotice,
        `${label}：手改计数 ${snapshot.stats[2]} 与手改提示存在与否（${hasManualNotice}）不一致`);
    check(failures, snapshot.bySection.other === 0,
        `${label}：出现未归类的改写项 ${snapshot.bySection.other} 个`);
}

function checkNoBorders(failures, label, controls) {
    controls.filter(Boolean).forEach((control) => {
        check(failures, control.border.every((width) => width === '0px'),
            `${label}「${control.label || control.filterSource || control.source}」仍有边框：${control.border.join('/')}`);
    });
}

function checkSingleLine(failures, label, snapshot, maxHeight) {
    check(failures, snapshot.toolbar.height > 0 && snapshot.toolbar.height <= maxHeight,
        `${label}：工具行高度 ${snapshot.toolbar.height}px，应不超过 ${maxHeight}px`);
    const centers = [
        ...snapshot.sources.map((item) => item.centerY),
        snapshot.navCenterY,
        snapshot.toggle?.centerY || 0,
    ].filter((value) => value > 0);
    check(failures, Math.max(...centers) - Math.min(...centers) <= 8,
        `${label}：来源、定位与筛选不在同一行，中线 ${centers.map(v => v.toFixed(1)).join('/')}`);
    check(failures, snapshot.order.navLeft >= snapshot.order.sourcesRight - 1,
        `${label}：定位应排在来源图例右侧，实际 ${snapshot.order.navLeft} < ${snapshot.order.sourcesRight}`);
    check(failures, snapshot.order.toggleLeft >= snapshot.order.navRight - 1,
        `${label}：筛选开关应排在定位右侧，实际 ${snapshot.order.toggleLeft} < ${snapshot.order.navRight}`);
}

function checkNotices(failures, label, snapshot) {
    snapshot.notices.forEach((notice) => {
        check(failures, notice.color === snapshot.toolbar.color,
            `${label}「${notice.text}」不是浅字：${notice.color}，应为 ${snapshot.toolbar.color}`);
        check(failures, !!notice.icon, `${label}「${notice.text}」开头没有图标`);
        check(failures, !!notice.iconColor && notice.iconColor !== 'rgba(0, 0, 0, 0)',
            `${label}「${notice.text}」行首图标未着色`);
    });
}

async function capture(send, name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const target = path.join(SHOTS, name);
    fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
    return path.relative(ROOT, target).replace(/\\/g, '/');
}

function unitCheckManualCount(failures) {
    const emptyEl = { querySelectorAll: () => [] };
    const makeMsg = (mes, programMes, reverted = false) => ({
        mes,
        __blai_diff_branch_meta: {
            main: { originalMes: programMes, aiMes: null, programMes, reverted },
        },
    });
    const cases = [
        ['无手改', makeMsg('ABCDEFGH', 'ABCDEFGH'), 0],
        ['一处连续手改', makeMsg('AXCDEFGH', 'ABCDEFGH'), 1],
        ['两处分离手改', makeMsg('AXCDEYGH', 'ABCDEFGH'), 2],
        ['撤回态不计手改', makeMsg('AXCDEYGH', 'ABCDEFGH', true), 0],
    ];
    for (const [name, msg, expected] of cases) {
        const actual = collectDiffStats(msg, emptyEl).manual;
        check(failures, actual === expected, `手改计数单测「${name}」应为 ${expected}，实际 ${actual}`);
    }
}

async function main() {
    const failures = [];
    unitCheckManualCount(failures);

    const { ws, send } = await connect();
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__verifyStatsErrors = [];
            addEventListener('error', e => window.__verifyStatsErrors.push(String(e.message)));
            addEventListener('unhandledrejection', e => window.__verifyStatsErrors.push(String(e.reason)));`,
    });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.reload', { ignoreCache: true });

    await waitFor(send, `(() => {
        const b = document.querySelector('.blai-diff-btn-bottom');
        const modal = document.getElementById('blai-diff-modal');
        return document.readyState === 'complete' && !!b && !!modal && b.offsetParent !== null;
    })()`, '页面就绪且存在透视入口与弹窗节点');

    // 先确保弹窗真的打开、事件已绑定；上一轮可能把消息留在撤回态，需先重新净化。
    await waitFor(send, `(() => {
        const modal = document.getElementById('blai-diff-modal');
        if (modal && getComputedStyle(modal).display === 'none') document.querySelector('.blai-diff-btn-bottom')?.click();
        const s = ${PROBE};
        return s.modalOpen && !s.comparing;
    })()`, '透视弹窗打开并完成渲染', 120);
    const preflight = await evaluate(send, PROBE);
    if (preflight.reverted) {
        await evaluate(send, `(() => { document.getElementById('blai-diff-revert-toggle')?.click(); return true; })()`);
        await waitFor(send, `(() => { const s = ${PROBE}; return !s.reverted && !s.comparing && s.groups > 0; })()`, '预置重新净化', 80);
    }

    await waitFor(send, `(() => {
        const modal = document.getElementById('blai-diff-modal');
        if (modal && getComputedStyle(modal).display === 'none') document.querySelector('.blai-diff-btn-bottom')?.click();
        const s = ${PROBE};
        return s.modalOpen && !s.comparing && s.groups > 0;
    })()`, '透视弹窗渲染出改写项', 120);

    const initial = await evaluate(send, PROBE);
    checkStats(failures, '初始', initial);
    check(failures, initial.nav.endsWith(` / ${initial.groups}`), `初始定位计数应为 / ${initial.groups}，实际 ${initial.nav}`);
    check(failures, initial.sources.length === 4, `来源项应为 4 项，实际 ${initial.sources.length}`);
    const expectedSources = [
        { label: '原文', count: null },
        { label: '程序', count: String(initial.bySection.program) },
        { label: 'AI', count: String(initial.bySection.ai) },
        { label: '手改', count: initial.stats[2] },
    ];
    expectedSources.forEach((expected, i) => {
        const item = initial.sources[i];
        check(failures, item?.label === expected.label, `第 ${i + 1} 项应为「${expected.label}」，实际「${item?.label}」`);
        check(failures, item?.tag === 'span', `来源「${expected.label}」应是纯展示 span，实际 ${item?.tag}`);
        check(failures, item?.visible === true, `来源「${expected.label}」不可见`);
        check(failures, item?.count === expected.count, `来源「${expected.label}」计数应为 ${expected.count}，实际 ${item?.count}`);
        check(failures, !!item?.dotColor && item.dotColor !== 'rgba(0, 0, 0, 0)', `来源「${expected.label}」色点未着色`);
    });
    const original = initial.sources[0];
    check(failures, original?.color === initial.contentColor && original?.dotColor === initial.contentColor,
        `原文应沿用正文色 ${initial.contentColor}，实际文字 ${original?.color} / 色点 ${original?.dotColor}`);
    check(failures, new Set(initial.sources.map((item) => item.dotColor)).size === 4, '四种来源色点未使用四个不同颜色');
    checkNoBorders(failures, '初始', [...initial.sources, initial.toggle, ...initial.navButtons]);
    checkSingleLine(failures, '桌面', initial, 60);
    check(failures, initial.toggleIcon.includes('fa-filter'), `筛选开关缺少图标：${initial.toggleIcon}`);
    check(failures, initial.filterEnabled === 'false' && initial.toggle?.active === false, '筛选开关初始应为关闭');
    check(failures, initial.panel.exists && initial.panel.hidden === true, '筛选行初始应收起');
    check(failures, initial.toolbar.borderBottom === '0px', `工具行下方不应有分隔线，实际 ${initial.toolbar.borderBottom}`);
    checkNotices(failures, '初始', initial);
    const manualNotice = initial.notices.find((notice) => notice.section === 'manual');
    if (manualNotice) check(failures, manualNotice.visible, '手改提示不应被默认隐藏');

    // 点来源图例不再触发筛选。
    await evaluate(send, `(() => { document.querySelector('[data-blai-diff-source="program"]')?.click(); return true; })()`);
    const legendClick = await evaluate(send, PROBE);
    check(failures, legendClick.filterEnabled === 'false' && legendClick.visibleGroups === legendClick.groups,
        '点来源图例不应触发筛选');

    // 开关展开右侧筛选行：右对齐、无边框、三项可多选。
    await evaluate(send, `(() => { document.getElementById('blai-diff-filter-toggle')?.click(); return true; })()`);
    const enabled = await evaluate(send, PROBE);
    check(failures, enabled.filterEnabled === 'true' && enabled.toggle?.active === true && enabled.toggleExpanded === 'true',
        '筛选开关展开后未高亮或未标记展开');
    check(failures, enabled.panel.visible === true, '点筛选后没有展开新的一行');
    check(failures, ['flex-end', 'flow-end'].includes(enabled.panel.justify), `筛选行应右对齐，实际 ${enabled.panel.justify}`);
    check(failures, enabled.panel.border.every((width) => width === '0px'), `筛选行不应有边框：${enabled.panel.border.join('/')}`);
    check(failures, enabled.toolbar.borderBottom === '0px', '筛选展开后工具行下方出现分隔线');
    check(failures, enabled.panel.chips.length === 3, `筛选项应为程序/AI/手改三项，实际 ${enabled.panel.chips.length}`);
    check(failures, enabled.panel.chips.map((chip) => chip.label).join('/') === '程序/AI/手改',
        `筛选项应为程序/AI/手改，实际 ${enabled.panel.chips.map((chip) => chip.label).join('/')}`);
    checkNoBorders(failures, '筛选行', enabled.panel.chips);
    const rightmostChip = Math.max(...enabled.panel.chips.map((chip) => chip.right));
    check(failures, Math.abs(rightmostChip - enabled.panel.right) <= 40,
        `筛选项没有贴着筛选行右侧：panel.right=${enabled.panel.right}，chip.right=${rightmostChip}`);
    checkStats(failures, '展开筛选行', enabled);
    const filterShot = await capture(send, 'verify-diff-stats-legend-filter.png');

    const chipClick = (source) => `(() => { document.querySelector('[data-blai-diff-filter-source="${source}"]')?.click(); return true; })()`;
    await evaluate(send, chipClick('program'));
    const onlyProgram = await evaluate(send, PROBE);
    check(failures, onlyProgram.panel.chips[0]?.active === true, '程序筛选项选中后未高亮');
    check(failures, onlyProgram.visibleGroups === onlyProgram.bySection.program,
        `只选程序时应只剩 ${onlyProgram.bySection.program} 项，实际 ${onlyProgram.visibleGroups}`);
    check(failures, onlyProgram.nav.endsWith(` / ${onlyProgram.bySection.program}`), '筛选后定位总数没有按可见项更新');
    checkStats(failures, '只选程序', onlyProgram);
    if (manualNotice) {
        const hiddenManual = onlyProgram.notices.find((notice) => notice.section === 'manual');
        check(failures, hiddenManual && !hiddenManual.visible, '未选手改时手改提示应被隐藏');
    }

    await evaluate(send, chipClick('ai'));
    const both = await evaluate(send, PROBE);
    check(failures, both.panel.chips[0]?.active === true && both.panel.chips[1]?.active === true,
        '程序与 AI 应可同时选中');
    check(failures, both.visibleGroups === both.groups, `多选程序+AI 应显示全部 ${both.groups} 项，实际 ${both.visibleGroups}`);
    checkStats(failures, '多选程序+AI', both);

    await evaluate(send, chipClick('program'));
    const onlyAi = await evaluate(send, PROBE);
    check(failures, onlyAi.visibleGroups === onlyAi.bySection.ai,
        `取消程序后应只剩 ${onlyAi.bySection.ai} 项，实际 ${onlyAi.visibleGroups}`);
    check(failures, onlyAi.panel.chips[0]?.active === false && onlyAi.panel.chips[1]?.active === true,
        '取消一项不应影响另一项的选中态');

    await evaluate(send, chipClick('ai'));
    const noneSelected = await evaluate(send, PROBE);
    check(failures, noneSelected.visibleGroups === noneSelected.groups, '全部取消后应恢复显示全部');
    checkStats(failures, '全部取消', noneSelected);

    // 定位高亮：与删除线同粗的 2px 单线，无投影、无叠加边框。
    await evaluate(send, `(() => { document.getElementById('blai-diff-nav-next')?.click(); return true; })()`);
    const navigated = await evaluate(send, PROBE);
    check(failures, !!navigated.highlight, '点击定位后没有高亮当前项');
    check(failures, navigated.highlight?.outlineWidth === navigated.outlineReference
        && navigated.highlight?.outlineVar === '2px' && navigated.decorationThickness === '2px',
        `定位高亮应与删除线同为 2px（参考 ${navigated.outlineReference}），实际 ${navigated.highlight?.outlineWidth} / 令牌 ${navigated.highlight?.outlineVar} / 删除线 ${navigated.decorationThickness}`);
    check(failures, navigated.highlight?.outlineOffset === '0px', `定位高亮不应留第二层偏移，实际 ${navigated.highlight?.outlineOffset}`);
    check(failures, navigated.highlight?.boxShadow === 'none', `定位高亮不应有投影，实际 ${navigated.highlight?.boxShadow}`);

    // 折叠筛选行：选择清空、所有来源恢复可见。
    await evaluate(send, chipClick('program'));
    await evaluate(send, `(() => { document.getElementById('blai-diff-filter-toggle')?.click(); return true; })()`);
    const collapsed = await evaluate(send, PROBE);
    check(failures, collapsed.filterEnabled === 'false' && collapsed.panel.hidden === true, '再点筛选应折叠筛选行');
    check(failures, collapsed.panel.chips.every((chip) => chip.active === false), '折叠筛选行后选中态未清空');
    check(failures, collapsed.visibleGroups === collapsed.groups, '折叠筛选行后应恢复显示全部');

    // 撤回后没有改写项：数字与定位一起归零。
    await evaluate(send, `(() => { document.getElementById('blai-diff-revert-toggle')?.click(); return true; })()`);
    await waitFor(send, `(() => { const s = ${PROBE}; return s.reverted && !s.comparing; })()`, '撤回状态生效');
    const reverted = await evaluate(send, PROBE);
    checkStats(failures, '撤回后', reverted);
    check(failures, reverted.stats.every((value) => value === '0'), `撤回后应全部归零，实际 ${reverted.stats.join('/')}`);
    check(failures, reverted.nav === '0 / 0', `撤回后定位应为 0 / 0，实际 ${reverted.nav}`);
    check(failures, reverted.sources.length === 4 && reverted.sources.every((item) => item.visible), '撤回后来源图例消失');
    check(failures, reverted.revert.text === '重新净化', `撤回后按钮文案应为「重新净化」，实际「${reverted.revert.text}」`);
    check(failures, reverted.notices.length > 0, '撤回状态应有说明文字');
    checkNotices(failures, '撤回后', reverted);

    // 重新净化后按新差异重算，不沿用撤回前的累计值。
    await evaluate(send, `(() => { document.getElementById('blai-diff-revert-toggle')?.click(); return true; })()`);
    await waitFor(send, `(() => {
        const s = ${PROBE};
        return !s.reverted && !s.comparing && s.groups > 0;
    })()`, '重新净化后差异重建', 80);
    const recleaned = await evaluate(send, PROBE);
    checkStats(failures, '重新净化后', recleaned);
    check(failures, recleaned.groups > 0, '重新净化后没有差异项');
    check(failures, recleaned.nav.endsWith(` / ${recleaned.groups}`), `重新净化后定位计数应为 / ${recleaned.groups}，实际 ${recleaned.nav}`);
    check(failures, recleaned.revert.text === '撤回净化', `重新净化后按钮文案应为「撤回净化」，实际「${recleaned.revert.text}」`);
    checkNoBorders(failures, '重新净化后', [...recleaned.sources, recleaned.toggle, ...recleaned.navButtons]);

    const desktopShot = await capture(send, 'verify-diff-stats-legend-desktop.png');

    // 手机断点：四字文案完整可见、标题不被截断，工具行仍单行。
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const mobile = await evaluate(send, PROBE);
    checkStats(failures, '手机视口', mobile);
    check(failures, mobile.sources.length === 4 && mobile.sources.every((item) => item.visible), '手机端来源项有被隐藏');
    checkNoBorders(failures, '手机视口', [...mobile.sources, mobile.toggle, ...mobile.navButtons]);
    checkSingleLine(failures, '手机', mobile, 64);
    check(failures, mobile.revert.visible && mobile.revert.text === '撤回净化',
        `手机端应完整显示「撤回净化」，实际 visible=${mobile.revert.visible} text=${mobile.revert.text}`);
    check(failures, mobile.revert.buttonWidth >= 80, `手机端撤回净化按钮宽度不足，实际 ${mobile.revert.buttonWidth}px`);
    check(failures, !mobile.title.clipped, `手机端标题被截断：${mobile.title.text}`);
    checkNotices(failures, '手机视口', mobile);

    // 手机端撤回态同样保留四字。
    await evaluate(send, `(() => { document.getElementById('blai-diff-revert-toggle')?.click(); return true; })()`);
    await waitFor(send, `(() => { const s = ${PROBE}; return s.reverted && !s.comparing; })()`, '手机端撤回状态生效');
    const mobileReverted = await evaluate(send, PROBE);
    check(failures, mobileReverted.revert.visible && mobileReverted.revert.text === '重新净化',
        `手机端撤回态应完整显示「重新净化」，实际 visible=${mobileReverted.revert.visible} text=${mobileReverted.revert.text}`);
    check(failures, !mobileReverted.title.clipped, '手机端撤回态标题被截断');
    const mobileShot = await capture(send, 'verify-diff-stats-legend-mobile.png');

    const errors = await evaluate(send, `(window.__verifyStatsErrors || []).slice()`);
    check(failures, errors.length === 0, `页面脚本错误：${JSON.stringify(errors)}`);

    await evaluate(send, `(() => { document.getElementById('blai-diff-modal-close')?.click(); return true; })()`);
    await send('Emulation.clearDeviceMetricsOverride');
    ws.close();

    console.log(JSON.stringify({
        labels: initial.sources.map((item) => item.label),
        counts: initial.stats,
        reverted: reverted.stats,
        recleaned: recleaned.stats,
        mobileRevertText: mobileReverted.revert.text,
        highlight: navigated.highlight,
        decorationThickness: navigated.decorationThickness,
        filter: {
            chips: enabled.panel.chips.map((chip) => chip.label),
            onlyProgram: onlyProgram.visibleGroups,
            both: both.visibleGroups,
            collapsed: collapsed.visibleGroups,
        },
        screenshots: [desktopShot, filterShot, mobileShot],
        failures,
    }, null, 2));
    if (failures.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
