/** lifecycle 的分块：selection。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { defaultAiRewriteSettings, extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { deepCleanRuntimeState } from '../state.js';
import { logger } from '../../log.js';
import { loadDeepCleanResourceInventory } from '../inventory.js';
import { getZhVariantCompatOptions, isZhDictionaryRuntimeReady } from '../../zh/dictionary.js';
import { cancelDeepCleanReviewComparisons } from '../review.js';
import { createDeepCleanSafeDiagnostic, recordDeepCleanFailure } from '../diagnostics.js';
import { getSillyTavernContextSnapshot } from '../../host/context.js';
import { readDeepCleanContentItems } from '../contentItems.js';
import { normalizeScopeTagMode } from '../../scope/model.js';

export const reviewBatchCharacterLimit = 90_000;
export const programDirectBatchCharacterLimit = 100_000;

export function assertLateV1FitsOneApplyBatch(input, contentItems, affectedItemIndexes) {
    const characterLimit = input.processingMode === 'program' && input.programApplyPolicy === 'direct'
        ? programDirectBatchCharacterLimit
        : reviewBatchCharacterLimit;
    const ownerBatch = new Map();
    let batchIndex = 0;
    let batchItemCount = 0;
    let sourceCharacterCount = 0;
    for (const itemIndex of affectedItemIndexes) {
        const item = contentItems[itemIndex];
        const itemLength = item.originalText.length;
        if (batchItemCount > 0 && sourceCharacterCount + itemLength > characterLimit) {
            batchIndex += 1;
            batchItemCount = 0;
            sourceCharacterCount = 0;
        }
        if (item.kind === 'shujuku-cell' && item.storageProtocol === 'v1') {
            const locator = item.locator || {};
            const owner = `${locator.characterKey}\u0000${locator.chatId}\u0000${locator.isolationKey}`;
            const existingBatch = ownerBatch.get(owner);
            if (existingBatch !== undefined && existingBatch !== batchIndex) {
                throw new Error(`Deep Clean Shujuku V1 Cells exceed one Apply batch: ${locator.characterKey}/${locator.chatId}/${locator.isolationKey}`);
            }
            ownerBatch.set(owner, batchIndex);
        }
        batchItemCount += 1;
        sourceCharacterCount += itemLength;
    }
}

// 深度净化限定为当前角色的世界书加该角色的聊天记录。
// 角色卡正文、其他角色、Persona、其他世界书与 Shujuku 单元格均不在范围内。
function selectedResourceKeys(inventory, selectedChatKeys) {
    const characterKey = inventory.current.groupChat ? '' : inventory.current.characterKey;
    if (!characterKey) {
        return { characterKeys: [], chatKeys: [], personaKeys: [], worldBookKeys: [] };
    }
    const characterChats = inventory.chats.filter((chat) => chat.characterKey === characterKey);
    const knownChatKeys = new Set(characterChats.map((chat) => chat.key));
    const chatKeys = (Array.isArray(selectedChatKeys) ? selectedChatKeys : [])
        .filter((key) => knownChatKeys.has(key))
        .filter((key, index, values) => values.indexOf(key) === index);
    const worldBookKeys = inventory.worldBooks
        .filter((worldBook) => worldBook.characterKeys.includes(characterKey))
        .map((worldBook) => worldBook.worldBookKey);
    return {
        characterKeys: [characterKey],
        chatKeys: chatKeys.length > 0 ? chatKeys : (inventory.current.chatKey ? [inventory.current.chatKey] : []),
        personaKeys: [],
        worldBookKeys,
    };
}

export async function startDeepCleanRun() {
    deepCleanRuntimeState.deepCleanPhase = 'initial-selection';
    deepCleanRuntimeState.deepCleanSelection = null;
    const inventory = await loadDeepCleanResourceInventory();
    const settings = getAppContext().extension_settings?.[extensionName] ?? {};
    const presetNames = Object.keys(settings.presets ?? {});
    const activePreset = String(settings.activePreset || '');
    deepCleanRuntimeState.deepCleanSelection = {
        inventory,
        scopeCharacterKey: inventory.current.groupChat ? '' : inventory.current.characterKey,
        presetName: presetNames.includes(activePreset) ? activePreset : (presetNames[0] || ''),
        processingMode: 'program',
        programApplyPolicy: 'direct',
        includeHidden: true,
        ...selectedResourceKeys(inventory, []),
    };
    logger.info('[Deep Clean] initial-selection');
    return deepCleanRuntimeState.deepCleanSelection;
}

export function getDeepCleanInitialSelection() {
    return deepCleanRuntimeState.deepCleanPhase === 'initial-selection'
        ? deepCleanRuntimeState.deepCleanSelection
        : null;
}

/** 从扫描结果返回资源选择：保留已勾选项与本地设置，只丢弃冻结的扫描/预览会话。 */
export function returnToDeepCleanSelection() {
    const selection = deepCleanRuntimeState.deepCleanSelection;
    if (!selection) return null;
    deepCleanRuntimeState.deepCleanPhase = 'initial-selection';
    selection.run = null;
    selection.previewSession = null;
    selection.currentReviewSession = null;
    return selection;
}

export function setDeepCleanFinalSelection(kind, keys) {
    const selection = getDeepCleanInitialSelection();
    const propertyByKind = {
        chat: 'chatKeys',
        'world-book': 'worldBookKeys',
    };
    const sourceByKind = {
        chat: ['chats', 'key'],
        'world-book': ['worldBooks', 'worldBookKey'],
    };
    const property = propertyByKind[kind];
    const source = sourceByKind[kind];
    if (!selection || !property || !source) return null;
    selection[property] = (Array.isArray(keys) ? keys : [])
        .filter((key, index, values) => (
            typeof key === 'string'
            && values.indexOf(key) === index
            && selection.inventory[source[0]].some((item) => item[source[1]] === key)
        ));
    return selection;
}

export function setDeepCleanLocalOption(option, value) {
    const selection = getDeepCleanInitialSelection();
    if (!selection) return null;
    if (option === 'presetName') {
        const presetName = String(value || '');
        const presets = getAppContext().extension_settings?.[extensionName]?.presets ?? {};
        if (Object.hasOwn(presets, presetName)) selection.presetName = presetName;
    }
    if (option === 'processingMode' && (value === 'program' || value === 'program-ai')) {
        selection.processingMode = value;
    }
    if (option === 'includeHidden') {
        selection.includeHidden = value === true;
    }
    return selection;
}

export function freezeValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    if (value instanceof RegExp) return value;
    Object.values(value).forEach((entry) => freezeValue(entry));
    return Object.freeze(value);
}

function frozenRunInput(selection, settings) {
    const preset = settings?.presets?.[selection.presetName];
    if (!preset) throw new Error('Deep Clean selected preset no longer exists');
    const globalAiSettings = { ...defaultAiRewriteSettings, ...(settings.aiRewrite || {}) };
    const chats = selection.chatKeys.map((key) => {
        const chat = selection.inventory.chats.find((item) => item.key === key);
        if (!chat) throw new Error(`Deep Clean selected Chat no longer exists: ${key}`);
        return { characterKey: chat.characterKey, chatId: chat.chatId };
    });
    return freezeValue({
        presetName: selection.presetName,
        preset: structuredClone(preset),
        processingMode: selection.processingMode,
        programApplyPolicy: selection.programApplyPolicy,
        aiConnection: {
            baseUrl: String(globalAiSettings.baseUrl || '').trim(),
            apiKey: String(globalAiSettings.apiKey || ''),
            model: String(globalAiSettings.model || '').trim(),
        },
        characterKeys: [...selection.characterKeys],
        chatKeys: [...selection.chatKeys],
        chats,
        personaKeys: [...selection.personaKeys],
        worldBookKeys: [...selection.worldBookKeys],
        includeCharacterText: false,
        includeShujuku: false,
        includeHidden: selection.includeHidden === true,
        processingSemantics: {
            scopeTags: structuredClone(settings.scopeTags || []),
            scopeTagBuiltinDismissed: structuredClone(settings.scopeTagBuiltinDismissed || []),
            scopeTagMode: normalizeScopeTagMode(settings.scopeTagMode),
            zhVariantCompatEnabled: settings.zhVariantCompatEnabled === true,
            zhVariantCompatOptions: structuredClone(getZhVariantCompatOptions(settings)),
            zhVariantDictionaryReady: isZhDictionaryRuntimeReady(),
            aiProtectXmlComments: settings.aiRewrite?.protectXmlComments === true,
        },
    });
}

/** 把预览页的取消项与 AI 预览缓存落实到本次运行；正式处理只走未取消的命中条目。 */
export function applyDeepCleanPreviewSelection(lifecycle, skippedItemIndexes, aiCache, revertedBlocks = null) {
    if (!lifecycle?.run?.scanResult) return null;
    const skipped = skippedItemIndexes instanceof Set
        ? new Set(skippedItemIndexes)
        : new Set(Array.isArray(skippedItemIndexes) ? skippedItemIndexes : []);
    lifecycle.run.revertedBlocks = revertedBlocks instanceof Map
        ? new Map([...revertedBlocks].map(([key, value]) => [key, new Set(value)]))
        : new Map();
    lifecycle.skippedItemIndexes = skipped;
    lifecycle.affectedItemIndexes = lifecycle.run.scanResult.affectedItemIndexes
        .filter((itemIndex) => !skipped.has(itemIndex));
    lifecycle.nextAffectedItemCursor = 0;
    lifecycle.previewAiCache = aiCache instanceof Map ? aiCache : null;
    return lifecycle;
}

export function markDeepCleanStopped(lifecycle) {
    lifecycle.stopRequested = true;
    lifecycle.reviewController?.abort();
    cancelDeepCleanReviewComparisons(lifecycle.currentReviewSession);
    lifecycle.currentReviewSession = null;
    lifecycle.lookahead = null;
    lifecycle.diagnosticStartedAt = null;
    if (deepCleanRuntimeState.deepCleanSelection === lifecycle) {
        deepCleanRuntimeState.deepCleanSelection = null;
    }
    deepCleanRuntimeState.deepCleanPhase = 'stopped';
}

export function deriveDeepCleanCompletionSummary(lifecycle) {
    const run = lifecycle?.run;
    if (!run?.input || !run.scanResult || !Array.isArray(lifecycle.processedRuns)) {
        throw new Error('Deep Clean completion summary state is unavailable');
    }

    const appliedItemIndexes = new Set();
    const failedItemIndexes = new Set();
    for (const applyResult of lifecycle.applyResults) {
        for (const unitResult of applyResult.unitResults) {
            if (unitResult.status === 'applied') {
                unitResult.itemIndexes.forEach((itemIndex) => appliedItemIndexes.add(itemIndex));
            }
            if (unitResult.status === 'failed') {
                unitResult.itemIndexes.forEach((itemIndex) => failedItemIndexes.add(itemIndex));
            }
        }
    }

    let aiFailedItemIndexes = null;
    let oversizedItemIndexes = null;
    let totalAiRequestCount = null;
    let failedAiRequestCount = null;
    let aiFailureReasons = [];
    if (run.input.processingMode === 'program-ai') {
        aiFailedItemIndexes = new Set();
        oversizedItemIndexes = new Set();
        totalAiRequestCount = 0;
        failedAiRequestCount = 0;
        for (const processedRun of lifecycle.processedRuns) {
            totalAiRequestCount += processedRun.aiRequestPlan.requests.length;
            failedAiRequestCount += processedRun.aiFailedRequestIndexes.length;
            processedRun.aiFailedItemIndexes.forEach((itemIndex) => aiFailedItemIndexes.add(itemIndex));
            processedRun.aiRequestPlan.oversizedItemIndexes.forEach((itemIndex) => oversizedItemIndexes.add(itemIndex));
            aiFailureReasons = aiFailureReasons.concat(processedRun.aiFailureReasons || []);
        }
        aiFailedItemIndexes.forEach((itemIndex) => failedItemIndexes.add(itemIndex));
    }

    const affectedItemIndexes = new Set(run.scanResult.affectedItemIndexes);
    const skippedItemIndexes = new Set(lifecycle.skippedItemIndexes || []);
    const selectedAffectedItemIndexes = [...affectedItemIndexes].filter((itemIndex) => !skippedItemIndexes.has(itemIndex));
    const retainedOriginalItemCount = selectedAffectedItemIndexes.filter((itemIndex) => (
        !appliedItemIndexes.has(itemIndex) && !failedItemIndexes.has(itemIndex)
    )).length;
    const summary = {
        characterResourceCount: run.input.characterKeys.length,
        chatBranchResourceCount: run.input.chats.length,
        scannedItemCount: run.scanResult.scannedItemCount,
        affectedItemCount: run.scanResult.affectedItemCount,
        selectedItemCount: selectedAffectedItemIndexes.length,
        skippedItemCount: skippedItemIndexes.size,
        appliedItemCount: appliedItemIndexes.size,
        retainedOriginalItemCount,
        failedItemCount: failedItemIndexes.size,
        unprocessedItemCount: 0,
    };

    if (run.input.processingMode === 'program-ai') {
        Object.assign(summary, {
            totalAiRequestCount,
            successfulAiRequestCount: totalAiRequestCount - failedAiRequestCount,
            failedAiRequestCount,
            aiFailedOriginalItemCount: aiFailedItemIndexes.size,
            oversizedAiItemCount: oversizedItemIndexes.size,
            aiFailureReasons: aiFailureReasons.slice(0, 5),
        });
    }

    return summary;
}

export function finalizeDeepCleanFailure(lifecycle, terminalStage, failureCode, values = {}) {
    if (!Number.isFinite(lifecycle?.diagnosticStartedAt)) return null;
    const startedAt = lifecycle.diagnosticStartedAt;
    lifecycle.diagnosticStartedAt = null;
    try {
        const input = values.input || lifecycle.run?.input || null;
        const scanResult = values.scanResult || lifecycle.run?.scanResult || null;
        const summary = values.summary || (lifecycle.run?.scanResult ? deriveDeepCleanCompletionSummary(lifecycle) : null);
        const record = createDeepCleanSafeDiagnostic({
            startedAt,
            outcome: 'failure',
            terminalStage,
            failureCode,
            input,
            scanResult,
            summary,
        });
        recordDeepCleanFailure(record);
        return record;
    } finally {
        markDeepCleanStopped(lifecycle);
        deepCleanRuntimeState.deepCleanPhase = 'error';
    }
}

export async function freezeDeepCleanRun(options = {}) {
    const selection = getDeepCleanInitialSelection();
    if (!selection) return null;
    // 冻结运行必须继承初始选择的全部字段（inventory / chatKeys / presetName 等）。
    // 否则「上一步」拿到的只是一个裸 lifecycle，renderDeepCleanInitialSelection 读
    // inventory.current 会抛错，页面停在扫描结果而状态已回到 initial-selection，
    // 上一步与预览就都点不动了。
    const lifecycle = {
        ...selection,
        run: null,
        nextAffectedItemCursor: 0,
        affectedItemIndexes: null,
        skippedItemIndexes: new Set(),
        previewAiCache: null,
        previewSession: null,
        currentReviewSession: null,
        lookahead: null,
        stopRequested: false,
        applyResults: [],
        processedRuns: [],
        diagnosticStartedAt: Date.now(),
    };
    deepCleanRuntimeState.deepCleanPhase = 'frozen';
    deepCleanRuntimeState.deepCleanSelection = lifecycle;
    let input = null;
    try {
        const settings = getAppContext().extension_settings?.[extensionName] ?? {};
        input = frozenRunInput(selection, settings);
        options.onProgress?.({ stage: 'read', current: 0, total: input.characterKeys.length + input.chats.length + input.personaKeys.length + input.worldBookKeys.length });
        const context = getSillyTavernContextSnapshot();
        const contentItems = await readDeepCleanContentItems(input, {
            context,
            fetchImpl: globalThis.fetch?.bind(globalThis),
            onProgress: ({ current, total }) => options.onProgress?.({ stage: 'read', current, total }),
            shouldStop: () => lifecycle.stopRequested,
        });
        if (lifecycle.stopRequested) {
            markDeepCleanStopped(lifecycle);
            return null;
        }
        lifecycle.run = freezeValue({ input, contentItems });
        logger.info(`[Deep Clean] frozen content items=${contentItems.length}`);
        return lifecycle;
    } catch (error) {
        if (lifecycle.stopRequested) return null;
        if (deepCleanRuntimeState.deepCleanSelection !== lifecycle) throw error;
        finalizeDeepCleanFailure(lifecycle, 'read', 'read_failed', { input });
        throw error;
    }
}

