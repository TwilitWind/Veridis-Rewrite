/** replay 的分块：entry。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { cloneJson, isRecord, readShujukuIsolatedData, collectFrameRefs, latestFullCheckpointIndex, assertCurrentWriterReplaySegment, assertCanonicalSheet } from './replay-00-sqlText.js';
import { replayIsolationSlot, describeStateSchemas, projectBusinessColumns, compareText, compareCellIdentity, generateCurrentV2EntryId } from './replay-05-apply.js';

function countPersistedAiFloor(chat, targetMessageIndex) {
    let count = 0;
    for (let index = 1; index <= targetMessageIndex && index < chat.length; index += 1) {
        if (chat[index] && !chat[index].is_user) count += 1;
    }
    return count;
}

export async function applyIsolationCellChanges(chat, isolationKey, changes) {
    const frameRefs = collectFrameRefs(chat, isolationKey);
    const baseIndex = latestFullCheckpointIndex(frameRefs);
    if (baseIndex < 0) {
        throw new Error(`Deep Clean Shujuku current-v2 replay is unavailable: ${isolationKey}`);
    }
    assertCurrentWriterReplaySegment(frameRefs, baseIndex);

    const replay = await replayIsolationSlot(frameRefs, baseIndex);
    const schemas = await describeStateSchemas(replay.state);
    const targets = [];
    const cellKeys = new Set();

    for (const change of changes) {
        const locator = change.locator || {};
        const sheetKey = String(locator.sheetKey || '');
        const rowId = String(locator.rowId || '').trim();
        const columnKey = String(locator.columnKey || '');
        const cellKey = `${sheetKey}\u0000${rowId}\u0000${columnKey}`;
        if (!sheetKey.startsWith('sheet_') || !rowId || !columnKey || cellKeys.has(cellKey)) {
            throw new Error(`Deep Clean Shujuku Cell locator is invalid or duplicated: ${sheetKey}/${rowId}/${columnKey}`);
        }
        cellKeys.add(cellKey);

        const sheet = replay.state[sheetKey];
        if (replay.lifecycle.get(sheetKey) !== 'active' || !isRecord(sheet)) {
            throw new Error(`Deep Clean Shujuku target sheet is not active: ${sheetKey}`);
        }
        assertCanonicalSheet(sheet, sheetKey);
        const columns = projectBusinessColumns(sheet, schemas.get(sheetKey) || []);
        const column = columns?.find((candidate) => candidate.physicalName === columnKey);
        if (!column) throw new Error(`Deep Clean Shujuku physical column is missing: ${sheetKey}/${columnKey}`);

        const rows = sheet.content.slice(1).filter((row) => String(row?.[0] ?? '').trim() === rowId);
        if (rows.length !== 1) {
            throw new Error(`Deep Clean Shujuku canonical row is missing or duplicated: ${sheetKey}/${rowId}`);
        }
        const row = rows[0];
        if (typeof row[column.sourceIndex] !== 'string' || row[column.sourceIndex] !== change.originalText) {
            throw new Error(`Deep Clean Shujuku Cell changed after Freeze: ${sheetKey}/${rowId}/${columnKey}`);
        }
        targets.push({ change, sheetKey, rowId, columnKey, row, columnIndex: column.sourceIndex });
    }

    targets.forEach((target) => {
        target.row[target.columnIndex] = target.change.reviewedText;
    });

    const changedRows = new Map();
    targets.forEach((target) => {
        changedRows.set(`${target.sheetKey}\u0000${target.rowId}`, {
            kind: 'row_upsert',
            sheetKey: target.sheetKey,
            rowId: target.rowId,
            cells: cloneJson(target.row),
        });
    });
    const operations = [...changedRows.values()].sort((left, right) => (
        compareText(left.sheetKey, right.sheetKey) || compareText(left.rowId, right.rowId)
    ));
    const writeSet = targets
        .map((target) => ({ kind: 'cell', sheetKey: target.sheetKey, rowId: target.rowId, columnKey: target.columnKey }))
        .sort(compareCellIdentity);
    const changedSheetKeys = [...new Set(operations.map((operation) => operation.sheetKey))].sort(compareText);

    const targetRef = frameRefs[frameRefs.length - 1];
    const targetMessageIndex = targetRef?.messageIndex;
    if (!Number.isInteger(targetMessageIndex) || targetMessageIndex <= 0 || !isRecord(chat[targetMessageIndex]) || chat[targetMessageIndex].is_user !== false) {
        throw new Error(`Deep Clean Shujuku append target is invalid: ${isolationKey}`);
    }
    const isolatedData = cloneJson(readShujukuIsolatedData(chat[targetMessageIndex]));
    const frame = isolatedData?.[isolationKey]?.storageFrame;
    if (!isRecord(frame) || frame.version !== 2 || !Array.isArray(frame.logEntries)) {
        throw new Error(`Deep Clean Shujuku append frame is invalid: ${isolationKey}`);
    }

    const seq = Math.max(0, ...frame.logEntries.map((entry) => Number(entry?.seq) || 0)) + 1;
    const entryId = generateCurrentV2EntryId();
    const parentRevision = frame.headRevision ?? null;
    const commitRevision = `${seq}:${entryId}`;
    const runtimeMessageIndex = targetMessageIndex - 1;
    frame.logEntries.push({
        seq,
        entryId,
        createdAt: Date.now(),
        source: 'manual_crud',
        targetMessageIndex: runtimeMessageIndex,
        aiFloor: countPersistedAiFloor(chat, targetMessageIndex),
        filledSheetKeys: [],
        changedSheetKeys,
        groupKeys: [],
        operations,
        baseRevision: parentRevision,
        parentRevision,
        commitRevision,
        writeSet,
    });
    frame.headRevision = commitRevision;
    chat[targetMessageIndex].TavernDB_ACU_IsolatedData = isolatedData;
    if (isolationKey) chat[targetMessageIndex].TavernDB_ACU_Identity = isolationKey;
    else delete chat[targetMessageIndex].TavernDB_ACU_Identity;
    return targetMessageIndex;
}

export async function applyCurrentShujukuV2CellChanges(chat, changes) {
    if (!Array.isArray(chat)) throw new Error('Deep Clean Shujuku Apply requires a fresh Chat Branch');
    const groups = new Map();
    for (const change of Array.isArray(changes) ? changes : []) {
        const isolationKey = change?.locator?.isolationKey;
        if (typeof isolationKey !== 'string') throw new Error('Deep Clean Shujuku Cell has no isolation key');
        if (!groups.has(isolationKey)) groups.set(isolationKey, []);
        groups.get(isolationKey).push(change);
    }
    const changedMessageIndexes = new Set();
    for (const isolationKey of [...groups.keys()].sort(compareText)) {
        changedMessageIndexes.add(await applyIsolationCellChanges(chat, isolationKey, groups.get(isolationKey)));
    }
    return [...changedMessageIndexes].sort((left, right) => left - right);
}

