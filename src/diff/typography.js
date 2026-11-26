/**
 * 净化透视弹窗正文排版：正文字号 / 行距 / 段距的统一回显。
 * 三项设置都走 defaults.js 的规范化器，CSS 变量只在这里落地，
 * 事件层只调用 syncDiffTypographyState()，不再各自读写 DOM。
 */
import {
    extensionName,
    diffParagraphGapOptions,
    diffFontSizeLabels,
    normalizeDiffLineHeight,
    normalizeDiffParagraphGap,
    normalizeDiffFontSize,
} from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';

const DIFF_GAP_LABELS = ['紧凑', '标准', '宽松'];

export function syncDiffTypographyState() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const lineHeight = normalizeDiffLineHeight(settings.diffLineHeight);
    const gap = normalizeDiffParagraphGap(settings.diffParagraphGap);
    const fontSize = normalizeDiffFontSize(settings.diffFontSize);
    settings.diffLineHeight = lineHeight;
    settings.diffParagraphGap = gap;
    settings.diffFontSize = fontSize;

    const modal = document.getElementById('blai-diff-modal');
    modal?.style.setProperty('--blai-diff-body-line-height', String(lineHeight));
    modal?.style.setProperty('--blai-diff-body-paragraph-gap', `${gap}px`);
    // 字号按档位交给 CSS 映射到语义刻度，手机端整档 +1px 自动生效。
    if (modal) modal.dataset.diffFontSize = fontSize;

    $('#blai-diff-font-size-text').text(`字号${diffFontSizeLabels[fontSize]}`);
    $('#blai-diff-line-height-text').text(`行距${lineHeight}`);
    const gapIndex = Math.max(0, diffParagraphGapOptions.indexOf(gap));
    $('#blai-diff-paragraph-gap-text').text(`段距${DIFF_GAP_LABELS[gapIndex]}`);
}
