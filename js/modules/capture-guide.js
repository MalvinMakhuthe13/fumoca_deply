/**
 * FUMOCA Capture Guide v1
 * ══════════════════════════════════════════════════════════════════════════
 * A mobile-first guided capture. Turns "hold your phone and film a car"
 * into a staged, timed, coached walk-around that produces reliably-good
 * footage for gaussian splatting.
 *
 * Why this exists
 * ───────────────
 * Splat reconstruction lives or dies on capture quality. The three most
 * common failures are:
 *   1. User pans too fast → motion blur → COLMAP can't find features
 *   2. User circles inconsistent distance → parallax gaps → weak geometry
 *   3. User stops moving to check phone → gap in frame coverage → holes
 *
 * The guide eliminates all three by:
 *   - Driving the capture with a timed script the user just follows
 *   - Giving live pace/tilt warnings from the real gyroscope (rotation
 *     rate) and orientation sensor (tilt drift from the take's own
 *     baseline) — not just the fixed timer script; see
 *     _bindMotionSensors() for exactly what's measured and why
 *   - Chunking the capture into small stages so the user never has to
 *     hold steady for more than 15 seconds at a time
 *
 * What it does NOT do
 * ───────────────────
 * It does not process the splat. It hands the finished video blob to the
 * existing upload pipeline. It does not fix bad lighting — if the user
 * films a black car in a dark garage, no amount of coaching saves that
 * capture.
 * ══════════════════════════════════════════════════════════════════════════
 */

/**
 * Preset capture scripts. Each script is an array of "stages" — a stage is
 * a short coached instruction of fixed duration. The user advances through
 * stages automatically on a timer; they can pause but not skip.
 *
 * Duration math: exterior takes ~90s total, interior ~60s each. Fits
 * comfortably under the 3-minute mobile memory limit where iOS starts
 * refusing to hold the recording buffer.
 */
export const CAPTURE_SCRIPTS = Object.freeze({
  exterior_car: Object.freeze({
    label: 'Exterior walk-around (car)',
    targetDuration: 90,
    hint: 'Stand arm\'s-length from the car. Walk slowly in a full circle, keeping the car centered in frame.',
    stages: Object.freeze([
      { t: 0,  prompt: 'Start at the front bumper. Phone level, car centered.', sub: 'Hold steady for 2 seconds.' },
      { t: 3,  prompt: 'Walk slowly to the driver side.', sub: 'Keep the car centered. Don\'t rush.' },
      { t: 18, prompt: 'You\'re now at the driver door.', sub: 'Phone slightly lower, capture the door handles.' },
      { t: 28, prompt: 'Continue walking to the rear.', sub: 'Smooth pace. Keep it in frame.' },
      { t: 45, prompt: 'You\'re at the rear. Pan across the boot.', sub: 'Phone at tail-light height.' },
      { t: 55, prompt: 'Continue to the passenger side.', sub: 'Same smooth pace as before.' },
      { t: 72, prompt: 'Passenger side — walk back to the front.', sub: 'You\'re almost done.' },
      { t: 85, prompt: 'Back at the front. Hold 3 seconds to finish.', sub: 'Nice.' },
    ]),
  }),
  interior_front: Object.freeze({
    label: 'Interior front (driver side)',
    targetDuration: 55,
    hint: 'Open the driver door. Phone close to your chest. Move your whole body, not just your wrists.',
    stages: Object.freeze([
      { t: 0,  prompt: 'Phone at driver seat. Start with steering wheel.', sub: 'Hold steady 2 seconds.' },
      { t: 3,  prompt: 'Pan left across the dash.', sub: 'Smooth. Don\'t rush past surfaces.' },
      { t: 15, prompt: 'Move phone to centre console.', sub: 'Capture infotainment and gearstick area.' },
      { t: 28, prompt: 'Pan right to the passenger side dash.', sub: 'Keep distance consistent.' },
      { t: 40, prompt: 'Tilt down to the footwell.', sub: 'Slowly. Avoid your feet in frame.' },
      { t: 50, prompt: 'Finish on the steering wheel.', sub: 'Hold 3 seconds.' },
    ]),
  }),
  interior_rear: Object.freeze({
    label: 'Interior rear (back seats)',
    targetDuration: 40,
    hint: 'Open a rear door. Capture the rear bench and footwell first, then pan forward.',
    stages: Object.freeze([
      { t: 0,  prompt: 'Phone at rear seat level. Hold 2 seconds.', sub: 'Start with the left side of the bench.' },
      { t: 3,  prompt: 'Pan slowly right across the seats.', sub: 'Keep the phone level.' },
      { t: 15, prompt: 'Tilt down to the rear footwell.', sub: 'Capture both sides.' },
      { t: 25, prompt: 'Pan forward through the gap.', sub: 'Show the back of the front seats.' },
      { t: 35, prompt: 'Hold on the headrests 3 seconds.', sub: 'Done.' },
    ]),
  }),
});

/**
 * Main controller — binds to a set of DOM elements the host page provides.
 * This keeps the module render-agnostic: the host (capture.html) owns the
 * layout, we own the behaviour.
 *
 * Required elements (by id):
 *   capVideo      <video>  — live preview
 *   capPrompt     <div>    — main instruction
 *   capSub        <div>    — sub-instruction
 *   capTimer      <div>    — seconds remaining
 *   capProgress   <div>    — stage progress bar (0-100% width)
 *   capStartBtn   <button> — start/stop
 *   capScriptSel  <select> — exterior / interior_front / interior_rear
 */
export class CaptureGuide {
  constructor({ supabase, onUploadComplete, onError } = {}) {
    this.supabase = supabase;
    this.onUploadComplete = onUploadComplete || (() => {});
    this.onError = onError || ((msg) => console.error('[CaptureGuide]', msg));

    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.script = CAPTURE_SCRIPTS.exterior_car;
    this.startTime = 0;
    this.rafId = 0;
    this.state = 'idle'; // 'idle' | 'preview' | 'recording' | 'done'
    this.wakeLock = null;

    this.el = {};
    ['capVideo', 'capPrompt', 'capSub', 'capTimer', 'capProgress',
     'capStartBtn', 'capScriptSel', 'capHint', 'capUploadStatus', 'capMotionWarning']
      .forEach(id => { this.el[id] = document.getElementById(id); });

    // Live sensor feedback state (real device orientation/motion, not a
    // fixed timer script — see _bindMotionSensors below)
    this._motionPermissionGranted = false;
    this._onDeviceMotion = null;
    this._onDeviceOrientation = null;
    this._tiltBaseline = null;   // calibrated at recording start
    this._panWarnUntil = 0;      // timestamp — show "slow down" until this passes
    this._tiltWarnUntil = 0;     // timestamp — show "level phone" until this passes
    this._warnRafId = 0;
  }

  /**
   * Ask for camera permission and set up the live preview. Called from the
   * page's "Get started" button (must be a user-gesture because camera
   * permission requires one on both iOS and Android).
   */
  async startPreview() {
    if (this.state !== 'idle') return;
    // Request motion/orientation sensor access FIRST, before any await —
    // iOS only allows DeviceMotionEvent.requestPermission() inside the
    // synchronous part of a user-gesture handler. Doing this after
    // getUserMedia (which is itself async) can silently fail on iOS.
    await this._requestMotionPermission();
    try {
      // Rear camera, highest available resolution up to 1080p. Asking for
      // higher than 1080 triggers prompt-on-iOS behaviour and produces
      // enormous files with no splat-quality benefit — 1080p is the sweet
      // spot for gaussian-splatting pipelines.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false, // splat pipeline ignores audio; saves size and privacy
      });
      this.el.capVideo.srcObject = this.stream;
      await this.el.capVideo.play();
      this.state = 'preview';
      this._setHint(this.script.hint);
      this._setPrompt('Tap Start when you\'re in position.', 'Stand arm\'s length from the car. Good light.');
      this.el.capStartBtn.textContent = 'Start capture';
      this.el.capStartBtn.disabled = false;
    } catch (err) {
      this.onError('Camera permission denied or camera unavailable: ' + err.message);
      this._setPrompt('Camera access blocked.', 'Go to your browser settings and allow camera for this site, then refresh.');
    }
  }

  /** Host calls this when the script <select> changes. */
  setScript(scriptKey) {
    const s = CAPTURE_SCRIPTS[scriptKey];
    if (!s) return;
    this.script = s;
    this._setHint(s.hint);
  }

  /**
   * Request DeviceMotionEvent / DeviceOrientationEvent access. iOS 13+
   * requires an explicit permission prompt (must run inside a user
   * gesture); other platforms just work. Non-fatal if denied or
   * unsupported — the guide still works via the timed script alone,
   * it just loses the live pace/tilt warnings.
   */
  async _requestMotionPermission() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined'
          && typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission();
        this._motionPermissionGranted = (res === 'granted');
      } else if (typeof DeviceOrientationEvent !== 'undefined') {
        // Non-iOS (or old iOS): no permission gate, sensor "just works"
        // if the device has one — we confirm on first real event instead.
        this._motionPermissionGranted = true;
      }
    } catch (_) {
      this._motionPermissionGranted = false;
    }
  }

  /**
   * Attach live sensor listeners. Called at the start of recording (not
   * preview) so the tilt baseline is calibrated against how the user is
   * actually holding the phone for this take, not an arbitrary earlier
   * moment.
   *
   * Pace: gyroscope rotation rate (deg/s) during panning. Motion blur that
   * kills COLMAP feature matching correlates directly with how fast the
   * phone is rotating while filming — this is a real, direct proxy, not a
   * guess. Sustained rotation above ~50°/s for a beat triggers "slow down".
   *
   * Tilt: device orientation beta (front-back tilt), compared to the
   * angle captured in the first ~500ms of recording as the user's
   * intended baseline. Drifting more than ~22° from that baseline
   * (phone rolling forward/back, framing drifting off the product)
   * triggers "level your phone".
   */
  _bindMotionSensors() {
    if (!this._motionPermissionGranted) return;
    this._tiltBaseline = null;

    const PAN_THRESHOLD_DEG_S = 50;
    const TILT_THRESHOLD_DEG  = 22;
    const WARN_HOLD_MS        = 900; // how long a warning stays up once triggered

    this._onDeviceMotion = (e) => {
      const r = e.rotationRate;
      if (!r) return;
      const mag = Math.sqrt((r.alpha||0)**2 + (r.beta||0)**2 + (r.gamma||0)**2);
      if (mag > PAN_THRESHOLD_DEG_S) {
        this._panWarnUntil = performance.now() + WARN_HOLD_MS;
      }
    };

    this._onDeviceOrientation = (e) => {
      if (e.beta == null) return;
      if (this._tiltBaseline === null) {
        // First reading after recording starts = the user's intended
        // "phone level at arm's length" pose for this take.
        this._tiltBaseline = e.beta;
        return;
      }
      const drift = Math.abs(e.beta - this._tiltBaseline);
      if (drift > TILT_THRESHOLD_DEG) {
        this._tiltWarnUntil = performance.now() + WARN_HOLD_MS;
      }
    };

    window.addEventListener('devicemotion', this._onDeviceMotion);
    window.addEventListener('deviceorientation', this._onDeviceOrientation);
    this._warnLoop();
  }

  _unbindMotionSensors() {
    if (this._onDeviceMotion) window.removeEventListener('devicemotion', this._onDeviceMotion);
    if (this._onDeviceOrientation) window.removeEventListener('deviceorientation', this._onDeviceOrientation);
    this._onDeviceMotion = null;
    this._onDeviceOrientation = null;
    if (this._warnRafId) cancelAnimationFrame(this._warnRafId);
    this._warnRafId = 0;
    if (this.el.capMotionWarning) this.el.capMotionWarning.classList.remove('active');
  }

  /** Drives the on-screen warning badge off the two sensor-derived flags. */
  _warnLoop() {
    if (this.state !== 'recording') return;
    const now = performance.now();
    const panActive  = now < this._panWarnUntil;
    const tiltActive = now < this._tiltWarnUntil;
    const el = this.el.capMotionWarning;
    if (el) {
      if (panActive) {
        el.textContent = '⚠ SLOW DOWN — you\'re panning too fast';
        el.classList.add('active');
      } else if (tiltActive) {
        el.textContent = '⚠ LEVEL YOUR PHONE';
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this._warnRafId = requestAnimationFrame(() => this._warnLoop());
  }

  /** Begin the recording and run the timed coaching loop. */
  async startRecording() {
    if (this.state !== 'preview') return;
    if (!this.stream) {
      this.onError('No camera stream.');
      return;
    }

    // Screen wake lock — phones dim their screen during recording, which
    // makes the on-screen prompts unreadable halfway through. Request a
    // lock so the screen stays on. Silently no-op on browsers without the
    // Wake Lock API (older Safari).
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) {
      // Not worth interrupting the capture for a wake-lock denial.
    }

    // MediaRecorder on iOS Safari supports 'video/mp4' since 14.5 but
    // ignores most MIME hints and emits whatever it prefers. Try common
    // options in order of quality; fall through to no-hint.
    const candidates = [
      'video/mp4;codecs=avc1.42E01E',  // iOS-friendly baseline H.264
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    let mime = '';
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported?.(c)) { mime = c; break; }
    }

    try {
      this.recorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
        : new MediaRecorder(this.stream);
    } catch (err) {
      this.onError('MediaRecorder failed to initialize: ' + err.message);
      return;
    }

    this.chunks = [];
    this.recorder.addEventListener('dataavailable', e => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    });
    this.recorder.addEventListener('stop', () => this._onRecordingStopped(mime));

    this.recorder.start(1000); // 1-second chunks → resilient to abort
    this.startTime = performance.now();
    this.state = 'recording';
    this.el.capStartBtn.textContent = 'Stop';
    this.el.capStartBtn.classList.add('recording');

    this._bindMotionSensors();
    this._tickLoop();
  }

  /**
   * Coaching tick loop — updates the prompt/sub/timer each frame.
   * Uses requestAnimationFrame rather than setInterval for smooth bar
   * animation and automatic pause when the tab is backgrounded.
   */
  _tickLoop() {
    if (this.state !== 'recording') return;
    const now = performance.now();
    const elapsedMs = now - this.startTime;
    const elapsedSec = elapsedMs / 1000;
    const total = this.script.targetDuration;
    const remaining = Math.max(0, total - elapsedSec);

    // Find the current stage — latest stage whose t <= elapsedSec.
    let currentStage = this.script.stages[0];
    for (const s of this.script.stages) {
      if (s.t <= elapsedSec) currentStage = s;
      else break;
    }
    this._setPrompt(currentStage.prompt, currentStage.sub);
    this.el.capTimer.textContent = Math.ceil(remaining) + 's';
    this.el.capProgress.style.width = Math.min(100, (elapsedSec / total) * 100) + '%';

    if (elapsedSec >= total) {
      // Auto-stop at target duration so users don't accidentally record
      // 20 minutes because they forgot.
      this.stopRecording();
      return;
    }
    this.rafId = requestAnimationFrame(() => this._tickLoop());
  }

  async stopRecording() {
    if (this.state !== 'recording') return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._unbindMotionSensors();
    try { this.recorder.stop(); } catch (_) { /* ignore race with auto-stop */ }
    this.state = 'done';
    this.el.capStartBtn.textContent = 'Recording… saving';
    this.el.capStartBtn.disabled = true;

    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch (_) {}
      this.wakeLock = null;
    }
  }

  /**
   * Fires once the recorder has flushed the final chunk. Builds the Blob,
   * shows a preview, and offers upload to Supabase.
   */
  async _onRecordingStopped(mime) {
    const blob = new Blob(this.chunks, { type: mime || 'video/mp4' });
    const sizeMb = (blob.size / 1024 / 1024).toFixed(1);
    this._setPrompt(`Capture done — ${sizeMb} MB`, 'Review below. Upload when ready.');

    // Show the recorded video in the preview <video>, looping.
    try {
      // Stop the live camera stream first; keeping it live during playback
      // crashes some Android builds.
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      const url = URL.createObjectURL(blob);
      this.el.capVideo.srcObject = null;
      this.el.capVideo.src = url;
      this.el.capVideo.loop = true;
      this.el.capVideo.muted = true;
      this.el.capVideo.controls = true;
      await this.el.capVideo.play().catch(() => {});
    } catch (err) {
      this.onError('Preview failed: ' + err.message);
    }

    this.el.capStartBtn.textContent = 'Upload for processing';
    this.el.capStartBtn.disabled = false;
    // The host page rewires the button to call uploadLatest() — we do not
    // hard-code that because different entry points might post-process the
    // blob differently (e.g. wrap it with a second clip for interior).
    this._latestBlob = blob;
    this._latestMime = mime;
  }

  /**
   * Get the latest recorded blob. Host calls this to upload or chain to
   * the next capture stage.
   */
  getLatestBlob() {
    return { blob: this._latestBlob, mime: this._latestMime };
  }

  /**
   * Upload the last-recorded blob as a queued reconstruction job via the
   * existing R2 + Supabase pipeline. The GPU worker (pipeline.py) picks up
   * queued reconstruction_jobs rows and creates the nif_files row itself
   * once processing actually completes — this function only ever creates
   * the *job*, since there's no processed NIF yet at upload time.
   * Returns the new reconstruction_jobs id (poll it for status/progress).
   */
  async uploadLatest({ title, scriptKey } = {}) {
    const { blob, mime } = this.getLatestBlob();
    if (!blob) throw new Error('No recorded video to upload');
    if (!this.supabase) throw new Error('supabase client not provided to CaptureGuide');

    this._uploadStatus('Uploading…');
    const { data: user } = await this.supabase.auth.getUser();
    const ext = (mime && mime.includes('mp4')) ? 'mp4' : 'webm';
    const r2 = (await import('../r2Client.js')).default;
    const path = `raw/${user?.user?.id || 'anon'}/${Date.now()}.${ext}`;
    const { fileKey, error: upErr } = await r2
      .from('splat-files')
      .upload(path, blob, { contentType: blob.type });
    if (upErr) throw upErr;

    this._uploadStatus('Queuing for reconstruction…');
    const { data: job, error } = await this.supabase.from('reconstruction_jobs').insert({
      user_id:      user?.user?.id || null,
      status:       'queued',
      progress:     0,
      vertical:     'generic',
      capture_mode: scriptKey || 'exterior_car',
      raw_r2_key:   fileKey,
      meta: {
        title: title || `Capture ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        duration_s: this.script.targetDuration,
        mime,
        recorded_at: new Date().toISOString(),
      },
    }).select().single();
    if (error) throw error;

    this._uploadStatus('Uploaded. Queued for processing.');
    this.onUploadComplete({ id: job.id, jobId: job.id, viewerUrl: null });
    return job.id;
  }

  // ─── small DOM helpers ────────────────────────────────────────────────
  _setPrompt(main, sub) {
    if (this.el.capPrompt) this.el.capPrompt.textContent = main || '';
    if (this.el.capSub)    this.el.capSub.textContent    = sub  || '';
  }
  _setHint(h) {
    if (this.el.capHint) this.el.capHint.textContent = h || '';
  }
  _uploadStatus(s) {
    if (this.el.capUploadStatus) this.el.capUploadStatus.textContent = s || '';
  }
}

export default { CaptureGuide, CAPTURE_SCRIPTS };
