// 只负责临时 toast 与共享风险弹窗的呈现，不负责其业务判断。
// 退场时长与 --blai-duration-fast 保持一致，避免动画未播完就被移除。
import { fadeOutThen } from './motion.js';

const TOAST_EXIT_MS = 120;

// 语义类型 → Font Awesome 图标；默认 info。
const TOAST_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
};

export function showToast(message, description, type = 'info') {
    $('.blai-toast').remove();
    const themeMode = String($('#blai-purifier-popup').attr('data-theme') || 'auto');
    const semantic = Object.hasOwn(TOAST_ICONS, type) ? type : 'info';
    const $toast = $(`<div class="blai-toast" data-type="${semantic}" data-theme="${themeMode}" data-tt-mobile-surface="free-window" role="status" aria-live="polite"><i class="fas ${TOAST_ICONS[semantic]}"></i><span class="blai-toast-text"></span></div>`);
    $toast.find('.blai-toast-text').text(String(message || ''));
    const hasDescription = description !== undefined && description !== null && String(description);
    if (hasDescription) {
        const $content = $('<div class="blai-toast-content"></div>');
        const $title = $toast.find('.blai-toast-text').detach().addClass('blai-toast-title');
        const $description = $('<span class="blai-toast-description"></span>').text(String(description));
        $content.append($title, $description);
        $toast.append($content);
    }
    $('body').append($toast);
    setTimeout(() => $toast.addClass('blai-show'), 10);
    setTimeout(() => {
        $toast.removeClass('blai-show');
        setTimeout(() => $toast.remove(), TOAST_EXIT_MS);
    }, hasDescription ? 6000 : 2000);
}

export function showRiskConfirmModal(message) {
    return new Promise((resolve) => {
        const $modal = $('#blai-risk-confirm-modal');
        let settled = false;
        const finish = (confirmed) => {
            if (settled) return;
            settled = true;
            $('#blai-risk-confirm-cancel, #blai-risk-confirm-ok').off('.blaiRiskConfirm');
            $modal.off('.blaiRiskConfirm');
            fadeOutThen($modal, () => {
                $modal.hide().attr('aria-hidden', 'true');
                resolve(confirmed);
            });
        };

        $('#blai-risk-confirm-text').text(String(message || ''));
        $modal.css('display', 'flex').attr('aria-hidden', 'false');
        $('#blai-risk-confirm-cancel').on('click.blaiRiskConfirm', () => finish(false));
        $('#blai-risk-confirm-ok').on('click.blaiRiskConfirm', () => finish(true));
        $modal.on('click.blaiRiskConfirm', (event) => {
            if (event.target === $modal[0]) finish(false);
        });
    });
}

export function showRiskInfoModal(message) {
    const $modal = $('#blai-risk-info-modal');
    let settled = false;
    const close = () => {
        if (settled) return;
        settled = true;
        $('#blai-risk-info-close').off('.blaiRiskInfo');
        $modal.off('.blaiRiskInfo');
        fadeOutThen($modal, () => $modal.hide().attr('aria-hidden', 'true'));
    };

    $('#blai-risk-info-text').text(String(message || ''));
    $modal.css('display', 'flex').attr('aria-hidden', 'false');
    $('#blai-risk-info-close').on('click.blaiRiskInfo', close).trigger('focus');
    $modal.on('click.blaiRiskInfo', (event) => {
        if (event.target === $modal[0]) close();
    });
}

// 插件内的统一对话框：原生 confirm/alert/prompt 会贴在浏览器窗口顶部，无法与插件界面对齐，
// 因此全部改走这套自适应弹窗，永远在视口正中。
function openPluginDialog({ message, value = null, placeholder = '', okText = '确定', cancelText = '取消', showCancel = true, danger = false, allowHtml = false }) {
    return new Promise((resolve) => {
        const theme = String($('#blai-purifier-popup').attr('data-theme') || 'auto');
        const $modal = $('<div class="blai-modal-shell blai-plugin-dialog" role="presentation"></div>')
            .attr('data-theme', theme);
        const $card = $('<div class="blai-modal-card blai-plugin-dialog-card" role="dialog" aria-modal="true"></div>').appendTo($modal);
        const $text = $('<p class="blai-plugin-dialog-text blai-dialog-body-text"></p>').appendTo($card);
        // 只有调用方显式声明可信的硬编码文案时才渲染 HTML；默认仍走 text()，避免把用户输入当标记解析。
        if (allowHtml) $text.html(String(message || ''));
        else $text.text(String(message || ''));
        const $input = value === null
            ? null
            : $('<input type="text" class="blai-input blai-plugin-dialog-input">')
                .val(String(value))
                .attr('placeholder', placeholder)
                .appendTo($card);
        const $actions = $('<div class="blai-modal-actions"></div>').appendTo($card);
        if (showCancel) {
            $('<button type="button" class="blai-secondary-btn"></button>').text(cancelText).appendTo($actions);
        }
        $('<button type="button" class="blai-primary-btn"></button>')
            .text(okText)
            .toggleClass('blai-danger-btn', danger === true)
            .appendTo($actions);

        let settled = false;
        const close = (result) => {
            if (settled) return;
            settled = true;
            $(document).off('keydown.blaiPluginDialog');
            fadeOutThen($modal, () => {
                $modal.remove();
                resolve(result);
            });
        };
        $actions.on('click', 'button', function () {
            const isOk = $(this).hasClass('blai-primary-btn');
            if (!isOk) return close(value === null ? false : null);
            close(value === null ? true : String($input.val() || ''));
        });
        $modal.on('click', (event) => {
            if (event.target === $modal[0]) close(value === null ? false : null);
        });
        $(document).on('keydown.blaiPluginDialog', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(value === null ? false : null);
            } else if (event.key === 'Enter' && value !== null) {
                event.preventDefault();
                close(String($input.val() || ''));
            }
        });

        $('body').append($modal);
        $modal.addClass('blai-is-open').css('display', 'flex');
        window.setTimeout(() => {
            if ($input) { $input.trigger('focus').trigger('select'); }
            else { $actions.find('.blai-primary-btn').trigger('focus'); }
        }, 20);
    });
}

export function showConfirmModal(message, options = {}) {
    return openPluginDialog({
        message,
        okText: options.okText || '确定',
        cancelText: options.cancelText || '取消',
        danger: options.danger === true,
    });
}

// 未保存改动提醒：三选一，返回 'save' | 'discard' | 'cancel'（继续编辑）。
// 走与统一对话框相同的 blai-plugin-dialog 外观和 z-index，保证压在编辑弹窗之上。
export function showUnsavedChangesModal(message = '当前分组有未保存的改动，是否保存？') {
    return new Promise((resolve) => {
        const theme = String($('#blai-purifier-popup').attr('data-theme') || 'auto');
        const $modal = $('<div class="blai-modal-shell blai-plugin-dialog" role="presentation"></div>')
            .attr('data-theme', theme);
        const $card = $('<div class="blai-modal-card blai-plugin-dialog-card" role="dialog" aria-modal="true"></div>').appendTo($modal);
        $('<p class="blai-plugin-dialog-text blai-dialog-body-text"></p>').text(String(message || '')).appendTo($card);
        const $actions = $('<div class="blai-modal-actions"></div>').appendTo($card);
        // 三个按钮的返回值用 data-choice 显式声明，不靠 blai-danger-btn / blai-primary-btn
        // 这类样式类反推——「放弃改动」此前只挂了 secondary 类，被误判成 cancel（继续编辑），
        // 导致点了放弃却不关闭分组弹窗。样式与结果解耦后，改样式不会再改变行为。
        $('<button type="button" class="blai-secondary-btn" data-choice="cancel"></button>').text('继续编辑').appendTo($actions);
        $('<button type="button" class="blai-secondary-btn" data-choice="discard"></button>').text('放弃改动').appendTo($actions);
        $('<button type="button" class="blai-primary-btn" data-choice="save"></button>').text('保存并关闭').appendTo($actions);

        let settled = false;
        const close = (result) => {
            if (settled) return;
            settled = true;
            $(document).off('keydown.blaiUnsavedChanges');
            fadeOutThen($modal, () => {
                $modal.remove();
                resolve(result);
            });
        };
        $actions.on('click', 'button', function () {
            close($(this).attr('data-choice'));
        });
        $modal.on('click', (event) => {
            if (event.target === $modal[0]) close('cancel');
        });
        $(document).on('keydown.blaiUnsavedChanges', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close('cancel');
            }
        });

        $('body').append($modal);
        $modal.addClass('blai-is-open').css('display', 'flex');
        window.setTimeout(() => $actions.find('.blai-primary-btn').trigger('focus'), 20);
    });
}

export function showAlertModal(message, options = {}) {
    return openPluginDialog({ message, okText: options.okText || '知道了', showCancel: false, allowHtml: options.allowHtml === true });
}

export function showPromptModal(message, defaultValue = '', options = {}) {
    return openPluginDialog({
        message,
        value: defaultValue,
        placeholder: options.placeholder || '',
        okText: options.okText || '确定',
        cancelText: options.cancelText || '取消',
    });
}
