// 负责 Veridis 更新状态推导及其工具/反馈投影。
import { getAppContext } from '../host/appContext.js';
import { logger } from '../log.js';

const remoteManifestRepository = 'The-Veridis-Lion/Veridis-Rewrite';

let updateState = null;
let updateInFlight = false;

function makeElement(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function releaseNoteItems(note) {
    return String(note || '').split(/[；;]/).map((item) => item.trim()).filter(Boolean);
}

function appendStatusRow(container, version, status, statusClass = '') {
    const row = makeElement('div', 'blai-tools-version-status-row');
    const current = makeElement('div', 'blai-tools-version-current');
    current.append(makeElement('span', 'blai-tools-version-label', '当前版本'));
    current.append(makeElement('strong', 'blai-tools-version-value', `v${version}`));
    row.append(current);
    row.append(makeElement('p', `blai-tools-version-status ${statusClass}`.trim(), status));
    container.append(row);
}

function appendReleaseItems(container, items) {
    const normalizedItems = items.map((item) => String(item || '').trim()).filter(Boolean);
    if (!normalizedItems.length) return;
    const list = makeElement('ul', 'blai-tools-version-note-list');
    normalizedItems.forEach((item) => list.append(makeElement('li', '', item)));
    container.append(list);
}

function appendReleaseNotes(container, note) {
    appendReleaseItems(container, releaseNoteItems(note));
}

function appendUpdateAction(container) {
    const action = makeElement('button', 'blai-tools-version-update-action', '更新并刷新');
    action.type = 'button';
    action.dataset.updateAction = 'update';
    container.append(action);
    const error = makeElement('p', 'blai-tools-version-error');
    error.id = 'blai-tools-version-error';
    error.hidden = true;
    container.append(error);
}

function projectToolsVersion(message = '正在检查版本信息…') {
    const content = document.getElementById('blai-tools-version-content');
    if (!content) return;
    content.replaceChildren();

    if (!updateState) {
        content.append(makeElement('p', 'blai-tools-version-status', message));
        return;
    }

    const details = makeElement('div', 'blai-tools-version-details');
    const body = makeElement('div', 'blai-tools-version-body');
    if (updateState.kind === 'latest') {
        appendStatusRow(details, updateState.localVersion, '已是最新版本', 'is-latest');
        appendReleaseNotes(body, updateState.updateNote);
    } else {
        if (updateState.kind === 'formal') {
            appendStatusRow(details, updateState.localVersion, `检测到新版本 v${updateState.remoteVersion}`, 'is-update');
            appendReleaseNotes(body, updateState.updateNote);
        } else {
            appendStatusRow(details, updateState.localVersion, '检测到小型修复更新', 'is-update');
            appendReleaseNotes(body, updateState.updateNote);
        }
        appendUpdateAction(body);
    }

    details.append(body);
    content.append(details);
}

export function projectFeedbackUpdateWarning() {
    const form = document.getElementById('blai-feedback-form');
    const content = document.getElementById('blai-feedback-workspace-content');
    if (!form || !content) return;
    // 提示块是表单外的独立节点：表单重渲染或标签切换后都从内容区统一清掉，避免残留。
    content.querySelector('.blai-feedback-update-warning')?.remove();
    if (!updateState || updateState.kind === 'latest') return;

    const warning = makeElement('p', 'blai-feedback-update-warning', '当前不是最新版本哦，建议先更新再反馈～');
    warning.setAttribute('role', 'note');
    content.insertBefore(warning, form);
}

function projectUpdateSurfaces() {
    projectToolsVersion();
    projectFeedbackUpdateWarning();
}

async function readRemoteManifest() {
    const response = await fetch(`https://raw.githubusercontent.com/${remoteManifestRepository}/main/manifest.json`, {
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Remote manifest request returned HTTP ${response.status}.`);
    return await response.json();
}

async function readRemoteMainCommitSha() {
    const response = await fetch(`https://api.github.com/repos/${remoteManifestRepository}/git/ref/heads/main`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Remote main reference request returned HTTP ${response.status}.`);
    const reference = await response.json();
    return reference.object?.sha;
}

export async function initializeUpdateStatus({ versionInfo, isGlobal } = {}) {
    updateState = null;
    updateInFlight = false;
    projectUpdateSurfaces();

    const appContext = getAppContext();
    let localManifest;
    try {
        localManifest = await appContext.readExtensionManifest(appContext.veridisExternalId);
    } catch (error) {
        logger.error('[Veridis Update] Failed to read the local manifest; update status will remain hidden.', error);
        projectToolsVersion('暂时无法确认版本状态。');
        return;
    }

    let remoteManifest;
    try {
        remoteManifest = await readRemoteManifest();
    } catch (error) {
        logger.error('[Veridis Update] Failed to retrieve or parse the remote manifest; update status will remain hidden.', error);
        projectToolsVersion('暂时无法确认版本状态。');
        return;
    }

    const localVersion = String(localManifest?.version || '').trim();
    const remoteVersion = String(remoteManifest?.version || '').trim();
    if (!localVersion || !remoteVersion) {
        logger.error('[Veridis Update] Local or remote manifest does not provide a version; update status will remain hidden.');
        projectToolsVersion('暂时无法确认版本状态。');
        return;
    }
    if (remoteVersion !== localVersion) {
        const updateNote = String(remoteManifest?.update_note || '').trim();
        if (!updateNote) logger.warn('[Veridis Update] Formal remote version update has no update_note metadata.');
        updateState = { kind: 'formal', localVersion, remoteVersion, updateNote, isGlobal: isGlobal === true };
    } else {
        const localFullCommitSha = String(versionInfo?.currentCommitHash || '').trim();
        let remoteMainFullCommitSha;
        try {
            remoteMainFullCommitSha = await readRemoteMainCommitSha();
        } catch (error) {
            logger.error('[Veridis Update] Failed to retrieve or parse the remote main reference; update status will remain hidden.', error);
            projectToolsVersion('暂时无法确认版本状态。');
            return;
        }
        if (!/^[0-9a-f]{40}$/.test(localFullCommitSha) || !/^[0-9a-f]{40}$/.test(remoteMainFullCommitSha)) {
            logger.error('[Veridis Update] Local or remote main reference does not provide a full commit SHA; update status will remain hidden.');
            projectToolsVersion('暂时无法确认版本状态。');
            return;
        }
        const isLatest = localFullCommitSha === remoteMainFullCommitSha;
        updateState = {
            kind: isLatest ? 'latest' : 'minor',
            localVersion,
            remoteVersion,
            updateNote: String((isLatest ? localManifest : remoteManifest)?.update_note || '').trim(),
            isGlobal: isGlobal === true,
        };
    }
    projectUpdateSurfaces();
}

async function updateAndReload() {
    if (updateInFlight || !updateState || updateState.kind === 'latest') return;
    const context = getAppContext().getSillyTavernContext?.();
    const extensionFolderName = getAppContext().veridisExtensionFolderName;
    const getRequestHeaders = context?.getRequestHeaders;
    const $button = $('#blai-tools-version-section [data-update-action="update"]');
    if (typeof getRequestHeaders !== 'function') {
        const error = new Error('SillyTavern request headers are unavailable.');
        logger.error('[Veridis Update] Extension update failed.', error);
        $('#blai-tools-version-error').text(error.message).prop('hidden', false);
        return;
    }

    updateInFlight = true;
    $button.prop('disabled', true).text('正在更新…');
    try {
        // 先获取所有远程分支，包括浅层发布分支安装中的 main。
        const branchesResponse = await fetch('/api/extensions/branches', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: extensionFolderName, global: updateState.isGlobal }),
        });
        if (!branchesResponse.ok) throw new Error(`Extension branches request returned HTTP ${branchesResponse.status}.`);

        const switchResponse = await fetch('/api/extensions/switch', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: extensionFolderName, global: updateState.isGlobal, branch: 'origin/main' }),
        });
        if (!switchResponse.ok) throw new Error(`Extension switch request returned HTTP ${switchResponse.status}.`);

        // SillyTavern 会拉取当前分支；只有在检出 main 之后才走到这里。
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: extensionFolderName, global: updateState.isGlobal }),
        });
        if (!response.ok) throw new Error(`Extension update request returned HTTP ${response.status}.`);
        await response.json();
        globalThis.location.reload();
    } catch (error) {
        logger.error('[Veridis Update] Extension update failed.', error);
        const message = error instanceof Error ? error.message : String(error);
        // 本地开发副本与装机副本共用目录，源码同步会让该 Git 工作区变脏；
        // SillyTavern 切分支会直接 500。此时不要把裸 HTTP 错误甩给用户。
        const friendlyMessage = /HTTP 500|checkout|local changes/i.test(message)
            ? '当前副本有未提交的改动，无法在线切换分支更新。请保留本地改动，不要使用「更新并刷新」。'
            : message;
        $('#blai-tools-version-error').text(friendlyMessage).prop('hidden', false);
        $button.prop('disabled', false).text('更新并刷新');
        updateInFlight = false;
    }
}

export function bindUpdateStatusEvents() {
    $(document).off('click', '#blai-tools-version-section [data-update-action="update"]').on('click', '#blai-tools-version-section [data-update-action="update"]', updateAndReload);
}
