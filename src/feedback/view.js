// 负责专用反馈工作区与深度清理诊断工作区渲染。
import { feedbackAreas, feedbackTypes } from './payload.js';
import {
    applyDebugDisplayOrder,
    getAiRewriteDebugDisplayText,
    getAiRewriteDebugEventCount,
    readDebugDisplayOrderPreference,
} from '../aiRewrite/debug.js';
import { formatAiCommunicationRecords } from '../aiRewrite/communicationMonitor.js';
import { projectFeedbackUpdateWarning } from '../update/status.js';

// 为本页保留真实可编辑表单，包括浏览器持有的文件选择。
let feedbackDraftForm = null;

const feedbackAreaLabels = Object.freeze({
    'Deep Clean': '深度清理',
    'AI Rewrite': 'AI 改写',
    'Program Rewrite': '程序改写',
    'Streaming Filter': '流式过滤',
    Regex: '正则',
    'Diff / Review': '净化结果 / 审查',
    'Rule Search': '规则搜索',
    'Settings / API': '设置 / API',
    'UI / Layout': '界面 / 布局',
    'Third-party Integration': '第三方集成',
    Other: '其他',
});

function feedbackAreaDisplayLabel(value) {
    return feedbackAreaLabels[value] || value;
}

export function updateFeedbackAreaSummary() {
    const summary = document.querySelector('#blai-feedback-workspace .blai-feedback-area-summary');
    if (!summary) return;
    const selectedLabels = [...document.querySelectorAll('#blai-feedback-form input[name="feedbackArea"]:checked')]
        .map((input) => feedbackAreaDisplayLabel(input.value));
    summary.textContent = selectedLabels.length ? selectedLabels.join('、') : '选择涉及区域';
    summary.classList.toggle('is-empty', selectedLabels.length === 0);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function diagnosticAttachment(label, name, available = true, description = '') {
    return `
        <label class="blai-feedback-check${available ? '' : ' is-unavailable'}">
            <input class="blai-check-native" type="checkbox" name="${name}"${available ? '' : ' disabled'}>
            <span class="blai-feedback-check-copy">
                <span class="blai-feedback-check-title">${escapeHtml(label)}</span>
                ${description ? `<small class="blai-feedback-check-description">${escapeHtml(description)}</small>` : ''}
            </span>
            <small class="blai-feedback-check-status"${available ? ' hidden' : ''}>不可用</small>
        </label>
    `;
}

export function renderFeedbackForm(slots = {}) {
    const content = document.getElementById('blai-feedback-workspace-content');
    if (!content) return;
    if (feedbackDraftForm) {
        content.replaceChildren(feedbackDraftForm);
        projectFeedbackUpdateWarning();
        updateFeedbackAreaSummary();
        if (!feedbackDraftForm.querySelector('#blai-feedback-preview-generate').disabled) {
            showFeedbackStatus('草稿已保留，请重新生成预览。', 'notice');
            for (const [name, slot] of Object.entries({ deepCleanLatestFailure: 'latestFailure', deepCleanPreviousFailure: 'previousFailure', deepCleanLastSuccess: 'lastSuccess' })) {
                const input = feedbackDraftForm.querySelector(`[name="${name}"]`);
                const available = Boolean(slots[slot]);
                input.disabled = !available;
                input.closest('label').classList.toggle('is-unavailable', !available);
                input.closest('label').querySelector('.blai-feedback-check-status').hidden = available;
            }
        }
        return;
    }
    content.innerHTML = `
        <form id="blai-feedback-form" class="blai-feedback-form" novalidate>
            <div class="blai-feedback-form-main">
                <div class="blai-feedback-form-pair">
                    <label class="blai-feedback-control">
                        <span>类型</span>
                        <select id="blai-feedback-type" name="feedbackType">
                            <option value="">请选择类型</option>
                            ${feedbackTypes.map((type) => `<option value="${escapeHtml(type)}">${type === 'Feature' ? '功能建议' : escapeHtml(type)}</option>`).join('')}
                        </select>
                    </label>

                    <label class="blai-feedback-control">
                        <span>标题</span>
                        <input id="blai-feedback-title" name="feedbackTitle" type="text" autocomplete="off">
                    </label>
                </div>

                <fieldset class="blai-feedback-fieldset">
                    <legend>涉及区域</legend>
                    <p>可选择多个相关区域；例如深度清理中的结果或审查问题，可以同时选择「深度清理」和「净化结果 / 审查」。</p>
                    <div class="blai-feedback-area-select" data-blai-area-select>
                        <button type="button" class="blai-feedback-area-trigger" aria-haspopup="true" aria-expanded="false">
                            <span class="blai-feedback-area-summary">选择区域</span>
                            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="blai-feedback-area-options" hidden>
                        ${feedbackAreas.map((area) => `
                            <button type="button" class="blai-feedback-area-option" data-area="${escapeHtml(area)}" role="checkbox" aria-checked="false">
                                <i class="fa-regular fa-square blai-feedback-area-check" aria-hidden="true"></i>
                                <span>${escapeHtml(feedbackAreaDisplayLabel(area))}</span>
                            </button>
                        `).join('')}
                        </div>
                        <div class="blai-feedback-area-anchors" hidden>
                        ${feedbackAreas.map((area) => `
                            <input type="checkbox" name="feedbackArea" value="${escapeHtml(area)}">
                        `).join('')}
                        </div>
                    </div>
                </fieldset>

                <label class="blai-feedback-control">
                    <span>详细说明</span>
                    <textarea id="blai-feedback-details" name="feedbackDetails" rows="9"></textarea>
                </label>
            </div>

            <aside class="blai-feedback-form-side">
                <section class="blai-feedback-attachments" aria-labelledby="blai-feedback-attachments-title">
                    <h3 id="blai-feedback-attachments-title">可选诊断附件</h3>
                    <p>仅勾选的附件会在生成预览时读取。</p>
                    ${diagnosticAttachment('第三方扩展与酒馆助手脚本环境', 'installedEnabledExtensions', true, '包括已安装且未禁用的第三方扩展，以及酒馆助手中已启用的全局脚本；不会附加脚本正文。')}
                    ${diagnosticAttachment('运行日志', 'runtimeLog', true, '包括 Veridis 已记录的结构化运行事件；不会附加 AI 上下文中的提示词、请求或回复正文。')}
                    ${diagnosticAttachment('最近一次失败的深度清理诊断', 'deepCleanLatestFailure', Boolean(slots.latestFailure))}
                    ${diagnosticAttachment('上一次失败的深度清理诊断', 'deepCleanPreviousFailure', Boolean(slots.previousFailure))}
                    ${diagnosticAttachment('最近一次成功的深度清理诊断', 'deepCleanLastSuccess', Boolean(slots.lastSuccess))}
                    <div class="blai-feedback-file-picker">
                        <div class="blai-feedback-file-copy">
                            <span>选择文件（可多选）</span>
                            <p id="blai-feedback-files-help">最多 5 个文件，每个不超过 10 MiB；支持图片、PDF、文本和 JSON。仅上传你主动选择的文件。</p>
                        </div>
                        <input id="blai-feedback-files" name="feedbackFiles" type="file" multiple accept="image/*,application/pdf,text/*,application/json" aria-describedby="blai-feedback-files-help">
                        <button id="blai-feedback-files-trigger" class="blai-feedback-file-trigger" type="button" aria-controls="blai-feedback-files"><i class="fas fa-paperclip" aria-hidden="true"></i><span>选择文件</span></button>
                    </div>
                </section>

            </aside>

            <div class="blai-feedback-form-footer">
                <p class="blai-feedback-privacy" role="note">
                    Veridis 不会自动读取或附加 API Key、聊天内容、提示词、AI 回复、角色卡正文或世界书正文。建议在详细说明和所选文件中不要包含敏感信息。
                </p>
                <div class="blai-feedback-form-actions">
                    <div id="blai-feedback-status" class="blai-feedback-status" aria-live="polite"></div>
                    <button id="blai-feedback-preview-generate" class="blai-feedback-primary" type="button" aria-label="生成提交预览" title="生成提交预览">生成预览</button>
                </div>
            </div>

            <section id="blai-feedback-preview-section" class="blai-feedback-preview" hidden>
                <header>
                    <div>
                        <h3>提交预览</h3>
                        <p>下方完整 JSON 将作为 payload 部分原样发送，所选文件将随同一次提交上传。</p>
                    </div>
                </header>
                <pre id="blai-feedback-preview-json" tabindex="0"></pre>
                <div id="blai-feedback-preview-files"></div>
                <label class="blai-feedback-confirm">
                    <input id="blai-feedback-confirm" class="blai-check-native" type="checkbox">
                    <span>我已检查并确认提交以上完整内容。</span>
                </label>
                <button id="blai-feedback-submit" class="blai-feedback-primary" type="button" aria-label="提交匿名反馈" title="提交匿名反馈" disabled>提交反馈</button>
                <div id="blai-feedback-submit-status" class="blai-feedback-submit-status" aria-live="polite"></div>
            </section>
        </form>
    `;
    feedbackDraftForm = document.getElementById('blai-feedback-form');
    projectFeedbackUpdateWarning();
    updateFeedbackAreaSummary();
}

// 顶栏动作按钮统一由这里生成：图标 + 文字，与「清空记录」同一套外观。
function logActionButton(id, icon, label, { pressed = null, danger = false, title = '' } = {}) {
    const pressedAttr = pressed === null ? '' : ` aria-pressed="${pressed}"`;
    const dangerClass = danger ? ' is-danger' : '';
    const titleAttr = title ? ` title="${title}" aria-label="${title}"` : '';
    return `<button id="${id}" class="blai-feedback-heading-action${dangerClass}" type="button"${pressedAttr}${titleAttr}><i class="${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
}

export function renderRuntimeLog() {
    const content = document.getElementById('blai-feedback-workspace-content');
    if (!content) return;
    const order = readDebugDisplayOrderPreference();
    applyDebugDisplayOrder(order);
    const descending = order === 'desc';
    content.innerHTML = `
        <section class="blai-feedback-local-view">
            <header class="blai-feedback-local-heading">
                <div>
                    <h2>运行日志<span class="blai-feedback-log-badge"><b id="blai-feedback-log-count">${getAiRewriteDebugEventCount()}</b> 条</span></h2>
                    <p>${descending ? '按发生时间倒序' : '按发生顺序'}记录最近 100 条运行事件，时间取设备当前时区。同一秒内连续重复的空转事件会合并成一行。</p>
                </div>
                <div class="blai-feedback-heading-actions">
                    ${logActionButton('blai-feedback-log-order', 'fas fa-arrow-down-wide-short', descending ? '日期倒序' : '日期正序', {
                        pressed: descending,
                        title: descending ? '当前为日期倒序，点击切换为日期正序' : '当前为日期正序，点击切换为日期倒序',
                    })}
                    ${logActionButton('blai-feedback-clear-log', 'fas fa-eraser', '清空日志', { danger: true })}
                </div>
            </header>
            <pre id="blai-ai-debug-log" class="blai-feedback-log-output" tabindex="0" aria-live="polite"></pre>
        </section>
    `;
    content.querySelector('#blai-ai-debug-log').textContent = getAiRewriteDebugDisplayText();
}

export function renderAiContext() {
    const content = document.getElementById('blai-feedback-workspace-content');
    if (!content) return;
    content.innerHTML = `
        <section class="blai-feedback-local-view">
            <header class="blai-feedback-local-heading">
                <div><h2>AI 上下文</h2><p>查看 Veridis 实际发送给 AI 的请求上下文及返回结果。其中可能包含提示词、上下文和 AI 回复，仅在本地显示。</p></div>
                <button id="blai-ai-monitor-clear" class="blai-feedback-heading-action" type="button"><i class="fas fa-eraser" aria-hidden="true"></i><span>清空记录</span></button>
            </header>
            <pre id="blai-ai-monitor-output" class="blai-feedback-log-output" tabindex="0" aria-label="AI 上下文"></pre>
        </section>
    `;
    content.querySelector('#blai-ai-monitor-output').textContent = formatAiCommunicationRecords();
}

function diagnosticSummaryRows(record) {
    const summary = record?.summary || {};
    const rows = [
        ['时间', record?.endedAt],
        ['时长', Number.isFinite(record?.durationMs) ? `${record.durationMs} ms` : '—'],
        ['处理模式', record?.mode?.processingMode || '—'],
        ['终止阶段', record?.terminalStage || '—'],
        ['结果', record?.outcome || '—'],
    ];
    if (record?.failureCode) rows.push(['失败代码', record.failureCode]);
    rows.push(
        ['扫描项', summary.scannedItemCount ?? '—'],
        ['受影响项', summary.affectedItemCount ?? '—'],
        ['已应用项', summary.appliedItemCount ?? '—'],
        ['失败项', summary.failedItemCount ?? '—'],
    );
    if (Object.hasOwn(summary, 'failedAiRequestCount')) {
        rows.push(['AI 请求失败', summary.failedAiRequestCount]);
    }
    return rows;
}

function diagnosticSlot(slot, title, record) {
    if (!record) {
        return `
            <section class="blai-feedback-diagnostic-record" data-diagnostic-slot="${slot}">
                <h3>${escapeHtml(title)}</h3>
                <p class="blai-feedback-no-record">暂无记录</p>
            </section>
        `;
    }
    return `
        <section class="blai-feedback-diagnostic-record" data-diagnostic-slot="${slot}">
            <div class="blai-feedback-diagnostic-heading">
                <h3>${escapeHtml(title)}</h3>
                <button type="button" data-feedback-expand-diagnostic="${slot}" aria-expanded="false" aria-label="展开安全 JSON" title="展开安全 JSON">展开</button>
            </div>
            <dl>
                ${diagnosticSummaryRows(record).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
            </dl>
            <pre data-feedback-diagnostic-json="${slot}" tabindex="0" hidden></pre>
        </section>
    `;
}

export function renderDeepCleanDiagnostics(slots = {}) {
    const content = document.getElementById('blai-feedback-workspace-content');
    if (!content) return;
    content.innerHTML = `
        <div class="blai-feedback-diagnostics-view">
            <header class="blai-feedback-diagnostics-intro">
                <div>
                    <h2>深度清理诊断</h2>
                    <p>仅显示本地保存的安全执行信息。</p>
                </div>
                <button id="blai-feedback-clear-deep-clean" class="blai-feedback-heading-action" type="button"><i class="fas fa-eraser" aria-hidden="true"></i><span>清空记录</span></button>
            </header>
            ${diagnosticSlot('latestFailure', '最近一次失败', slots.latestFailure)}
            ${diagnosticSlot('previousFailure', '上一次失败', slots.previousFailure)}
            ${diagnosticSlot('lastSuccess', '最近一次成功', slots.lastSuccess)}
        </div>
    `;
}

// 反馈与诊断是底部导航里的一个页面：显示状态由 .page-panel[data-page="feedback"].active 决定，
// 因此这里不再维护 aria-hidden，只切换当前视图与按钮态。
export function openFeedbackWorkspace(view) {
    const workspace = document.getElementById('blai-feedback-workspace');
    if (!workspace) return;
    workspace.dataset.feedbackView = view;
    workspace.querySelectorAll('[data-feedback-view]').forEach((button) => {
        const active = button.dataset.feedbackView === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-selected', String(active));
    });
}

export function renderFeedbackPreview(payloadJson, attachments = []) {
    const section = document.getElementById('blai-feedback-preview-section');
    const output = document.getElementById('blai-feedback-preview-json');
    if (!section || !output) return;
    output.textContent = payloadJson;
    const files = document.getElementById('blai-feedback-preview-files');
    if (files) files.innerHTML = `<h4>所选文件</h4>${attachments.length
        ? `<ul>${attachments.map((file) => `<li>${escapeHtml(file.name)} · ${escapeHtml(file.type)} · ${file.size} bytes</li>`).join('')}</ul>`
        : '<p>未选择文件</p>'}`;
    section.hidden = false;
    document.getElementById('blai-feedback-confirm')?.removeAttribute('checked');
    const confirmation = document.getElementById('blai-feedback-confirm');
    if (confirmation) confirmation.checked = false;
    const submit = document.getElementById('blai-feedback-submit');
    if (submit) submit.disabled = true;
    clearFeedbackSubmissionStatus();
}

export function clearRenderedFeedbackPreview({ preserveSubmissionStatus = false } = {}) {
    const section = feedbackDraftForm?.querySelector('#blai-feedback-preview-section');
    const output = feedbackDraftForm?.querySelector('#blai-feedback-preview-json');
    if (output) output.textContent = '';
    const files = feedbackDraftForm?.querySelector('#blai-feedback-preview-files');
    if (files) files.textContent = '';
    if (section) section.hidden = true;
    const confirmation = feedbackDraftForm?.querySelector('#blai-feedback-confirm');
    if (confirmation) confirmation.checked = false;
    const submit = feedbackDraftForm?.querySelector('#blai-feedback-submit');
    if (submit) submit.disabled = true;
    if (!preserveSubmissionStatus) clearFeedbackSubmissionStatus();
    if (preserveSubmissionStatus && section && feedbackDraftForm?.querySelector('#blai-feedback-submit-status')?.textContent) {
        section.hidden = false;
    }
}

export function setFeedbackSubmitEnabled(enabled) {
    const submit = document.getElementById('blai-feedback-submit');
    if (submit) submit.disabled = !enabled;
}

export function showFeedbackStatus(message, status = '') {
    const element = document.getElementById('blai-feedback-status');
    if (!element) return;
    element.textContent = String(message || '');
    element.dataset.status = status;
}

export function showFeedbackSubmissionStatus(message, status = '') {
    const element = feedbackDraftForm?.querySelector('#blai-feedback-submit-status');
    if (!element) return;
    element.textContent = String(message || '');
    element.dataset.status = status;
}

export function clearFeedbackSubmissionStatus() {
    const element = feedbackDraftForm?.querySelector('#blai-feedback-submit-status');
    if (!element) return;
    element.textContent = '';
    element.dataset.status = '';
}

export function showDeepCleanDiagnosticJson(slot, record, expanded) {
    const output = document.querySelector(`[data-feedback-diagnostic-json="${slot}"]`);
    const button = document.querySelector(`[data-feedback-expand-diagnostic="${slot}"]`);
    if (!output || !button) return;
    output.textContent = expanded ? JSON.stringify(record, null, 2) : '';
    output.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? '收起安全 JSON' : '展开安全 JSON';
}
