import { VAD } from '../config/jarvis';

const MIN_DB = -90;
// The noise floor is the quietest level heard within this window. Speech has
// gaps between words, so this keeps tracking the room even while someone
// talks, and catches up when background noise (fan, TV) starts.
const FLOOR_WINDOW_MS = 3000;

function rmsDb(samples) {
  if (!samples.length) return MIN_DB;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(MIN_DB, 20 * Math.log10(rms)) : MIN_DB;
}

/**
 * Energy-based voice activity detector for 16-bit mono PCM.
 *
 * Feed it microphone buffers; it tracks the room's noise floor, decides when
 * someone starts and stops talking, and hands back the whole utterance
 * (including a little audio from just before speech began).
 */
export class VoiceActivityDetector {
  constructor({ onSpeechStart, onSpeechEnd, onLevel } = {}) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onLevel = onLevel;
    this.noiseFloorDb = null; // calibrated from the first buffer
    this.floorWindow = [];
    this.floorWindowMs = 0;
    this.reset();
  }

  reset() {
    this.inSpeech = false;
    this.loudMs = 0;
    this.silentMs = 0;
    this.speechMs = 0;
    this.preRoll = [];
    this.preRollMs = 0;
    this.chunks = [];
    this.ignoreMs = 0;
  }

  /** Ignore audio for a while (e.g. right after the speaker stops). */
  ignoreFor(ms) {
    this.ignoreMs = Math.max(this.ignoreMs, ms);
  }

  updateNoiseFloor(db, durationMs) {
    if (this.noiseFloorDb === null) this.noiseFloorDb = db;
    this.floorWindow.push({ db, durationMs });
    this.floorWindowMs += durationMs;
    while (
      this.floorWindow.length > 1 &&
      this.floorWindowMs > FLOOR_WINDOW_MS
    ) {
      this.floorWindowMs -= this.floorWindow.shift().durationMs;
    }
    const quietest = Math.min(...this.floorWindow.map((f) => f.db));
    const alpha = quietest < this.noiseFloorDb ? 0.5 : 0.15;
    this.noiseFloorDb = Math.min(
      -20,
      Math.max(-75, this.noiseFloorDb + alpha * (quietest - this.noiseFloorDb))
    );
  }

  get thresholdDb() {
    return Math.max(
      VAD.minThresholdDb,
      this.noiseFloorDb + VAD.thresholdAboveFloorDb
    );
  }

  process(samples, sampleRate) {
    const durationMs = (samples.length / sampleRate) * 1000;
    const db = rmsDb(samples);
    this.updateNoiseFloor(db, durationMs);

    // 0..1 loudness for the UI, relative to the noise floor.
    this.onLevel?.(Math.min(1, Math.max(0, (db - this.noiseFloorDb - 3) / 30)));

    if (this.ignoreMs > 0) {
      this.ignoreMs -= durationMs;
      return;
    }

    const loud = db > this.thresholdDb;

    if (!this.inSpeech) {
      this.preRoll.push(samples);
      this.preRollMs += durationMs;
      while (this.preRoll.length > 1 && this.preRollMs > VAD.preRollMs) {
        const dropped = this.preRoll.shift();
        this.preRollMs -= (dropped.length / sampleRate) * 1000;
      }

      this.loudMs = loud ? this.loudMs + durationMs : 0;
      if (this.loudMs >= VAD.speechStartMs) {
        this.inSpeech = true;
        this.chunks = this.preRoll;
        this.preRoll = [];
        this.preRollMs = 0;
        this.speechMs = this.loudMs;
        this.silentMs = 0;
        this.onSpeechStart?.();
      }
      return;
    }

    this.chunks.push(samples);
    this.speechMs += durationMs;
    // Small hysteresis so trailing syllables don't count as silence.
    this.silentMs = db > this.thresholdDb - 3 ? 0 : this.silentMs + durationMs;

    if (this.silentMs >= VAD.speechEndMs || this.speechMs >= VAD.maxSpeechMs) {
      const chunks = this.chunks;
      const spokenMs = this.speechMs - this.silentMs;
      this.reset();
      if (spokenMs >= VAD.minSpeechMs) {
        this.onSpeechEnd?.({ chunks, sampleRate, durationMs: spokenMs });
      } else {
        this.onSpeechEnd?.(null);
      }
    }
  }
}
