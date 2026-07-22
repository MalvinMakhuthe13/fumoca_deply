/**
 * FUMOCA Decoder Worker Wrapper
 * Spawns fumoc-decoder-worker-module.js as a plain worker.
 * The worker is self-contained — no imports needed.
 */

class FumocDecoderWorker {
  constructor() {
    this._worker  = new Worker('/js/modules/fumoc-decoder-worker-module.js');
    this._resolve = null;
    this._reject  = null;
    this._onProgress = null;

    this._worker.onmessage = (e) => {
      const { type, pct, label, message } = e.data;
      if (type === 'progress') {
        this._onProgress?.(pct, label);
      } else if (type === 'result') {
        this._resolve?.({
          splatBinary:  e.data.splatBinary,
          header:       e.data.header,
          thumbnail:    e.data.thumbnail,
          N:            e.data.N,
        });
        this._resolve = null;
      } else if (type === 'error') {
        this._reject?.(new Error(message));
        this._reject = null;
      }
    };

    this._worker.onerror = (e) => {
      console.error('[FumocDecoderWorker] error:', e.message);
      this._reject?.(new Error(e.message));
    };
  }

  decode(buffer, onProgress) {
    this._onProgress = onProgress || null;
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;
      // Transfer buffer to worker — zero copy
      this._worker.postMessage({ buffer }, [buffer]);
    });
  }

  terminate() { this._worker.terminate(); }
}

window.FumocDecoderWorker = FumocDecoderWorker;
export default FumocDecoderWorker;
