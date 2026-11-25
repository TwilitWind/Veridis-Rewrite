#!/usr/bin/env node
/**
 * 显式重新净化的基线规则：没有手改时只刷新 programMes、保留 originalMes；
 * 当前正文被手改过时，以手改后的正文建立本次对比基线。
 * 同时校验未命中时的提示不再报「成功」。
 *
 * 用法：CDP_PORT=9224 node test/audit/verify-recleanse-baseline.mjs
 * 只在页面内存里改一条消息，结束前还原并 reload，不写用户聊天数据。
 */
import { connect, evaluate, ensurePageFresh } from './_harness.mjs';
import {
    snapshotProgramRules, installAuditRewriteRule, restoreProgramRules,
} from './_diff-fixture.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const { ws, send } = await connect();
let rulesSnapshot = null;
try {
    await ensurePageFresh(send, `!!document.getElementById('blai-purifier-popup')`, '插件就绪');
    // 真实聊天可能没有启用任何预设；自带一条确定性规则，否则「刷新 programMes」永远不成立。
    rulesSnapshot = await snapshotProgramRules(send);
    if (!await installAuditRewriteRule(send, { target: '极其嗤笑', replacement: '极其大笑' })) {
        throw new Error('临时规则安装失败');
    }
    await sleep(1200);
    const snap = await evaluate(send, `(async () => {
        const base = '/scripts/extensions/third-party/Veridis-Rewrite/src/';
        const ctx = await import(base + 'host/appContext.js');
        const meta = await import(base + 'diff/messageMeta.js');
        const cleanse = await import(base + 'chat/cleanse.js');
        const engine = await import(base + 'rules/engine.js');
        const replace = await import(base + 'rules/engine/engine-01-replace.js');
        const feedback = await import(base + 'diff/recleanseFeedback.js');
        const { chat } = ctx.getAppContext();
        engine.buildProcessors();
        let idx = chat.findIndex(m => m && m.is_user !== true && typeof m.mes === 'string');
        let tempAdded = false;
        if (idx < 0) {
            chat.push({ is_user: false, mes: '', name: 'veridis-baseline-probe' });
            idx = chat.length - 1;
            tempAdded = true;
        }
        const msg = chat[idx];
        const savedMes = String(msg.mes || '');
        const savedMetaRaw = msg.__blai_diff_branch_meta
            ? JSON.parse(JSON.stringify(msg.__blai_diff_branch_meta)) : null;
        const branchKey = msg.swipes ? 'swipe:' + Number(msg.swipe_id || 0) : 'main';
        const original = '<content>极其嗤笑</content>';
        const expected = replace.applyScopedReplacements(original);
        const baselineProgram = '<content>原本的净化结果</content>';
        try {
            // 造一条规范元数据，模拟「原文 → 程序改写 → 撤回」后的状态。
            msg.__blai_diff_branch_meta = {};
            meta.writeMessageDiffProgram(msg, branchKey, original, baselineProgram);
            msg.mes = original;
            cleanse.cleanseMessageDataAtIndex(idx, { diffSourceMes: original, explicitRecleanse: true });
            const after = meta.getMessageDiffMeta(msg);
            const firstProgram = String(msg.mes || '');
            feedback.showRecleanseFeedback(false);
            const toast = [...document.querySelectorAll('.blai-toast-text')].map(e => e.textContent).slice(-1)[0] || null;
            document.querySelectorAll('.blai-toast').forEach(e => e.remove());

            // 场景 2：当前正文被手改过时，本次重新净化要把它作为对比基线。
            const manual = '<content>整个人的极其嗤笑</content>';
            msg.__blai_diff_branch_meta = {};
            meta.writeMessageDiffProgram(msg, branchKey, original, baselineProgram);
            msg.mes = manual;
            cleanse.cleanseMessageDataAtIndex(idx, { diffSourceMes: manual, explicitRecleanse: true });
            const afterManual = meta.getMessageDiffMeta(msg);
            const manualExpected = replace.applyScopedReplacements(manual);

            return {
                original, baselineProgram, expected,
                originalUnchanged: after?.originalMes === original,
                programUpdated: after?.programMes === firstProgram,
                programHasRules: expected !== original,
                revertedCleared: after?.reverted === false,
                toast,
                manual,
                manualExpected,
                manualOriginalRebased: afterManual?.originalMes === manual,
                manualProgramUpdated: afterManual?.programMes === msg.mes,
                manualRulesApplied: manualExpected !== manual && !String(msg.mes).includes('极其嗤笑'),
                manualDiffVisible: afterManual?.originalMes !== afterManual?.programMes,
            };
        } finally {
            msg.mes = savedMes;
            if (savedMetaRaw === null) delete msg.__blai_diff_branch_meta;
            else msg.__blai_diff_branch_meta = savedMetaRaw;
            if (tempAdded) chat.splice(idx, 1);
        }
    })()`);

    if (snap.error) check('前置条件：有差异元数据', false, snap.error);
    else {
        check('显式重新净化保留原文基线', snap.originalUnchanged, `original ${snap.original.length} 字未变`);
        check('显式重新净化刷新 programMes', snap.programUpdated && snap.programHasRules);
        check('显式重新净化解除撤回态', snap.revertedCleared);
        check('未命中时提示「没有程序规则命中」', String(snap.toast).includes('没有程序规则命中'), String(snap.toast));
        check('手改后正文成为本次原文基线', snap.manualOriginalRebased && snap.manualProgramUpdated);
        check('手改基线能显示本次差异', snap.manualRulesApplied && snap.manualDiffVisible,
            `manual=${snap.manual} expected=${snap.manualExpected}`);
    }
    // 临时规则只在内存里，reload 自然丢弃；finally 再显式恢复并落盘，防异常路径残留。
    await send('Page.reload', { ignoreCache: false });
    await sleep(1200);
} finally {
    if (rulesSnapshot !== null) await restoreProgramRules(send, rulesSnapshot).catch(() => {});
    ws.close();
}

const failed = results.filter(r => !r.ok).length;
if (failed) process.exit(1);
console.log(`\n全部通过：${results.length}/${results.length} 项。`);
