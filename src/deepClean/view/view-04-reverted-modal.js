/** 深度清理「已撤销改写」独立弹窗：内容多时可滚动，逐条带来源与改写前后文本。 */

const MODAL_ID = 'blai-deep-clean-reverted-modal';
const CLOSE_EVENT = 'blaiDeepCleanRevertedModal';

function escapeHtml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 打开弹窗；locate 回调用于点击某条后跳回正文对应改写项。 */
export function openDeepCleanRevertedModal(entries, locate) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    closeDeepCleanRevertedModal();

    const theme = String($('#blai-purifier-popup').attr('data-theme') || 'auto');
    const $modal = $(`<div id="${MODAL_ID}" class="blai-modal-shell blai-deep-clean-reverted-modal" role="presentation" data-theme="${theme}"></div>`);
    const $card = $('<div class="blai-modal-card blai-deep-clean-reverted-card" role="dialog" aria-modal="true" aria-label="已撤销改写"></div>').appendTo($modal);

    $card.append('<header class="blai-deep-clean-reverted-head"><h3>已撤销改写</h3><p>这些改写已取消，执行时保留原文。</p></header>');

    const $list = $('<div class="blai-deep-clean-reverted-list" role="list"></div>').appendTo($card);
    entries.forEach((entry, index) => {
        const $row = $(`<div class="blai-deep-clean-reverted-row" role="listitem"></div>`).appendTo($list);
        $row.append(`<div class="blai-deep-clean-reverted-row-head">
            <span class="blai-deep-clean-reverted-index">${index + 1}</span>
            <span class="blai-deep-clean-reverted-source"><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeHtml(entry.source)}</span>
            <button type="button" class="blai-deep-clean-reverted-locate" data-index="${index}" aria-label="定位到该改写项" title="定位到该改写项"><i class="fas fa-arrow-right" aria-hidden="true"></i>定位</button>
        </div>`);
        const $texts = $('<div class="blai-deep-clean-reverted-texts"></div>').appendTo($row);
        $texts.append(`<div class="blai-deep-clean-reverted-text"><span class="blai-deep-clean-reverted-label">原改写</span><span class="blai-deep-clean-reverted-value is-new">${escapeHtml(entry.preview || '（空）')}</span></div>`);
        $texts.append(`<div class="blai-deep-clean-reverted-text"><span class="blai-deep-clean-reverted-label">保留原文</span><span class="blai-deep-clean-reverted-value is-old">${escapeHtml(entry.original || '（空）')}</span></div>`);
        $row.data('entry', entry);
    });

    const $actions = $('<div class="blai-modal-actions"></div>').appendTo($card);
    $('<button type="button" class="blai-secondary-btn"></button>').text('关闭').appendTo($actions).on('click', closeDeepCleanRevertedModal);

    $list.on('click', '.blai-deep-clean-reverted-locate', function () {
        const row = $(this).closest('.blai-deep-clean-reverted-row');
        const entry = row.data('entry');
        if (entry && typeof locate === 'function') locate(entry);
        closeDeepCleanRevertedModal();
    });

    $modal.on('click', (event) => {
        if (event.target === $modal[0]) closeDeepCleanRevertedModal();
    });
    $(document).on(`keydown.${CLOSE_EVENT}`, (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDeepCleanRevertedModal();
        }
    });

    $('body').append($modal);
    $modal.addClass('blai-is-open').css('display', 'flex');
    $actions.find('button').trigger('focus');
}

export function closeDeepCleanRevertedModal() {
    const $modal = $(`#${MODAL_ID}`);
    if (!$modal.length) return;
    $(document).off(`.${CLOSE_EVENT}`);
    $modal.remove();
}
