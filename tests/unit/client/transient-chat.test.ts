import { describe, expect, it } from 'vitest';
import {
  CHAT_DISMISS_AFTER_MS,
  TransientChatPopup,
  type ChatPopupScheduler,
} from '../../../src/client/transient-chat.ts';

class FakeScheduler implements ChatPopupScheduler {
  scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];

  schedule(callback: () => void, delayMs: number): unknown {
    const task = { callback, delayMs, cancelled: false };
    this.scheduled.push(task);
    return task;
  }

  cancel(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }
}

describe('TransientChatPopup', () => {
  it('replaces the message and restarts an exact five-second dismissal', () => {
    const scheduler = new FakeScheduler();
    const visible: string[] = [];
    let hidden = 0;
    const popup = new TransientChatPopup({
      show(message) { visible.push(message); return true; },
      hide() { hidden += 1; },
    }, scheduler);

    expect(popup.show('Meet at the gate.')).toBe(true);
    expect(scheduler.scheduled[0]?.delayMs).toBe(CHAT_DISMISS_AFTER_MS);
    expect(popup.show('Hold Plate A.')).toBe(true);
    expect(scheduler.scheduled[0]?.cancelled).toBe(true);

    scheduler.scheduled[0]?.callback();
    expect(hidden).toBe(0);
    scheduler.scheduled[1]?.callback();
    expect(visible).toEqual(['Meet at the gate.', 'Hold Plate A.']);
    expect(hidden).toBe(1);
  });

  it('prevents an old room timeout from hiding a new room message', () => {
    const scheduler = new FakeScheduler();
    const visible: string[] = [];
    let hidden = 0;
    const popup = new TransientChatPopup({
      show(message) { visible.push(message); return true; },
      hide() { hidden += 1; },
    }, scheduler);

    popup.show('Old room message');
    popup.clear();
    popup.show('New room message');
    scheduler.scheduled[0]?.callback();

    expect(scheduler.scheduled[0]?.cancelled).toBe(true);
    expect(hidden).toBe(1);
    expect(visible).toEqual(['Old room message', 'New room message']);

    scheduler.scheduled[1]?.callback();
    expect(hidden).toBe(2);
  });
});
