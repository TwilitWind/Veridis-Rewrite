/** AI 目标选择与差异呈现共用的纯句子边界。 */
const sentenceTerminators = new Set(['。', '！', '？', '!', '?']);
const sentenceContinuationPunctuation = new Set(['。', '！', '？', '!', '?', '…']);

export function splitTextRangeIntoSentences(text, range) {
    const sentences = [];
    let sentenceStart = range.start;
    let cursor = range.start;
    const pushSentence = (end) => {
        if (sentenceStart < end) sentences.push({ start: sentenceStart, end });
        sentenceStart = end;
    };

    while (cursor < range.end) {
        const char = text[cursor];
        if (char === '\r' || char === '\n') {
            pushSentence(cursor);
            cursor += char === '\r' && text[cursor + 1] === '\n' ? 2 : 1;
            sentenceStart = cursor;
            continue;
        }
        // 单个句末句点与省略号或小数点不同。
        const isPeriodTerminator = char === '.'
            && text[cursor - 1] !== '.'
            && text[cursor + 1] !== '.'
            && (cursor + 1 === range.end || /[\s”’」』）)*]/u.test(text[cursor + 1]));
        if (sentenceTerminators.has(char) || isPeriodTerminator) {
            let end = cursor + 1;
            while (end < range.end && sentenceContinuationPunctuation.has(text[end])) end += 1;
            pushSentence(end);
            cursor = end;
            continue;
        }
        cursor += 1;
    }
    pushSentence(range.end);
    return sentences;
}

