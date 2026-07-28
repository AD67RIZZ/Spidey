const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Tiny procedural sound system. It creates no AudioContext and schedules no
 * sound until unlock() runs from a user interaction.
 */
export class AudioSystem {
  constructor(options = {}) {
    if (typeof options === 'boolean') options = { enabled: options };

    this._enabled = options.enabled ?? true;
    this.volume = clamp(Number(options.volume ?? 0.65), 0, 1);
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.unlocked = false;
    this._unlockPromise = null;

    this._interactionTarget =
      options.interactionTarget ??
      (typeof window !== 'undefined' ? window : null);
    this._boundUnlock = () => {
      void this.unlock();
    };
    this._addUnlockListeners();
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    this.setEnabled(value);
  }

  setEnabled(value) {
    this._enabled = Boolean(value);
    if (this.master && this.context) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(
        this._enabled ? this.volume : 0,
        now,
        0.015,
      );
    }

    // A sound toggle is normally changed inside a trusted click/tap event.
    if (this._enabled && !this.unlocked) void this.unlock();
    return this._enabled;
  }

  toggle(force) {
    return this.setEnabled(force === undefined ? !this._enabled : force);
  }

  setVolume(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) this.volume = clamp(parsed, 0, 1);
    if (this.master && this.context && this._enabled) {
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.015,
      );
    }
    return this.volume;
  }

  async unlock() {
    if (this.unlocked && this.context?.state === 'running') return true;
    if (this._unlockPromise) return this._unlockPromise;

    const AudioContextClass =
      globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;

    this._unlockPromise = (async () => {
      try {
        if (!this.context) {
          this.context = new AudioContextClass();
          this.master = this.context.createGain();
          this.compressor = this.context.createDynamicsCompressor();

          this.master.gain.value = this._enabled ? this.volume : 0;
          this.compressor.threshold.value = -12;
          this.compressor.knee.value = 12;
          this.compressor.ratio.value = 4;
          this.compressor.attack.value = 0.003;
          this.compressor.release.value = 0.18;
          this.master.connect(this.compressor);
          this.compressor.connect(this.context.destination);
        }

        if (
          this.context.state !== 'running' &&
          this.context.state !== 'closed'
        ) {
          await this.context.resume();
        }
        this.unlocked = this.context.state === 'running';
        if (this.unlocked) this._removeUnlockListeners();
        return this.unlocked;
      } catch {
        this.unlocked = false;
        return false;
      } finally {
        this._unlockPromise = null;
      }
    })();

    return this._unlockPromise;
  }

  attach(strength = 1) {
    const amount = this._strength(strength);
    this._tone({
      frequency: 180,
      endFrequency: 720,
      duration: 0.13,
      type: 'sawtooth',
      volume: 0.075 * amount,
    });
    this._noise({
      duration: 0.07,
      volume: 0.045 * amount,
      highpass: 900,
    });
  }

  release(strength = 1) {
    const amount = this._strength(strength);
    this._tone({
      frequency: 520,
      endFrequency: 130,
      duration: 0.12,
      type: 'triangle',
      volume: 0.055 * amount,
    });
  }

  collect(streak = 0) {
    const step = clamp(Math.floor(Number(streak) || 0), 0, 12);
    const base = 540 * 2 ** (step / 24);
    this._tone({
      frequency: base,
      endFrequency: base * 1.04,
      duration: 0.1,
      type: 'sine',
      volume: 0.09,
    });
    this._tone({
      frequency: base * 1.5,
      endFrequency: base * 1.62,
      duration: 0.13,
      type: 'sine',
      volume: 0.065,
      delay: 0.055,
    });
  }

  jump(strength = 1) {
    const amount = this._strength(strength);
    this._tone({
      frequency: 145,
      endFrequency: 360,
      duration: 0.16,
      type: 'triangle',
      volume: 0.07 * amount,
    });
  }

  combo(multiplier = 2) {
    const level = clamp(Number(multiplier) || 2, 1, 10);
    const base = 330 + level * 24;
    [1, 1.25, 1.5].forEach((ratio, index) => {
      this._tone({
        frequency: base * ratio,
        endFrequency: base * ratio * 1.04,
        duration: 0.11,
        type: index === 2 ? 'triangle' : 'sine',
        volume: 0.052,
        delay: index * 0.055,
      });
    });
  }

  warning(urgent = false) {
    const frequency = urgent ? 880 : 660;
    this._tone({
      frequency,
      endFrequency: frequency * 0.94,
      duration: 0.105,
      type: 'square',
      volume: urgent ? 0.06 : 0.045,
    });
    if (urgent) {
      this._tone({
        frequency,
        endFrequency: frequency * 0.9,
        duration: 0.105,
        type: 'square',
        volume: 0.05,
        delay: 0.14,
      });
    }
  }

  land(impact = 1) {
    const amount = this._strength(impact);
    this._tone({
      frequency: 105,
      endFrequency: 48,
      duration: 0.18,
      type: 'sine',
      volume: 0.09 * amount,
    });
    this._noise({
      duration: 0.11,
      volume: 0.04 * amount,
      lowpass: 520,
    });
  }

  async dispose() {
    this._removeUnlockListeners();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.unlocked = false;
    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        // Closing an already-disposed browser context is harmless.
      }
    }
  }

  _strength(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clamp(parsed, 0.25, 1.5) : 1;
  }

  _canPlay() {
    return (
      this._enabled &&
      this.unlocked &&
      this.context?.state === 'running' &&
      this.master
    );
  }

  _tone({
    frequency,
    endFrequency = frequency,
    duration,
    type = 'sine',
    volume = 0.06,
    delay = 0,
    attack = 0.008,
  }) {
    if (!this._canPlay()) return;

    const context = this.context;
    const start = context.currentTime + Math.max(0, delay);
    const stop = start + Math.max(0.025, duration);
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      stop,
    );

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume),
      start + Math.min(attack, duration * 0.35),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(stop + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  _noise({
    duration,
    volume = 0.04,
    delay = 0,
    highpass = 0,
    lowpass = 0,
  }) {
    if (!this._canPlay()) return;

    const context = this.context;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const envelope = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    let output = source;
    let filter = null;
    if (highpass || lowpass) {
      filter = context.createBiquadFilter();
      filter.type = highpass ? 'highpass' : 'lowpass';
      filter.frequency.value = highpass || lowpass;
      source.connect(filter);
      output = filter;
    }

    const start = context.currentTime + Math.max(0, delay);
    const stop = start + duration;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);
    output.connect(gain);
    gain.connect(this.master);
    source.buffer = buffer;
    source.start(start);
    source.stop(stop + 0.01);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
  }

  _addUnlockListeners() {
    if (!this._interactionTarget?.addEventListener) return;
    this._interactionTarget.addEventListener('pointerdown', this._boundUnlock, {
      capture: true,
      passive: true,
    });
    this._interactionTarget.addEventListener('touchstart', this._boundUnlock, {
      capture: true,
      passive: true,
    });
    this._interactionTarget.addEventListener('keydown', this._boundUnlock, true);
  }

  _removeUnlockListeners() {
    if (!this._interactionTarget?.removeEventListener) return;
    this._interactionTarget.removeEventListener(
      'pointerdown',
      this._boundUnlock,
      true,
    );
    this._interactionTarget.removeEventListener(
      'touchstart',
      this._boundUnlock,
      true,
    );
    this._interactionTarget.removeEventListener(
      'keydown',
      this._boundUnlock,
      true,
    );
  }
}
