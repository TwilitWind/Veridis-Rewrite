#!/usr/bin/env node
/**
 * 透视弹窗「来源图例 + 右侧可折叠多选筛选行 + 逐条定位」9224 端口浏览器回归测试。
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
import {
    connect, evaluate, waitFor, ensurePageFresh, capture as captureEvidence,
    snapshotAiSettings, normalizeAiSettings, restoreAiSettings,
} from './_harness.mjs';
import {
    OPEN_DIFF_MODAL, seedDiffMessage, snapshotDiffMessage, restoreDiffMessage,
    snapshotProgramRules, installAuditRewriteRule, restoreProgramRules, programRewriteText, IPHONE_UA,
} from './_diff-fixture.mjs';
import { checkManualCount } from './_diff-stats-unit.mjs';
import { PROBE } from './_diff-stats-probe.mjs';
import { check, checkStats, checkNoBorders, checkSingleLine, checkNotices } from './_diff-stats-checks.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const capture = (send, name) => captureEvidence(send, name, { expectOpen: ['#blai-diff-modal-content'] });

// 临时规则 + 内存种子：真实聊天可能没有启用任何预设，必须自带一条可重现的规则。
// program 由真实引擎算出，撤回后「重新净化」会得到同一个结果，差异才能重建成。
const SEED = {
    original: '<content>极其嗤笑</content>',
    target: '极其嗤笑',
    replacement: '极其大笑',
};

async function main() {
    const failures = [];
    checkManualCount(failures);

    const { ws, send } = await connect();
    let aiBaseline = null;
    let rulesSnapshot = null;
    let msgSnapshot = null;
    let report = null;
    try {
        // 消息虽然自己在内存里种子，但「重新净化」要读前序脚本没改过的宿主状态；
        // 全量连跑时 typography/regex-caret 会留下弹窗与设置痕迹，所以这里必须干净重载。
        await ensurePageFresh(send, `!!document.getElementById('blai-diff-modal') && !!document.querySelector('.blai-diff-btn-bottom')`, '页面就绪', 120, { cleanState: true });
        aiBaseline = await snapshotAiSettings(send);
        await normalizeAiSettings(send);
        rulesSnapshot = await snapshotProgramRules(send);
        if (!await installAuditRewriteRule(send, SEED)) throw new Error('临时规则安装失败');
        const program = await programRewriteText(send, SEED.original);
        if (!program || program === SEED.original) throw new Error(`临时规则没有命中：${JSON.stringify(program)}`);
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await evaluate(send, `(() => { document.getElementById('blai-diff-modal-close')?.click(); return true; })()`);
        msgSnapshot = await snapshotDiffMessage(send);
        if (!msgSnapshot) throw new Error('没有可用于内存种子的助手消息');
        const seeded = await seedDiffMessage(send, { original: SEED.original, program });
        if (!seeded.ok) throw new Error(`种子失败：${seeded.error}`);
        // commitCurrentMessageText 会触发消息列表异步重渲染；等它稳定后再开弹窗。
        await sleep(1500);
        await waitFor(send, OPEN_DIFF_MODAL, '透视弹窗打开', 60, 300);
        await waitFor(send, `(() => {
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
    // 顶栏/工具行分隔线与左右对齐由 verify-diff-typography 守，这里只守计数、筛选与定位。
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
    check(failures, [0, 1, 3].every((i) => enabled.panel.border[i] === '0px')
        && Math.abs(parseFloat(enabled.panel.borderBottom) - enabled.ref1px) < 0.02,
        `筛选展开后线应只在面板下方：${enabled.panel.border.join('/')} / 参考 ${enabled.ref1px}px`);
    check(failures, enabled.toolbar.borderBottom === '0px', '筛选展开后工具行下方不应再有分隔线');
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
    check(failures, Math.abs(parseFloat(collapsed.toolbar.borderBottom) - collapsed.ref1px) < 0.02,
        `筛选折叠后分隔线应回到工具行下方，实际 ${collapsed.toolbar.borderBottom}`);
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
    // 用真机 UA + mobile:true；只缩到 390 不算手机，会漏掉宿主按 UA 分支的布局。
    await send('Network.setUserAgentOverride', {
        userAgent: IPHONE_UA, acceptLanguage: 'zh-CN,zh;q=0.9', platform: 'iPhone',
    });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);
    const mobile = await evaluate(send, PROBE);
    checkStats(failures, '手机视口', mobile);
    check(failures, mobile.sources.length === 4 && mobile.sources.every((item) => item.visible), '手机端来源项有被隐藏');
    checkNoBorders(failures, '手机视口', [...mobile.sources, mobile.toggle, ...mobile.navButtons]);
    checkSingleLine(failures, '手机', mobile, 64);
    check(failures, mobile.revert.visible && mobile.revert.text === '撤回净化',
        `手机端应完整显示「撤回净化」，实际 visible=${mobile.revert.visible} text=${mobile.revert.text}`);
    check(failures, mobile.revert.buttonWidth >= 80, `手机端撤回净化按钮宽度不足，实际 ${mobile.revert.buttonWidth}px`);
    check(failures, mobile.title.text === '净化对比' && !mobile.title.clipped, `手机端标题被截断：${mobile.title.text}`);
    checkNotices(failures, '手机视口', mobile);

    // 手机端撤回态同样保留四字。
    await evaluate(send, `(() => { document.getElementById('blai-diff-revert-toggle')?.click(); return true; })()`);
    await waitFor(send, `(() => { const s = ${PROBE}; return s.reverted && !s.comparing; })()`, '手机端撤回状态生效');
    const mobileReverted = await evaluate(send, PROBE);
    check(failures, mobileReverted.revert.visible && mobileReverted.revert.text === '重新净化',
        `手机端撤回态应完整显示「重新净化」，实际 visible=${mobileReverted.revert.visible} text=${mobileReverted.revert.text}`);
    check(failures, !mobileReverted.title.clipped, '手机端撤回态标题被截断');
    const mobileShot = await capture(send, 'verify-diff-stats-legend-mobile.png');

    const errors = await evaluate(send, `(window.__stProbeErrors || []).slice()`);
    check(failures, errors.length === 0, `页面脚本错误：${JSON.stringify(errors)}`);

    await evaluate(send, `(() => { document.getElementById('blai-diff-modal-close')?.click(); return true; })()`);
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Network.setUserAgentOverride', { userAgent: '' }).catch(() => {});
    report = {
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
    };
    } finally {
        if (rulesSnapshot !== null) await restoreProgramRules(send, rulesSnapshot).catch(() => {});
        if (aiBaseline) {
            await restoreAiSettings(send, aiBaseline);
            const actualAi = await snapshotAiSettings(send);
            check(failures, JSON.stringify(actualAi) === JSON.stringify(aiBaseline),
                `审计后 AI 设置对象已恢复：${JSON.stringify(actualAi)} / ${JSON.stringify(aiBaseline)}`);
        }
        if (msgSnapshot) {
            await restoreDiffMessage(send, msgSnapshot).catch(() => {});
        }
        if (report) report.failures = failures;
        await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        ws.close();
    }

    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
