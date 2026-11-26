// 负责角色卡持久化与保存后的实时角色同步，包括内嵌的角色世界书条目。

import { getSillyTavernContextSnapshot } from '../../host/context.js';
import { cloneJson, isRecord, postJson, postResponse } from './io.js';

async function readCharacter(fetchImpl, context, characterKey) {
    const character = await postJson(
        fetchImpl,
        context,
        '/api/characters/get',
        { avatar_url: characterKey },
        `Deep Clean Character read failed for ${characterKey}`,
    );
    if (!isRecord(character) || !isRecord(character.data)) {
        throw new Error(`Deep Clean Character response is invalid for ${characterKey}`);
    }
    return character;
}

function characterValue(data, change) {
    const locator = change.locator;
    if (change.kind === 'character-description' && locator.field === 'data.description') return data.description;
    if (change.kind === 'character-personality' && locator.field === 'data.personality') return data.personality;
    if (change.kind === 'character-first-message' && locator.field === 'data.first_mes') return data.first_mes;
    if (change.kind === 'character-alternate-greeting') {
        const index = locator.alternateGreetingIndex;
        return Array.isArray(data.alternate_greetings) && Number.isInteger(index)
            ? data.alternate_greetings[index]
            : undefined;
    }
    if (change.kind === 'embedded-world-book-entry') {
        const entries = data.character_book?.entries;
        if (!Array.isArray(entries) || !Number.isInteger(locator.entryId)) return undefined;
        const matches = entries.filter((entry) => isRecord(entry) && entry.id === locator.entryId);
        return matches.length === 1 ? matches[0].content : undefined;
    }
    return undefined;
}

function findCharacterLiveMirror(characterKey) {
    const context = getSillyTavernContextSnapshot();
    const matches = Array.isArray(context.characters)
        ? context.characters.filter((character) => isRecord(character) && character.avatar === characterKey)
        : [];
    if (matches.length !== 1 || !isRecord(matches[0].data)) {
        throw new Error(`Deep Clean Character live mirror is missing or duplicated: ${characterKey}`);
    }
    return matches[0];
}

function syncCharacterLiveMirror(live, changes, verified) {
    const kinds = new Set(changes.map((change) => change.kind));
    if (kinds.has('character-description')) {
        live.description = verified.description;
        live.data.description = verified.data.description;
    }
    if (kinds.has('character-personality')) {
        live.personality = verified.personality;
        live.data.personality = verified.data.personality;
    }
    if (kinds.has('character-first-message')) {
        live.first_mes = verified.first_mes;
        live.data.first_mes = verified.data.first_mes;
    }
    if (kinds.has('character-alternate-greeting')) {
        live.data.alternate_greetings = cloneJson(verified.data.alternate_greetings);
    }
    if (kinds.has('embedded-world-book-entry')) {
        if (!isRecord(live.data.character_book)) live.data.character_book = {};
        live.data.character_book.entries = cloneJson(verified.data.character_book.entries);
    }
}

/**
 * 绑定世界书写入后，把同名内嵌条目同步成外部世界书的最新内容。
 * 只覆盖原本就存在的同名条目，不新增或删除角色卡条目，避免误伤用户数据。
 */
export async function syncEmbeddedWorldBookEntries(fetchImpl, context, worldBookKey, externalEntries) {
    const contextSnapshot = context || getSillyTavernContextSnapshot();
    const boundCharacters = (Array.isArray(contextSnapshot?.characters) ? contextSnapshot.characters : [])
        .filter((character) => isRecord(character) && isRecord(character.data)
            && character.data.extensions?.world === worldBookKey
            && typeof character.avatar === 'string' && character.avatar);
    if (boundCharacters.length === 0) return 0;

    const externalByComment = new Map();
    for (const entry of Object.values(isRecord(externalEntries) ? externalEntries : {})) {
        if (isRecord(entry) && typeof entry.comment === 'string' && typeof entry.content === 'string') {
            externalByComment.set(entry.comment, entry.content);
        }
    }
    if (externalByComment.size === 0) return 0;

    let synced = 0;
    for (const live of boundCharacters) {
        const characterKey = live.avatar;
        const character = await readCharacter(fetchImpl, contextSnapshot, characterKey);
        const entries = character.data.character_book?.entries;
        if (!Array.isArray(entries)) continue;
        let dirty = false;
        for (const entry of entries) {
            if (!isRecord(entry) || !externalByComment.has(entry.comment)) continue;
            const next = externalByComment.get(entry.comment);
            if (entry.content !== next) {
                entry.content = next;
                dirty = true;
            }
        }
        if (!dirty) continue;
        await postResponse(
            fetchImpl,
            contextSnapshot,
            '/api/characters/merge-attributes',
            { avatar: characterKey, data: { character_book: { entries } } },
            `Deep Clean bound World Book sync failed for ${characterKey}`,
        );
        const verified = await readCharacter(fetchImpl, contextSnapshot, characterKey);
        const verifiedEntries = verified.data.character_book?.entries;
        if (!Array.isArray(verifiedEntries)) {
            throw new Error(`Deep Clean bound World Book sync verification failed for ${characterKey}`);
        }
        for (let index = 0; index < entries.length; index += 1) {
            if (verifiedEntries[index]?.content !== entries[index].content) {
                throw new Error(`Deep Clean bound World Book sync verification failed for ${characterKey}/${index}`);
            }
        }
        if (isRecord(live.data.character_book)) {
            live.data.character_book.entries = cloneJson(verifiedEntries);
        }
        synced += 1;
    }
    return synced;
}

export async function applyCharacterUnit(fetchImpl, context, characterKey, changes) {
    const liveCharacter = findCharacterLiveMirror(characterKey);
    const character = await readCharacter(fetchImpl, context, characterKey);
    const data = character.data;
    const update = { avatar: characterKey, data: {} };
    let alternateGreetings = null;
    let embeddedEntries = null;

    for (const change of changes) {
        if (characterValue(data, change) !== change.originalText) {
            throw new Error(`Deep Clean Character Item changed after Freeze: ${characterKey}/${change.kind}`);
        }
        if (change.kind === 'character-description') update.data.description = change.reviewedText;
        else if (change.kind === 'character-personality') update.data.personality = change.reviewedText;
        else if (change.kind === 'character-first-message') update.data.first_mes = change.reviewedText;
        else if (change.kind === 'character-alternate-greeting') {
            alternateGreetings ??= cloneJson(data.alternate_greetings);
            alternateGreetings[change.locator.alternateGreetingIndex] = change.reviewedText;
        } else if (change.kind === 'embedded-world-book-entry') {
            embeddedEntries ??= cloneJson(data.character_book.entries);
            const matches = embeddedEntries.filter((entry) => isRecord(entry) && entry.id === change.locator.entryId);
            if (matches.length !== 1) {
                throw new Error(`Deep Clean embedded World Book entry is missing or duplicated: ${characterKey}/${change.locator.entryId}`);
            }
            matches[0].content = change.reviewedText;
        } else {
            throw new Error(`Deep Clean Character Item kind is unsupported: ${change.kind}`);
        }
    }
    if (alternateGreetings) update.data.alternate_greetings = alternateGreetings;
    if (embeddedEntries) update.data.character_book = { entries: embeddedEntries };

    await postResponse(
        fetchImpl,
        context,
        '/api/characters/merge-attributes',
        update,
        `Deep Clean Character save failed for ${characterKey}`,
    );
    const verified = await readCharacter(fetchImpl, context, characterKey);
    for (const change of changes) {
        if (characterValue(verified.data, change) !== change.reviewedText) {
            throw new Error(`Deep Clean Character post-save verification failed: ${characterKey}/${change.kind}`);
        }
    }
    syncCharacterLiveMirror(liveCharacter, changes, verified);
}
