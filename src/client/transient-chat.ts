export const CHAT_DISMISS_AFTER_MS = 5_000;

export interface ChatPopupView {
  show(message: string): boolean;
  hide(): void;
}

export interface ChatPopupScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const browserScheduler: ChatPopupScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TransientChatPopup {
  readonly #view: ChatPopupView;
  readonly #scheduler: ChatPopupScheduler;
  #dismissal: unknown = null;
  #generation = 0;

  constructor(view: ChatPopupView, scheduler: ChatPopupScheduler = browserScheduler) {
    this.#view = view;
    this.#scheduler = scheduler;
  }

  show(message: string): boolean {
    this.#cancelDismissal();
    if (!this.#view.show(message)) return false;

    const generation = ++this.#generation;
    this.#dismissal = this.#scheduler.schedule(() => {
      if (generation !== this.#generation) return;
      this.#dismissal = null;
      this.#view.hide();
    }, CHAT_DISMISS_AFTER_MS);
    return true;
  }

  clear(): void {
    this.#cancelDismissal();
    this.#view.hide();
  }

  #cancelDismissal(): void {
    this.#generation += 1;
    if (this.#dismissal !== null) this.#scheduler.cancel(this.#dismissal);
    this.#dismissal = null;
  }
}
