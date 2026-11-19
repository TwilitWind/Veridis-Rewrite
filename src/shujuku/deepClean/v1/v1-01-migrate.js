/**
 * v1.js 拆分产物（migrate）：13 个顶层声明，14945 字节 / 300 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { projectLateV1ShujukuCells } from '../replay.js';
import { SCOPED_CONFIG_FIELD, SHEET_GUIDE_FIELD, isRecord, parseOwnedContainer, normalizeGuideData, buildGuideFromTemplate, readNamedTemplatePreset, readProfileTemplate, cloneJson, sortedGuideKeys, inspectLateV1Evidence, SETTINGS_NAMESPACE, PROFILE_SETTINGS_PREFIX, readRecord } from './v1-00-evidence.js';

export function resolveGuide(chat, chatId, isolationKey, context) {
    const guideContainer = parseOwnedContainer(chat, chatId, SHEET_GUIDE_FIELD);
    const guideSlot = isRecord(guideContainer?.tags) ? guideContainer.tags[isolationKey] : null;
    const guideMode = typeof guideSlot?.templateScopeMode === 'string' && guideSlot.templateScopeMode.trim()
        ? guideSlot.templateScopeMode
        : 'chat_override';
    if (isRecord(guideSlot) && guideMode === 'chat_override') {
        const guide = normalizeGuideData(guideSlot.data);
        if (guide) return guide;
        throw new Error(`Deep Clean Shujuku V1 chat Guide is invalid: ${isolationKey}`);
    }

    const scoped = parseOwnedContainer(chat, chatId, SCOPED_CONFIG_FIELD);
    const scopedState = isRecord(scoped?.template) ? scoped.template[isolationKey] : null;
    if (isRecord(scopedState)) {
        const mode = scopedState.mode === undefined || scopedState.mode === 'inherit_global'
            ? 'inherit_global'
            : scopedState.mode;
        if (mode === 'preset_link') {
            const templateSource = readNamedTemplatePreset(context, scopedState.presetName);
            const guide = buildGuideFromTemplate(templateSource);
            if (!guide) {
                throw new Error(`Deep Clean Shujuku V1 cannot resolve a preset-linked Guide read-only: ${isolationKey}`);
            }
            return guide;
        }
        if (mode === 'chat_override') {
            if (typeof scopedState.templateStr !== 'string' || !scopedState.templateStr.trim()) {
                throw new Error(`Deep Clean Shujuku V1 chat template is unavailable: ${isolationKey}`);
            }
            const guide = normalizeGuideData(scopedState.guideData) || buildGuideFromTemplate(scopedState.templateStr);
            if (!guide) throw new Error(`Deep Clean Shujuku V1 chat template is invalid: ${isolationKey}`);
            return guide;
        }
        if (mode !== 'inherit_global') {
            throw new Error(`Deep Clean Shujuku V1 template scope is unsupported: ${isolationKey}`);
        }
    }

    const guide = buildGuideFromTemplate(readProfileTemplate(context, isolationKey));
    if (!guide) throw new Error(`Deep Clean Shujuku V1 inherited profile template is unavailable: ${isolationKey}`);
    return guide;
}

function canonicalDisplayName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function isSheetAllowed(sheetKey, sheet, guide, allowedKeys) {
    if (allowedKeys.has(sheetKey)) return true;
    const name = canonicalDisplayName(sheet?.name);
    return !!name && [...allowedKeys].some((key) => canonicalDisplayName(guide[key]?.name) === name);
}

export function applyDelta(base, delta, sheetKey) {
    if (!isRecord(delta) || !Array.isArray(delta.rowDeltas)
        || (delta.metaChanged !== undefined && !isRecord(delta.metaChanged))
        || (delta.structureChanged !== undefined && delta.structureChanged !== false)) {
        throw new Error(`Deep Clean Shujuku V1 delta is invalid: ${sheetKey}`);
    }
    const result = cloneJson(base);
    if (delta.metaChanged) {
        ['name', 'orderNo', 'updateConfig', 'exportConfig', 'sourceData'].forEach((field) => {
            if (delta.metaChanged[field] !== undefined) result[field] = cloneJson(delta.metaChanged[field]);
        });
    }
    if (!Array.isArray(result.content)) throw new Error(`Deep Clean Shujuku V1 delta base is invalid: ${sheetKey}`);
    const rowIndexes = new Map();
    result.content.forEach((row, index) => {
        if (Array.isArray(row) && row[0]) rowIndexes.set(row[0], index);
    });
    const deletes = new Set();
    delta.rowDeltas.forEach((rowDelta) => {
        if (!isRecord(rowDelta) || (rowDelta.op !== 'delete' && rowDelta.op !== 'upsert')) {
            throw new Error(`Deep Clean Shujuku V1 row delta is invalid: ${sheetKey}`);
        }
        const rowId = rowDelta.row_id;
        if (typeof rowId !== 'string' || !rowId || rowId === 'row_id') {
            throw new Error(`Deep Clean Shujuku V1 row delta has no canonical row_id: ${sheetKey}`);
        }
        const index = rowIndexes.get(rowId);
        if (rowDelta.op === 'delete') {
            if (index !== undefined) deletes.add(index);
            return;
        }
        if (!Array.isArray(rowDelta.cells) || rowDelta.cells[0] !== rowId) {
            throw new Error(`Deep Clean Shujuku V1 upsert row identity is invalid: ${sheetKey}/${rowId}`);
        }
        if (index !== undefined) result.content[index] = cloneJson(rowDelta.cells);
        else {
            result.content.push(cloneJson(rowDelta.cells));
            rowIndexes.set(rowId, result.content.length - 1);
        }
    });
    [...deletes].sort((left, right) => right - left).forEach((index) => result.content.splice(index, 1));
    return result;
}

export function normalizeLegacyUpdateConfig(state) {
    Object.entries(state).forEach(([sheetKey, sheet]) => {
        if (!sheetKey.startsWith('sheet_') || !isRecord(sheet?.updateConfig) || sheet.updateConfig.uiSentinel === -1) return;
        ['contextDepth', 'updateFrequency', 'batchSize', 'skipFloors'].forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(sheet.updateConfig, field) && sheet.updateConfig[field] === 0) {
                sheet.updateConfig[field] = -1;
            }
        });
        sheet.updateConfig.uiSentinel = -1;
    });
}

export function overlayGuide(state, guide) {
    const historicalByName = new Map();
    Object.entries(state).forEach(([sheetKey, sheet]) => {
        if (!sheetKey.startsWith('sheet_') || !isRecord(sheet)) return;
        const name = canonicalDisplayName(sheet.name);
        if (!name) throw new Error(`Deep Clean Shujuku V1 sheet has no canonical display name: ${sheetKey}`);
        const keys = historicalByName.get(name) || [];
        keys.push(sheetKey);
        historicalByName.set(name, keys);
    });
    const projected = { mate: cloneJson(guide.mate) };
    const matchedHistorical = new Set();
    for (const sheetKey of sortedGuideKeys(guide)) {
        const guideSheet = guide[sheetKey];
        const name = canonicalDisplayName(guideSheet?.name);
        if (!name) throw new Error(`Deep Clean Shujuku V1 Guide sheet has no canonical display name: ${sheetKey}`);
        const historicalKeys = historicalByName.get(name) || [];
        if (historicalKeys.length > 1) {
            throw new Error(`Deep Clean Shujuku V1 Guide sheet identity is ambiguous: ${sheetKey}`);
        }
        if (historicalKeys.length === 0) {
            projected[sheetKey] = cloneJson(guideSheet);
            continue;
        }
        const historicalKey = historicalKeys[0];
        if (historicalKey !== sheetKey) {
            throw new Error(`Deep Clean Shujuku V1 Sheet key requires identity migration: ${historicalKey}/${sheetKey}`);
        }
        matchedHistorical.add(historicalKey);
        const next = cloneJson(state[historicalKey]);
        next.uid = sheetKey;
        if (guideSheet.name) next.name = guideSheet.name;
        if (guideSheet.sourceData) next.sourceData = cloneJson(guideSheet.sourceData);
        if (guideSheet.updateConfig) next.updateConfig = cloneJson(guideSheet.updateConfig);
        if (guideSheet.exportConfig) next.exportConfig = cloneJson(guideSheet.exportConfig);
        const header = Array.isArray(guideSheet.content?.[0]) ? cloneJson(guideSheet.content[0]) : null;
        if (!header || header[0] !== 'row_id') {
            throw new Error(`Deep Clean Shujuku V1 Guide header requires repair: ${sheetKey}`);
        }
        const historicalHeader = Array.isArray(next.content?.[0]) ? next.content[0] : null;
        if (!historicalHeader || JSON.stringify(historicalHeader) !== JSON.stringify(header)) {
            throw new Error(`Deep Clean Shujuku V1 header requires structural repair or renaming: ${sheetKey}`);
        }
        next.content[0] = header;
        for (let rowIndex = 1; rowIndex < next.content.length; rowIndex += 1) {
            const row = next.content[rowIndex];
            if (!Array.isArray(row)) throw new Error(`Deep Clean Shujuku V1 row shape is invalid: ${sheetKey}/${rowIndex}`);
            if (row.length > header.length) {
                throw new Error(`Deep Clean Shujuku V1 row exceeds the Guide header: ${sheetKey}/${rowIndex}`);
            }
            while (row.length < header.length) row.push(null);
        }
        if (Number.isFinite(guideSheet.orderNo)) next.orderNo = Math.trunc(guideSheet.orderNo);
        if (Array.isArray(guideSheet.seedRows)) next.seedRows = cloneJson(guideSheet.seedRows);
        projected[sheetKey] = next;
    }
    const unmatched = Object.keys(state).filter((key) => key.startsWith('sheet_') && !matchedHistorical.has(key));
    if (unmatched.length > 0) {
        throw new Error(`Deep Clean Shujuku V1 Sheet identity cannot be resolved by the Guide: ${unmatched.join(', ')}`);
    }
    return projected;
}

export function assertCleanRows(state) {
    const sheetKeys = Object.keys(state).filter((key) => key.startsWith('sheet_'));
    if (sheetKeys.length === 0) throw new Error('Deep Clean Shujuku V1 reconstruction has no Sheet');
    sheetKeys.forEach((sheetKey) => {
        const sheet = state[sheetKey];
        if (!isRecord(sheet) || !Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])
            || sheet.content[0].length === 0 || sheet.content[0][0] !== 'row_id') {
            throw new Error(`Deep Clean Shujuku V1 header requires repair: ${sheetKey}`);
        }
        const header = sheet.content[0];
        const headerNames = header.map((value) => String(value ?? '').trim());
        if (headerNames.some((value) => !value) || new Set(headerNames).size !== headerNames.length) {
            throw new Error(`Deep Clean Shujuku V1 physical column mapping is ambiguous: ${sheetKey}`);
        }
        const ids = new Set();
        const inspectRows = (rows, pool, offset) => {
            rows.forEach((row, index) => {
                if (!Array.isArray(row) || row.length !== header.length) {
                    throw new Error(`Deep Clean Shujuku V1 ${pool} row width is invalid: ${sheetKey}/${index + offset}`);
                }
                const rowId = typeof row[0] === 'string' ? row[0].trim() : '';
                if (!rowId || row[0] !== rowId || ids.has(rowId)) {
                    throw new Error(`Deep Clean Shujuku V1 ${pool} row_id requires repair: ${sheetKey}/${index + offset}`);
                }
                ids.add(rowId);
            });
        };
        inspectRows(sheet.content.slice(1), 'content', 1);
        if (sheet.seedRows !== undefined) {
            if (!Array.isArray(sheet.seedRows)) throw new Error(`Deep Clean Shujuku V1 seedRows is invalid: ${sheetKey}`);
            inspectRows(sheet.seedRows, 'seedRows', 0);
        }
    });
}

export async function reconstructLateV1(chat, options = {}) {
    const evidence = inspectLateV1Evidence(chat);
    if (!evidence) return null;
    const guide = resolveGuide(chat, options.chatId, evidence.isolationKey, options.context);
    const allowedKeys = new Set(sortedGuideKeys(guide));
    const state = {};
    const found = new Set();
    const pendingDeltas = [];
    for (let index = evidence.refs.length - 1; index >= 0; index -= 1) {
        const ref = evidence.refs[index];
        if (ref.slot._acu_storage_mode === 'delta') {
            if (Object.keys(ref.slot.incrementalData).length > 0) pendingDeltas.push(ref);
            continue;
        }
        Object.entries(ref.slot.independentData).forEach(([sheetKey, sheet]) => {
            if (!sheetKey.startsWith('sheet_') || !isRecord(sheet)) return;
            if (!isSheetAllowed(sheetKey, sheet, guide, allowedKeys) || found.has(sheetKey)) return;
            state[sheetKey] = cloneJson(sheet);
            found.add(sheetKey);
        });
    }
    pendingDeltas.reverse();
    pendingDeltas.forEach((ref) => {
        Object.entries(ref.slot.incrementalData).forEach(([sheetKey, delta]) => {
            if (!allowedKeys.has(sheetKey)) return;
            if (!state[sheetKey]) {
                throw new Error(`Deep Clean Shujuku V1 delta has no exact Sheet checkpoint: ${sheetKey}/message ${ref.messageIndex}`);
            }
            state[sheetKey] = applyDelta(state[sheetKey], delta, sheetKey);
        });
    });
    normalizeLegacyUpdateConfig(state);
    const projected = overlayGuide(state, guide);
    assertCleanRows(projected);
    await projectLateV1ShujukuCells(projected, evidence.isolationKey);
    return { ...evidence, state: projected };
}

function normalizeSkip(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

export function readGlobalSkipUpdateFloors(context, isolationKey) {
    const extensionSettings = context?.extensionSettings;
    if (!isRecord(extensionSettings)) {
        throw new Error('Deep Clean Shujuku V1 migration cannot read authoritative Shujuku settings');
    }
    const namespace = extensionSettings.__userscripts?.[SETTINGS_NAMESPACE];
    if (!isRecord(namespace)) {
        throw new Error('Deep Clean Shujuku V1 migration settings namespace is unavailable');
    }
    const slot = isolationKey ? encodeURIComponent(isolationKey) : '__default__';
    const profileKey = `${PROFILE_SETTINGS_PREFIX}__${slot}__settings`;
    if (!Object.prototype.hasOwnProperty.call(namespace, profileKey)) {
        throw new Error(`Deep Clean Shujuku V1 migration target profile settings are missing: ${slot}`);
    }
    const settings = readRecord(
        namespace[profileKey],
        `Deep Clean Shujuku V1 migration target profile settings (${slot})`,
        { optional: false },
    );
    return normalizeSkip(settings.skipUpdateFloors);
}

export function resolveEffectiveSkip(state, inheritedSkip) {
    let skip = normalizeSkip(inheritedSkip);
    Object.entries(state).forEach(([sheetKey, sheet]) => {
        if (!sheetKey.startsWith('sheet_')) return;
        const raw = sheet?.updateConfig?.skipFloors;
        if (Number.isFinite(raw) && raw >= 0) skip = Math.max(skip, normalizeSkip(raw));
    });
    return skip;
}

export function migrationTarget(chat, skip) {
    const assistants = [];
    for (let messageIndex = 1; messageIndex < chat.length; messageIndex += 1) {
        if (isRecord(chat[messageIndex]) && chat[messageIndex].is_user !== true) assistants.push(messageIndex);
    }
    if (assistants.length === 0) throw new Error('Deep Clean Shujuku V1 migration has no assistant Message target');
    return assistants[Math.max(0, assistants.length - 1 - normalizeSkip(skip))];
}

export function countAiFloor(chat, branchMessageIndex) {
    let count = 0;
    for (let index = 1; index <= branchMessageIndex && index < chat.length; index += 1) {
        if (isRecord(chat[index]) && chat[index].is_user !== true) count += 1;
    }
    return count;
}

