// diff 弹窗回归脚本共用的内存种子 / 还原 / 保存工具。
// 只在页面内存里改消息，绝不调用 saveChat() 写用户聊天数据。
import { evaluate } from './_harness.mjs';

// 通用工具只在 harness 留一份，这里重导出以兼容已有 import 路径。
export { IPHONE_UA, forceSaveSettings } from './_harness.mjs';

const MODULE_BASE = '/scripts/extensions/third-party/Veridis-Rewrite/src/';

// 快照放在 Node 侧，避免 reload 或页面重渲染把 window 上的临时状态冲掉。
export function snapshotDiffMessage(send, index = 0) {
    return evaluate(send, `(async () => {
        const app = await import('${MODULE_BASE}host/appContext.js');
        const msg = app.getAppContext().chat[${index}];
        if (!msg) return null;
        return {
            mes: String(msg.mes ?? ''),
            meta: msg.__blai_diff_branch_meta
                ? JSON.parse(JSON.stringify(msg.__blai_diff_branch_meta))
                : null,
        };
    })()`);
}

export function restoreDiffMessage(send, snapshot, index = 0) {
    if (!snapshot) return Promise.resolve(false);
    return evaluate(send, `(async () => {
        const base = '${MODULE_BASE}';
        const app = await import(base + 'host/appContext.js');
        const view = await import(base + 'diff/view.js');
        const msg = app.getAppContext().chat[${index}];
        if (!msg) return false;
        msg.mes = ${JSON.stringify(snapshot.mes)};
        const meta = ${JSON.stringify(snapshot.meta)};
        if (meta === null) delete msg.__blai_diff_branch_meta;
        else msg.__blai_diff_branch_meta = meta;
        view.injectDiffButtons([${index}]);
        return true;
    })()`);
}

// original/program 必须不同，才能渲染出可撤回的改写项；current 默认等于 program，
// 这样手改计数为 0，脚本只测程序/AI 来源。
export function seedDiffMessage(send, { original, program, current = program, index = 0 } = {}) {
    if (typeof original !== 'string' || typeof program !== 'string') {
        throw new Error('seedDiffMessage 需要 original 与 program 两个字符串');
    }
    return evaluate(send, `(async () => {
        const base = '${MODULE_BASE}';
        const app = await import(base + 'host/appContext.js');
        const meta = await import(base + 'diff/messageMeta.js');
        const branch = await import(base + 'chat/messageBranch.js');
        const view = await import(base + 'diff/view.js');
        const msg = app.getAppContext().chat[${index}];
        if (!msg) return { ok: false, error: '没有可用于 seeds 的消息' };
        const branchKey = branch.getMessageDiffBranchKey(msg);
        if (!branchKey) return { ok: false, error: '消息没有可用的 diff branch key' };
        msg.__blai_diff_branch_meta = {};
        meta.writeMessageDiffProgram(msg, branchKey, ${JSON.stringify(original)}, ${JSON.stringify(program)});
        const written = branch.commitCurrentMessageText(msg, ${JSON.stringify(current)});
        view.injectDiffButtons([${index}]);
        return { ok: true, branchKey, written };
    })()`);
}

// 程序改写规则快照 / 临时审计规则。
// 真实聊天可能没有启用任何预设，此时「重新净化」必然没有差异；测试必须自带确定性规则，
// 而不是靠硬写元数据造一个真实链路无法重现的差异。规则引擎有 processor 缓存，改完必须标脏。
export function snapshotProgramRules(send) {
    return evaluate(send, `(async () => {
        const app = await import('${MODULE_BASE}host/appContext.js');
        const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
        return settings ? JSON.parse(JSON.stringify(settings.rules || [])) : null;
    })()`);
}

export function installAuditRewriteRule(send, { target, replacement }) {
    return evaluate(send, `(async () => {
        const app = await import('${MODULE_BASE}host/appContext.js');
        const state = await import('${MODULE_BASE}rules/state.js');
        const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
        if (!settings) return false;
        settings.rules = [{
            name: '审计临时规则',
            enabled: true,
            subRules: [{
                targets: [${JSON.stringify(target)}],
                replacements: [${JSON.stringify(replacement)}],
                mode: 'simple',
                rewriteMode: 'program',
                remark: '',
                aiPromptTemplate: '',
                enabled: true,
                isEditing: false,
            }],
        }];
        state.markRegexDirty(true);
        return true;
    })()`);
}

export function restoreProgramRules(send, snapshot) {
    if (snapshot === null || snapshot === undefined) return Promise.resolve(false);
    return evaluate(send, `(async () => {
        const app = await import('${MODULE_BASE}host/appContext.js');
        const state = await import('${MODULE_BASE}rules/state.js');
        const settings = app.getAppContext().extension_settings?.ultimate_purifier_ai_rewrite;
        if (!settings) return false;
        settings.rules = ${JSON.stringify(snapshot)};
        state.markRegexDirty(true);
        const st = await import('/script.js');
        await st.saveSettings();
        return true;
    })()`);
}

// 用真实程序改写引擎计算结果，保证种子的 program 与「重新净化」的结果一致。
export function programRewriteText(send, text) {
    return evaluate(send, `(async () => {
        const engine = await import('${MODULE_BASE}rules/engine/engine-01-replace.js');
        return engine.applyScopedReplacements(${JSON.stringify(text)});
    })()`);
}

export const OPEN_DIFF_MODAL = `(() => {
    const modal = document.getElementById('blai-diff-modal');
    if (modal && getComputedStyle(modal).display !== 'none') return true;
    document.querySelector('.blai-diff-btn[data-index="0"]')?.click();
    return !!modal && getComputedStyle(modal).display !== 'none';
})()`;
