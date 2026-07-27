export type Cue = 'click' | 'plate' | 'door' | 'rejection' | 'reconnect' | 'completion';

const STORAGE_KEY = 'the-coop:muted';

export class CueAudio {
  #context: AudioContext | null = null;
  #muted = sessionStorage.getItem(STORAGE_KEY) === '1';

  get muted(): boolean { return this.#muted; }

  unlock(): void {
    if (this.#context === null) this.#context = new AudioContext();
    void this.#context.resume();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    sessionStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  }

  play(cue: Cue): void {
    if (this.#muted || this.#context === null || this.#context.state !== 'running') return;
    const profile: Record<Cue, readonly [number, number, number, OscillatorType]> = {
      click: [440, 0.045, 0.025, 'sine'],
      plate: [660, 0.12, 0.04, 'triangle'],
      door: [165, 0.18, 0.05, 'square'],
      rejection: [120, 0.11, 0.035, 'sawtooth'],
      reconnect: [330, 0.16, 0.04, 'sine'],
      completion: [880, 0.34, 0.055, 'triangle'],
    };
    const [frequency, duration, volume, wave] = profile[cue];
    const now = this.#context.currentTime;
    const oscillator = this.#context.createOscillator();
    const gain = this.#context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(55, frequency * 1.45), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.#context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }
}
