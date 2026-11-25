/**
 * 透视弹窗的手改差异必须可见，且按「连续块」计数。
 * 单块手改显示 1 段、计数 1；两块不连续手改显示 2 段、计数 2；
 * 手改节点不能带撤回 ID，避免被「撤回所选」误选。
 */
import { connect, evaluate, waitFor, ensurePageFresh, capture } from './_harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const openModal = async (send) => {
    await evaluate(send, `(() => {
        const modal = document.getElementById('blai-diff-modal');
        if (modal && getComputedStyle(modal).display !== 'none') return;
        document.querySelector('.blai-diff-btn[data-index="0"]')?.click();
    })()`);
    await waitFor(send, `getComputedStyle(document.getElementById('blai-diff-modal')).display !== 'none'`, '透视弹窗打开');
    await sleep(900);
};

const closeModal = async (send) => {
    await evaluate(send, `document.getElementById('blai-diff-modal-close')?.click()`);
    await waitFor(send, `getComputedStyle(document.getElementById('blai-diff-modal')).display === 'none'`, '透视弹窗关闭');
};

const setup = async (send, program, current) => evaluate(send, `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
    const ctx = await import(base + 'host/appContext.js');
    const meta = await import(base + 'diff/messageMeta.js');
    const branch = await import(base + 'chat/messageBranch.js');
    const view = await import(base + 'diff/view.js');
    const presets = await import(base + 'presets/application.js');
    const app = ctx.getAppContext();
    presets.applyPresetByName('通用规则集1.5', { skipRender: true });
    app.extension_settings.ultimate_purifier_ai_rewrite.aiRewrite.enabled = false;
    const msg = app.chat[0];
    const branchKey = branch.getMessageDiffBranchKey(msg);
    msg.__blai_diff_branch_meta = {};
    meta.writeMessageDiffProgram(msg, branchKey, ${JSON.stringify(program)}, ${JSON.stringify(program)});
    const written = branch.commitCurrentMessageText(msg, ${JSON.stringify(current)});
    view.injectDiffButtons([0]);
    return { written, branchKey, mes: msg.mes };
})()`);

const snapModal = async (send) => evaluate(send, `(() => ({
    manualStat: document.getElementById('blai-diff-stat-manual')?.textContent || '',
    manualNodes: [...document.querySelectorAll('#blai-diff-modal-content [data-blai-diff-section="manual"].blai-diff-change')]
        .map(e => ({ tag: e.tagName, type: e.getAttribute('data-blai-diff-type'), text: e.textContent })),
    revertIdsOnManual: document.querySelectorAll('#blai-diff-modal-content [data-blai-diff-section="manual"][data-blai-revert-item]').length,
}))()`);

// 快照放在 Node 侧：页面重渲染不会冲掉它。脚本会应用预设，必须同时恢复规则和消息。
const snapshotHostState = (send) => evaluate(send, `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
    const ctx = await import(base + 'host/appContext.js');
    const app = ctx.getAppContext();
    const msg = app.chat[0];
    const settings = app.extension_settings.ultimate_purifier_ai_rewrite;
    return {
        mes: String(msg.mes || ''),
        meta: msg.__blai_diff_branch_meta ? JSON.parse(JSON.stringify(msg.__blai_diff_branch_meta)) : null,
        activePreset: settings.activePreset,
        rules: JSON.parse(JSON.stringify(settings.rules || [])),
        aiEnabled: settings.aiRewrite?.enabled,
    };
})()`);

const restoreHostState = (send, snap) => evaluate(send, `(async () => {
    const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
    const ctx = await import(base + 'host/appContext.js');
    const branch = await import(base + 'chat/messageBranch.js');
    const view = await import(base + 'diff/view.js');
    const st = await import('/script.js');
    const app = ctx.getAppContext();
    const msg = app.chat[0];
    if (!msg) return false;
    branch.commitCurrentMessageText(msg, ${JSON.stringify(snap.mes)});
    const meta = ${JSON.stringify(snap.meta)};
    if (meta === null) delete msg.__blai_diff_branch_meta;
    else msg.__blai_diff_branch_meta = meta;
    const settings = app.extension_settings.ultimate_purifier_ai_rewrite;
    settings.activePreset = ${JSON.stringify(snap.activePreset)};
    settings.rules = ${JSON.stringify(snap.rules)};
    if (settings.aiRewrite) settings.aiRewrite.enabled = ${JSON.stringify(snap.aiEnabled)};
    view.injectDiffButtons([0]);
    delete window.__r91Saved;
    await st.saveSettings();
    return true;
})()`);

const { ws, send } = await connect();
let saved = null;
try {
    await ensurePageFresh(send, `!!document.getElementById('blai-diff-rewrite-info')`, '插件就绪');
    saved = await snapshotHostState(send);
    await sleep(2000);
    await closeModal(send);

    const one = await setup(send, '<content>甲乙丙丁</content>', '<content>甲X乙丙丁</content>');
    check('单块手改基线写入', one.written?.ok === true, JSON.stringify(one));
    await openModal(send);
    const single = await snapModal(send);
    check('单块手改：计数 1 且正文显示 1 段',
        single.manualStat === '1' && single.manualNodes.length === 1 && single.manualNodes[0].text.includes('X'),
        JSON.stringify(single));
    check('手改段不进入撤回所选', single.revertIdsOnManual === 0, `ids=${single.revertIdsOnManual}`);
    await closeModal(send);

    const two = await setup(send, '<content>甲丙戊</content>', '<content>甲X丙Y戊</content>');
    check('两块手改基线写入', two.written?.ok === true, JSON.stringify(two));
    await openModal(send);
    const dual = await snapModal(send);
    check('两块手改：计数 2 且正文分别显示',
        dual.manualStat === '2'
            && dual.manualNodes.length === 2
            && dual.manualNodes.some(n => n.text.includes('X'))
            && dual.manualNodes.some(n => n.text.includes('Y')),
        JSON.stringify(dual));
    check('两块手改同样不进入撤回所选', dual.revertIdsOnManual === 0, `ids=${dual.revertIdsOnManual}`);

    // commitCurrentMessageText 会触发异步重渲染，可能把刚打开的弹窗又收起；
    // 截图前等它稳定，并在确实被收起时重开，不靠固定 sleep 猜。
    await waitFor(send, `(() => {
        const modal = document.getElementById('blai-diff-modal');
        if (!modal || getComputedStyle(modal).display === 'none') {
            document.querySelector('.blai-diff-btn[data-index="0"]')?.click();
            return false;
        }
        return (document.getElementById('blai-diff-modal-content')?.children.length || 0) > 0;
    })()`, '截图前弹窗稳定渲染', 20, 300);
    await sleep(400);
    const shot = await capture(send, 'verify-manual-diff.png', {
        expectOpen: ['#blai-diff-modal'],
        expectContent: '#blai-diff-modal-content > *:1',
    });
    console.log('SHOT  ' + shot);

    await closeModal(send);
} finally {
    if (saved) await restoreHostState(send, saved).catch(() => {});
    ws.close();
}

const failed = results.filter(r => !r.ok).length;
if (failed) {
    console.error(`\n失败：${failed}/${results.length} 项`);
    process.exit(1);
}
console.log(`\n全部通过：${results.length}/${results.length} 项。`);
