/** 每次比较一个可取消的按需 worker；没有持久缓存，也没有主线程回退。 */
function runComparison(kind, payload, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        let worker;
        const finish = (error, result) => {
            signal?.removeEventListener('abort', abort);
            if (worker) {
                worker.onmessage = worker.onerror = worker.onmessageerror = null;
                worker.terminate();
            }
            if (error) reject(error);
            else resolve(result);
        };
        const abort = () => finish(signal.reason);
        try {
            worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
            worker.onerror = (event) => {
                event.preventDefault();
                finish(new Error(event.message || 'Difference worker failed'));
            };
            worker.onmessageerror = () => finish(new Error('Difference worker returned an unreadable result'));
            signal?.addEventListener('abort', abort, { once: true });
            worker.postMessage({ kind, ...payload });
        } catch (error) {
            finish(error);
        }
    });
}

export function renderDiffDocumentInBackground(pairs, mode, { signal } = {}) {
    return runComparison('document', { pairs, mode }, signal);
}

export function compareTextPairsInBackground(pairs, { signal } = {}) {
    return runComparison('pairs', { pairs }, signal);
}
