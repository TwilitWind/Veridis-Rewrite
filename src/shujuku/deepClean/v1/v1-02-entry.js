/** v1 的分块：entry。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { hasShujukuV2TableEvidence, shujukuLegacyMessageMatchesIsolation } from '../../storageEvidence.js';
import { projectLateV1ShujukuCells } from '../replay.js';
import { isRecord, readIsolatedData, ISOLATED_FIELD, LEGACY_CLEANUP_FIELDS, cloneJson } from './v1-00-evidence.js';
import { countAiFloor, reconstructLateV1, readGlobalSkipUpdateFloors, resolveEffectiveSkip, migrationTarget } from './v1-01-migrate.js';

function noteSchedule(summary, sheetKey, aiFloor, changed) {
    if (!summary[sheetKey]) summary[sheetKey] = {};
    summary[sheetKey].lastFilledAiFloor = Math.max(summary[sheetKey].lastFilledAiFloor || 0, aiFloor);
    if (changed) summary[sheetKey].lastChangedAiFloor = Math.max(summary[sheetKey].lastChangedAiFloor || 0, aiFloor);
}

export function collectMigrationEvidence(chat, isolationKey, state, targetMessageIndex) {
    const allowed = new Set(Object.keys(state).filter((key) => key.startsWith('sheet_')));
    const scheduleSummary = {};
    const sourceMessageIndices = [];
    const sourceAiFloors = [];
    for (let messageIndex = 1; messageIndex <= targetMessageIndex; messageIndex += 1) {
        const message = chat[messageIndex];
        if (!isRecord(message) || message.is_user === true) continue;
        const slot = readIsolatedData(message)?.[isolationKey];
        if (!isRecord(slot) || hasShujukuV2TableEvidence(slot)) continue;
        const dataKeys = isRecord(slot.independentData) ? Object.keys(slot.independentData).filter((key) => allowed.has(key)) : [];
        const deltaKeys = isRecord(slot.incrementalData) ? Object.keys(slot.incrementalData).filter((key) => allowed.has(key)) : [];
        const modified = Array.isArray(slot.modifiedKeys) ? [...new Set(slot.modifiedKeys.filter((key) => allowed.has(key)))] : [];
        const groups = Array.isArray(slot.updateGroupKeys) ? [...new Set(slot.updateGroupKeys.filter((key) => allowed.has(key)))] : [];
        if (dataKeys.length + deltaKeys.length + modified.length + groups.length === 0) continue;
        const aiFloor = countAiFloor(chat, messageIndex);
        groups.forEach((key) => noteSchedule(scheduleSummary, key, aiFloor, false));
        modified.forEach((key) => noteSchedule(scheduleSummary, key, aiFloor, true));
        deltaKeys.forEach((key) => noteSchedule(scheduleSummary, key, aiFloor, true));
        if (groups.length === 0 && modified.length === 0 && deltaKeys.length === 0) {
            dataKeys.forEach((key) => noteSchedule(scheduleSummary, key, aiFloor, true));
        }
        sourceMessageIndices.push(messageIndex - 1);
        sourceAiFloors.push(aiFloor);
    }
    if (sourceMessageIndices.length === 0) {
        throw new Error('Deep Clean Shujuku V1 migration target precedes all authoritative V1 source evidence');
    }
    return { scheduleSummary, sourceMessageIndices, sourceAiFloors };
}

export async function readLateShujukuV1Cells(chat, options = {}) {
    const replay = await reconstructLateV1(chat, options);
    if (!replay) return [];
    const globalSkip = readGlobalSkipUpdateFloors(options.context, replay.isolationKey);
    const effectiveSkip = resolveEffectiveSkip(replay.state, globalSkip);
    const targetMessageIndex = migrationTarget(chat, effectiveSkip);
    collectMigrationEvidence(chat, replay.isolationKey, replay.state, targetMessageIndex);
    return projectLateV1ShujukuCells(replay.state, replay.isolationKey);
}

export function fingerprint(value) {
    const text = JSON.stringify(value, (_key, item) => {
        if (!isRecord(item)) return item;
        return Object.keys(item).sort().reduce((result, key) => {
            result[key] = item[key];
            return result;
        }, {});
    });
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function validateFrozenTargets(cells, changes, isolationKey) {
    const byIdentity = new Map(cells.map((cell) => [
        `${cell.sheetKey}\u0000${cell.rowId}\u0000${cell.columnKey}`,
        cell,
    ]));
    const seen = new Set();
    changes.forEach((change) => {
        const locator = change.locator || {};
        if (change.storageProtocol !== 'v1' || locator.isolationKey !== isolationKey) {
            throw new Error('Deep Clean Shujuku V1 Apply received a mismatched storage protocol or isolation key');
        }
        const identity = `${locator.sheetKey}\u0000${locator.rowId}\u0000${locator.columnKey}`;
        if (seen.has(identity)) throw new Error(`Deep Clean Shujuku V1 Cell locator is duplicated: ${identity}`);
        seen.add(identity);
        const cell = byIdentity.get(identity);
        if (!cell || cell.originalText !== change.originalText) {
            throw new Error(`Deep Clean Shujuku V1 Cell changed after Freeze: ${locator.sheetKey}/${locator.rowId}/${locator.columnKey}`);
        }
    });
}

export function cleanLegacyFields(chat, isolationKey) {
    const changed = new Set();
    for (let messageIndex = 1; messageIndex < chat.length; messageIndex += 1) {
        const message = chat[messageIndex];
        if (!isRecord(message) || message.is_user === true) continue;
        const isolatedData = readIsolatedData(message);
        if (isolatedData && Object.prototype.hasOwnProperty.call(isolatedData, isolationKey)) {
            const slot = isolatedData[isolationKey];
            if (!hasShujukuV2TableEvidence(slot)) {
                const next = cloneJson(isolatedData);
                delete next[isolationKey];
                if (Object.keys(next).length === 0) delete message[ISOLATED_FIELD];
                else message[ISOLATED_FIELD] = next;
                changed.add(messageIndex);
            }
        }
        if (shujukuLegacyMessageMatchesIsolation(message, isolationKey)) {
            let removed = false;
            LEGACY_CLEANUP_FIELDS.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(message, field)) {
                    delete message[field];
                    removed = true;
                }
            });
            if (removed) changed.add(messageIndex);
        }
    }
    return changed;
}

export async function prepareLateShujukuV1Migration(chat, changes, options = {}) {
    const replay = await reconstructLateV1(chat, options);
    if (!replay) throw new Error('Deep Clean Shujuku V1 fresh reconstruction is unavailable');
    const cells = await projectLateV1ShujukuCells(replay.state, replay.isolationKey);
    validateFrozenTargets(cells, changes, replay.isolationKey);

    const globalSkip = readGlobalSkipUpdateFloors(options.context, replay.isolationKey);
    const effectiveSkip = resolveEffectiveSkip(replay.state, globalSkip);
    const targetMessageIndex = migrationTarget(chat, effectiveSkip);
    const evidence = collectMigrationEvidence(chat, replay.isolationKey, replay.state, targetMessageIndex);
    const migratedAt = Date.now();
    const targetAiFloor = countAiFloor(chat, targetMessageIndex);
    const dataFingerprint = fingerprint(replay.state);
    const migrationProvenance = {
        version: 1,
        legacyDataFingerprint: dataFingerprint,
        legacySourceMessageIndices: evidence.sourceMessageIndices,
        legacySourceAiFloors: evidence.sourceAiFloors,
        legacyLastChangedAiFloorBySheet: Object.fromEntries(
            Object.entries(evidence.scheduleSummary)
                .filter(([, value]) => Number.isInteger(value.lastChangedAiFloor) && value.lastChangedAiFloor >= 0)
                .map(([sheetKey, value]) => [sheetKey, value.lastChangedAiFloor]),
        ),
        targetMessageIndex: targetMessageIndex - 1,
        targetAiFloor,
        isolationKey: replay.isolationKey,
        migratedAt,
    };
    const checkpoint = {
        kind: 'full',
        createdAt: migratedAt,
        reason: 'migration',
        data: cloneJson(replay.state),
        scheduleSummary: cloneJson(evidence.scheduleSummary),
        migrationProvenance: cloneJson(migrationProvenance),
    };
    const targetMessage = chat[targetMessageIndex];
    const existingTargetSlot = readIsolatedData(targetMessage)?.[replay.isolationKey];
    const changedMessageIndexes = cleanLegacyFields(chat, replay.isolationKey);
    const isolatedData = readIsolatedData(targetMessage) || {};
    isolatedData[replay.isolationKey] = {
        ...(existingTargetSlot?.summaryVectorIndexState !== undefined ? { summaryVectorIndexState: cloneJson(existingTargetSlot.summaryVectorIndexState) } : {}),
        ...(existingTargetSlot?.summaryVectorIndexManifest !== undefined ? { summaryVectorIndexManifest: cloneJson(existingTargetSlot.summaryVectorIndexManifest) } : {}),
        storageFrame: {
            version: 2,
            headRevision: `checkpoint:migration:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
            checkpoint,
            logEntries: [],
        },
        migrationAuditBackup: {
            version: 1,
            createdAt: migratedAt,
            sourceData: cloneJson(replay.state),
            dataFingerprintBefore: dataFingerprint,
            dataFingerprintAfter: dataFingerprint,
            auditStatus: 'clean',
            issues: [],
            repairPlan: [],
            idRemap: [],
        },
        _acu_storage_version: 2,
    };
    targetMessage[ISOLATED_FIELD] = isolatedData;
    changedMessageIndexes.add(targetMessageIndex);
    return {
        isolationKey: replay.isolationKey,
        changedMessageIndexes: [...changedMessageIndexes].sort((left, right) => left - right),
    };
}

