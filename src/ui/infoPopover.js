/**
 * 通用说明气泡：工具页「净化结果楼层数」与 AI 页「API 连接」共用。
 * 模板里的按钮用 data-blai-info-trigger 指向面板 id，打开/关闭统一走 popover.js。
 */
import { closeMenuPopover, openMenuPopover } from './popover.js';

export function bindInfoPopoverEvents() {
    $(document)
        .off('click.blaiInfoPopover', '[data-blai-info-trigger]')
        .on('click.blaiInfoPopover', '[data-blai-info-trigger]', function(event) {
            event.preventDefault();
            event.stopPropagation();
            const panelId = String($(this).attr('data-blai-info-trigger') || '');
            const panel = panelId ? document.getElementById(panelId) : null;
            if (!panel) return;
            if (panel.hidden) {
                openMenuPopover(this, panel);
                panel.hidden = false;
                $(this).attr('aria-expanded', 'true');
            } else {
                closeMenuPopover(panel);
                panel.hidden = true;
                $(this).attr('aria-expanded', 'false');
            }
        });

    $(document)
        .off('click.blaiInfoPopoverPanel', '.blai-info-popover')
        .on('click.blaiInfoPopoverPanel', '.blai-info-popover', (event) => {
            event.stopPropagation();
        });
}
