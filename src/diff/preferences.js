/**
 * 透视「更多操作」菜单偏好的统一读写。
 *
 * 所有选项都存在 extension_settings：点击按取值序列循环、切完即持久化，
 * 重开弹窗仍保持上次选择，不用每次重新设置。
 * 业务代码只认 cycleDiffPreference(key) 一个入口，新增菜单项只需加一条规格。
 */
import { extensionName, diffLineHeightOptions, diffParagraphGapOptions, diffFontSizeOptions, normalizeDiffLineHeight, normalizeDiffParagraphGap, normalizeDiffFontSize } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { diffRuntimeState } from './state.js';

// 每项：有序取值、归一化读取、写回（含运行时副作用）。
const SPECS = {
    diffRelatedRuleEnabled: {
        values: [false, true],
        read: (s) => s.diffRelatedRuleEnabled === true,
        write: (s, v) => { s.diffRelatedRuleEnabled = v; diffRuntimeState.diffRelatedRuleMode = v; },
    },
    diffLineHeight: {
        values: diffLineHeightOptions,
        read: (s) => normalizeDiffLineHeight(s.diffLineHeight),
        write: (s, v) => { s.diffLineHeight = v; },
    },
    diffParagraphGap: {
        values: diffParagraphGapOptions,
        read: (s) => normalizeDiffParagraphGap(s.diffParagraphGap),
        write: (s, v) => { s.diffParagraphGap = v; },
    },
    diffFontSize: {
        values: diffFontSizeOptions,
        read: (s) => normalizeDiffFontSize(s.diffFontSize),
        write: (s, v) => { s.diffFontSize = v; },
    },
    diffButtonInExtraMenu: {
        values: [false, true],
        read: (s) => s.diffButtonInExtraMenu === true,
        write: (s, v) => { s.diffButtonInExtraMenu = v; },
    },
    showBottomDiffButton: {
        values: [false, true],
        read: (s) => s.showBottomDiffButton !== false,
        write: (s, v) => { s.showBottomDiffButton = v; },
    },
};

/** 把持久化的相关规则开关同步到运行时状态；打开弹窗时调用。 */
export function syncRelatedRuleRuntime() {
    const { extension_settings } = getAppContext();
    diffRuntimeState.diffRelatedRuleMode = extension_settings[extensionName]?.diffRelatedRuleEnabled === true;
}

/**
 * 统一入口：按 key 推进到下一个取值并写回设置，返回新值。
 * 持久化与重绘副作用仍由调用方负责，业务代码不再逐项手写切换逻辑。
 * @param {string} key data-blai-pref 的值
 * @returns {*} 新值；未知 key 返回 null
 */
export function cycleDiffPreference(key) {
    const spec = SPECS[key];
    if (!spec) return null;
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const current = spec.read(settings);
    const index = Math.max(0, spec.values.findIndex(v => Object.is(v, current)));
    const next = spec.values[(index + 1) % spec.values.length];
    spec.write(settings, next);
    return next;
}
