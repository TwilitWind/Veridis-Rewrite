/** v1 的分块：evidence。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { parseShujukuIsolatedData, hasShujukuTopLevelLegacyTableEvidence, hasShujukuV1TableEvidence, hasShujukuV2TableEvidence, isSupportedLateShujukuV1Slot } from '../../storageEvidence.js';

export const ISOLATED_FIELD = 'TavernDB_ACU_IsolatedData';
export const SCOPED_CONFIG_FIELD = 'TavernDB_ACU_ScopedConfig';
export const SHEET_GUIDE_FIELD = 'TavernDB_ACU_InternalSheetGuide';
export const LEGACY_CLEANUP_FIELDS = [
    'TavernDB_ACU_IndependentData',
    'TavernDB_ACU_Data',
    'TavernDB_ACU_SummaryData',
    'TavernDB_ACU_ModifiedKeys',
    'TavernDB_ACU_UpdateGroupKeys',
    'TavernDB_ACU_Identity',
];
export const SETTINGS_NAMESPACE = 'shujuku_v120__userscript_settings_v1';
export const PROFILE_SETTINGS_PREFIX = 'shujuku_v120_profile_v1';

export function isRecord(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
}

export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function readRecord(value, label, { optional = true } = {}) {
    if (value === undefined || value === null || value === '') {
        if (optional) return null;
        throw new Error(`${label} is missing`);
    }
    if (isRecord(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (isRecord(parsed)) return parsed;
        } catch {
            // 权威的持久化值已损坏。
        }
    }
    throw new Error(`${label} is invalid`);
}

export function readIsolatedData(message) {
    const raw = message?.[ISOLATED_FIELD];
    if (raw === undefined || raw === null || raw === '') return null;
    const isolatedData = parseShujukuIsolatedData(raw);
    if (isolatedData) return isolatedData;
    throw new Error('Deep Clean Shujuku isolated storage is invalid');
}

export function inspectLateV1Evidence(chat) {
    if (!Array.isArray(chat)) throw new Error('Deep Clean Shujuku V1 requires a Chat Branch');
    const refsByIsolation = new Map();
    const v1Evidence = new Set();
    const v2Evidence = new Set();
    for (let messageIndex = 1; messageIndex < chat.length; messageIndex += 1) {
        const message = chat[messageIndex];
        if (!isRecord(message) || message.is_user === true) continue;
        if (hasShujukuTopLevelLegacyTableEvidence(message)) {
            throw new Error(`Deep Clean Shujuku old top-level legacy storage is unsupported: message ${messageIndex}`);
        }
        const isolatedData = readIsolatedData(message);
        if (!isolatedData) continue;
        for (const [isolationKey, slot] of Object.entries(isolatedData)) {
            if (hasShujukuV2TableEvidence(slot)) {
                v2Evidence.add(isolationKey);
                continue;
            }
            if (!hasShujukuV1TableEvidence(slot)) continue;
            v1Evidence.add(isolationKey);
            if (!isSupportedLateShujukuV1Slot(slot)) {
                throw new Error(`Deep Clean Shujuku V1 slot shape is unsupported: ${isolationKey}/message ${messageIndex}`);
            }
            if (!refsByIsolation.has(isolationKey)) refsByIsolation.set(isolationKey, []);
            refsByIsolation.get(isolationKey).push({ messageIndex, slot });
        }
    }
    v1Evidence.forEach((isolationKey) => {
        if (v2Evidence.has(isolationKey)) {
            throw new Error(`Deep Clean Shujuku V1 rejects mixed V1/V2 evidence: ${isolationKey}`);
        }
    });
    if (refsByIsolation.size === 0) return null;
    if (refsByIsolation.size > 1) {
        throw new Error('Deep Clean Shujuku V1 rejects multiple late-V1 isolation migrations in one Chat Branch');
    }
    const [isolationKey, refs] = refsByIsolation.entries().next().value;
    return { isolationKey, refs };
}

export function parseOwnedContainer(chat, chatId, field) {
    const metadata = isRecord(chat[0]?.chat_metadata) ? chat[0].chat_metadata : {};
    const owner = String(metadata[`${field}__chatId`] ?? '').trim();
    let metadataContainer = null;
    if (!owner || owner === String(chatId || '')) {
        metadataContainer = readRecord(metadata[field], `Deep Clean Shujuku ${field}`);
    }
    const firstMessage = isRecord(chat[1]) ? chat[1] : null;
    const legacyContainer = readRecord(firstMessage?.[field], `Deep Clean Shujuku legacy ${field}`);
    if (!metadataContainer) return legacyContainer ? cloneJson(legacyContainer) : null;
    if (!legacyContainer) return cloneJson(metadataContainer);
    const merged = cloneJson(metadataContainer);
    for (const [key, value] of Object.entries(legacyContainer)) {
        if (key === 'version') continue;
        if (isRecord(value) && isRecord(merged[key])) {
            for (const [slotKey, slotValue] of Object.entries(value)) {
                if (!Object.prototype.hasOwnProperty.call(merged[key], slotKey)) {
                    merged[key][slotKey] = cloneJson(slotValue);
                }
            }
        } else if (!Object.prototype.hasOwnProperty.call(merged, key)) {
            merged[key] = cloneJson(value);
        }
    }
    return merged;
}

function normalizePlacement(raw, fallback) {
    const source = isRecord(raw) ? raw : {};
    const rawPosition = String(source.position ?? '').trim().toLowerCase();
    let position = fallback.position;
    if (rawPosition === 'at_depth_as_system' || rawPosition === 'system') position = 'at_depth_as_system';
    else if (['before_char', 'before_character', 'before_character_definition', '0'].includes(rawPosition)) position = 'before_character_definition';
    else if (['after_char', 'after_character', 'after_character_definition', '1'].includes(rawPosition)) position = 'after_character_definition';
    const depth = Number.parseInt(source.depth, 10);
    const order = Number.parseInt(source.order, 10);
    return {
        position,
        depth: Number.isFinite(depth) ? depth : fallback.depth,
        order: Number.isFinite(order) ? order : fallback.order,
    };
}

function fixedPlacementDefaults(tableName) {
    const name = String(tableName || '').trim();
    if (name === '总结表') return { entry: { position: 'at_depth_as_system', depth: 9999, order: 99987 }, index: { position: 'at_depth_as_system', depth: 9999, order: 99988 } };
    if (name === '总体大纲') return { entry: { position: 'at_depth_as_system', depth: 9998, order: 99985 }, index: { position: 'at_depth_as_system', depth: 9998, order: 99986 } };
    if (name === '重要人物表') return { entry: { position: 'at_depth_as_system', depth: 10000, order: 99983 }, index: { position: 'at_depth_as_system', depth: 10000, order: 99984 } };
    if (name === '全局数据表' || name === '全局表') return { entry: { position: 'before_character_definition', depth: 2, order: 99981 }, index: { position: 'before_character_definition', depth: 2, order: 99982 } };
    return { entry: { position: 'at_depth_as_system', depth: 2, order: 99990 }, index: { position: 'at_depth_as_system', depth: 2, order: 99991 } };
}

function normalizeExportConfig(value, tableName) {
    const fixed = fixedPlacementDefaults(tableName);
    const base = {
        enabled: false,
        splitByRow: false,
        entryName: tableName || '',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: `${tableName || '表格'}-索引`,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        sqlInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
        fixedEntryPlacement: fixed.entry,
        fixedIndexPlacement: fixed.index,
    };
    const raw = isRecord(value) ? value : {};
    return {
        ...base,
        ...cloneJson(raw),
        entryPlacement: normalizePlacement(raw.entryPlacement, base.entryPlacement),
        extraIndexPlacement: normalizePlacement(raw.extraIndexPlacement, base.extraIndexPlacement),
        fixedEntryPlacement: normalizePlacement(raw.fixedEntryPlacement, base.fixedEntryPlacement),
        fixedIndexPlacement: normalizePlacement(raw.fixedIndexPlacement, base.fixedIndexPlacement),
    };
}

function normalizeGlobalInjectionConfig(value) {
    const raw = isRecord(value) ? value : {};
    return {
        readableEntryPlacement: normalizePlacement(raw.readableEntryPlacement, { position: 'before_character_definition', depth: 2, order: 99981 }),
        wrapperPlacement: normalizePlacement(raw.wrapperPlacement, { position: 'before_character_definition', depth: 2, order: 99980 }),
    };
}

export function sortedGuideKeys(guide) {
    return Object.keys(guide).filter((key) => key.startsWith('sheet_')).sort((left, right) => {
        const leftOrder = Number.isFinite(guide[left]?.orderNo) ? Math.trunc(guide[left].orderNo) : Number.POSITIVE_INFINITY;
        const rightOrder = Number.isFinite(guide[right]?.orderNo) ? Math.trunc(guide[right].orderNo) : Number.POSITIVE_INFINITY;
        return leftOrder - rightOrder || left.localeCompare(right);
    });
}

export function normalizeGuideData(source) {
    if (!isRecord(source)) return null;
    const sourceKeys = Object.keys(source).filter((key) => key.startsWith('sheet_'));
    if (sourceKeys.length === 0) return null;
    const mate = isRecord(source.mate) ? cloneJson(source.mate) : { type: 'chatSheets', version: 2 };
    if (!mate.type) mate.type = 'chatSheets';
    mate.version = Number.isFinite(mate.version) ? Math.max(2, Math.trunc(mate.version)) : 2;
    mate.globalInjectionConfig = normalizeGlobalInjectionConfig(mate.globalInjectionConfig);
    const guide = { mate };
    sourceKeys.forEach((sheetKey) => {
        const sheet = source[sheetKey];
        if (!isRecord(sheet)) throw new Error(`Deep Clean Shujuku V1 Guide sheet is invalid: ${sheetKey}`);
        const header = Array.isArray(sheet.content?.[0]) ? cloneJson(sheet.content[0]) : [null];
        const name = sheet.name || sheetKey;
        const normalized = {
            uid: sheet.uid || sheetKey,
            name,
            sourceData: isRecord(sheet.sourceData) ? cloneJson(sheet.sourceData) : { note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
            content: [header],
            updateConfig: isRecord(sheet.updateConfig)
                ? cloneJson(sheet.updateConfig)
                : { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
            exportConfig: normalizeExportConfig(sheet.exportConfig, name),
        };
        const seedRows = Array.isArray(sheet.seedRows) ? sheet.seedRows : sheet._seedRows;
        if (Array.isArray(seedRows)) normalized.seedRows = cloneJson(seedRows);
        if (sheet.orderNo !== undefined) normalized.orderNo = sheet.orderNo;
        guide[sheetKey] = normalized;
    });
    return guide;
}

export function buildGuideFromTemplate(templateSource) {
    let template = templateSource;
    if (typeof templateSource === 'string') {
        try {
            template = JSON.parse(templateSource);
        } catch {
            return null;
        }
    }
    if (!isRecord(template)) return null;
    const copy = cloneJson(template);
    const keys = Object.keys(copy).filter((key) => key.startsWith('sheet_'));
    if (keys.length === 0) return null;
    const usedOrders = new Set();
    let rebuildOrder = false;
    keys.forEach((key) => {
        const order = copy[key]?.orderNo;
        if (!Number.isFinite(order) || usedOrders.has(Math.trunc(order))) rebuildOrder = true;
        else usedOrders.add(Math.trunc(order));
    });
    keys.forEach((key, index) => {
        const sheet = copy[key];
        if (!isRecord(sheet)) throw new Error(`Deep Clean Shujuku V1 template sheet is invalid: ${key}`);
        if (rebuildOrder) sheet.orderNo = index;
        if (Array.isArray(sheet.content) && sheet.content.length > 1) sheet.seedRows = cloneJson(sheet.content.slice(1));
    });
    return normalizeGuideData(copy);
}

export function readNamedTemplatePreset(context, presetName) {
    const normalizedName = String(presetName ?? '').trim() === '__ACU_DEFAULT_TEMPLATE_PRESET__'
        ? ''
        : String(presetName ?? '').trim();
    if (!normalizedName) return null;
    const extensionSettings = context?.extensionSettings;
    const namespace = extensionSettings?.__userscripts?.[SETTINGS_NAMESPACE];
    if (!isRecord(namespace)) return null;
    const store = readRecord(namespace.shujuku_v120_templatePresets_v1, 'Deep Clean Shujuku template preset store');
    const preset = isRecord(store?.presets) ? store.presets[normalizedName] : null;
    return typeof preset?.templateStr === 'string' && preset.templateStr.trim() ? preset.templateStr : null;
}

export function readProfileTemplate(context, isolationKey) {
    const extensionSettings = context?.extensionSettings;
    if (!isRecord(extensionSettings)) {
        throw new Error('Deep Clean Shujuku V1 cannot read authoritative Shujuku settings');
    }
    const namespace = extensionSettings.__userscripts?.[SETTINGS_NAMESPACE];
    if (!isRecord(namespace)) {
        throw new Error('Deep Clean Shujuku V1 Shujuku settings namespace is unavailable');
    }
    const slot = isolationKey ? encodeURIComponent(isolationKey) : '__default__';
    const template = namespace[`${PROFILE_SETTINGS_PREFIX}__${slot}__template`];
    if (template === undefined || template === null || template === '') return null;
    return template;
}

