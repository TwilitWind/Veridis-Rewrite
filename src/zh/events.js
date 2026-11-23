/**
 * 负责中文字典的启用/安装用户操作与安装 UI 生命周期。
 * 字典包/存储语义在 zh/dictionary.js；运行时转换在 zh/conversion.js。
 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { markRulesDataDirty } from '../rules/state.js';
import { showToast } from '../ui/notifications.js';
import {
    closeLoadingOverlay,
    closeZhDictionaryModal,
    openZhDictionaryModal,
    showZhDictionaryInstallOverlay,
    updateZhDictionaryInstallOverlay,
} from './view.js';
import {
    downloadZhDictionaryPackage,
    getZhDictionaryPackageStats,
    getZhDictionaryPackageStatus,
    getZhVariantCompatOptions,
    isZhDictionaryReady,
    markZhDictionaryInstallFailed,
    restoreZhDictionaryPackageFromCache,
} from './dictionary.js';

let zhDictionaryInstallAbortController = null;

export function bindZhEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const syncZhDictionaryState = (packageStatus) => {
        const ready = packageStatus?.ready === true;
        const lastError = String(packageStatus?.lastError || '');
        const failed = !ready && lastError !== '' && !lastError.includes('取消');
        const state = ready ? 'ready' : (failed ? 'failed' : 'missing');
        // 失败原因本身就带上下文（下载失败 / 缓存丢失），不再叠加「下载失败：」前缀。
        const text = ready
            ? '简繁兼容包已安装，插件会自动按你的简繁设置匹配文本。'
            : (failed ? lastError : '尚未安装简繁兼容包，安装后才能开启简繁转换。');
        $('#blai-zh-dict-state')
            .attr('data-state', state)
            .toggleClass('is-ready', ready)
            .toggleClass('is-failed', failed);
        $('#blai-zh-dict-state-text').text(text);
        $('#blai-zh-dict-retry').prop('hidden', !failed);
    };
    const syncZhCompatToggle = () => {
        // hydrate: true 会真正校验本地缓存并装载词典索引。只用 meta 判定会出现
        // 「开关亮着可点、点下去缓存读不到又静默复位」的情况（简繁转换打不开）。
        const packageStatus = getZhDictionaryPackageStatus(settings, { hydrate: true });
        // 设置里写着已安装、但本地缓存已经不在了（清缓存 / 换浏览器 / 迁移设置）。
        // 不能继续显示成「已安装」，否则开关点了没反应；这里落成失败态并给出「重新下载」。
        if (packageStatus.ready !== true && settings.zhVariantDictionary?.status === 'verified') {
            markZhDictionaryInstallFailed(new Error('本地缓存的简繁兼容包已丢失，需要重新下载。'));
            settings.zhVariantCompatEnabled = false;
            saveSettingsDebounced();
        }
        const hydratedStatus = getZhDictionaryPackageStatus(settings, { hydrate: true });
        syncZhDictionaryState(hydratedStatus);
        const ready = hydratedStatus.ready;
        if (settings.zhVariantCompatEnabled === true && !ready) {
            settings.zhVariantCompatEnabled = false;
        }
        const enabled = settings.zhVariantCompatEnabled === true && ready;
        const options = getZhVariantCompatOptions(settings);
        const regionText = [
            options.tw ? '台繁' : '',
            options.hk ? '港繁' : '',
        ].filter(Boolean).join('、') || '标准简繁';
        $('#blai-zh-dict-install-open').prop('hidden', ready);
        $('#blai-zh-compat-toggle')
            .prop('hidden', !ready)
            .attr('aria-pressed', String(enabled))
            .attr('aria-label', enabled ? '关闭简繁转换' : '开启简繁转换')
            .attr('title', enabled
                ? `关闭简繁转换（${regionText} 变体参与匹配）`
                : `开启简繁转换（${regionText} 变体参与匹配）`)
            .find('.blai-tools-switch-state')
            .text(enabled ? '开启' : '关闭');
    };
    const enableVerifiedZhCompat = () => {
        if (!restoreZhDictionaryPackageFromCache(settings)) {
            // 缓存缺失或损坏：写入失败态，界面显示「下载失败：…」并给出「重新下载」。
            markZhDictionaryInstallFailed(new Error('本地缓存的简繁兼容包不可用，需要重新下载'));
            settings.zhVariantCompatEnabled = false;
            markRulesDataDirty({ rulesUi: false });
            saveSettingsDebounced();
            syncZhCompatToggle();
            showToast('简繁兼容包不可用，请重新下载', undefined, 'error');
            return false;
        }
        settings.zhVariantCompatEnabled = true;
        markRulesDataDirty({ rulesUi: false });
        saveSettingsDebounced();
        syncZhCompatToggle();
        return true;
    };
    const openZhDictionaryInstallPrompt = () => {
        const stats = getZhDictionaryPackageStats();
        openZhDictionaryModal(stats, getZhVariantCompatOptions(settings));
    };
    const runZhDictionaryInstall = async () => {
        if (zhDictionaryInstallAbortController) return;
        settings.zhVariantCompatOptions = {
            tw: $('#blai-zh-dict-tw').prop('checked') === true,
            hk: $('#blai-zh-dict-hk').prop('checked') === true,
        };
        settings.zhVariantCompatEnabled = false;
        saveSettingsDebounced();
        closeZhDictionaryModal();
        $('#blai-zh-dict-install-status').prop('hidden', true).text('');

        zhDictionaryInstallAbortController = new AbortController();
        showZhDictionaryInstallOverlay(() => {
            zhDictionaryInstallAbortController?.abort();
        });

        try {
            await downloadZhDictionaryPackage({
                signal: zhDictionaryInstallAbortController.signal,
                onProgress: ({ ratio, statusText }) => updateZhDictionaryInstallOverlay(ratio, statusText),
            });
            settings.zhVariantCompatEnabled = true;
            markRulesDataDirty({ rulesUi: false });
            saveSettingsDebounced();
            syncZhCompatToggle();
        } catch (error) {
            const message = markZhDictionaryInstallFailed(error);
            settings.zhVariantCompatEnabled = false;
            markRulesDataDirty({ rulesUi: false });
            saveSettingsDebounced();
            syncZhCompatToggle();
            $('#blai-zh-dict-install-status')
                .prop('hidden', false)
                .text(error?.name === 'AbortError' ? '已取消词典下载。' : `词典安装失败：${message}`);
        } finally {
            zhDictionaryInstallAbortController = null;
            window.setTimeout(() => closeLoadingOverlay(), 260);
        }
    };

    syncZhCompatToggle();

    $(document).off('click', '#blai-zh-dict-install-open').on('click', '#blai-zh-dict-install-open', function(e) {
        e.preventDefault();
        if (isZhDictionaryReady(settings)) {
            syncZhCompatToggle();
            return;
        }
        openZhDictionaryInstallPrompt();
    });

    $(document).off('click', '#blai-zh-compat-toggle').on('click', '#blai-zh-compat-toggle', function(e) {
        e.preventDefault();
        if (settings.zhVariantCompatEnabled === true && isZhDictionaryReady(settings)) {
            settings.zhVariantCompatEnabled = false;
            markRulesDataDirty({ rulesUi: false });
            saveSettingsDebounced();
            syncZhCompatToggle();
            return;
        }
        if (!enableVerifiedZhCompat()) syncZhCompatToggle();
    });

    $(document).off('click', '#blai-zh-dict-retry').on('click', '#blai-zh-dict-retry', function(e) {
        e.preventDefault();
        if (zhDictionaryInstallAbortController) return;
        $('#blai-zh-dict-install-status').prop('hidden', true).text('');
        openZhDictionaryInstallPrompt();
    });

    $(document).off('click', '#blai-zh-dict-close, #blai-zh-dict-cancel').on('click', '#blai-zh-dict-close, #blai-zh-dict-cancel', function(e) {
        e.preventDefault();
        closeZhDictionaryModal();
    });

    $(document).off('click', '#blai-zh-dict-download').on('click', '#blai-zh-dict-download', function(e) {
        e.preventDefault();
        runZhDictionaryInstall();
    });
}
