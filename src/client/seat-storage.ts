const SEAT_KEY = 'the-coop:seat';

export interface SavedSeat {
  roomId: string;
  reconnectionToken: string;
}

export function clearSavedSeat(): void {
  sessionStorage.removeItem(SEAT_KEY);
}

export function storeSavedSeat(roomId: string, reconnectionToken: string): void {
  sessionStorage.setItem(SEAT_KEY, JSON.stringify({
    roomId,
    reconnectionToken,
  } satisfies SavedSeat));
}

export function savedSeat(): SavedSeat | null {
  try {
    const value = sessionStorage.getItem(SEAT_KEY);
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Partial<SavedSeat>;
      if (
        typeof candidate.roomId === 'string'
        && typeof candidate.reconnectionToken === 'string'
      ) return candidate as SavedSeat;
    }
  } catch {
    // Corrupt session data is disposable.
  }
  return null;
}

export function savedRoomId(): string | null {
  return savedSeat()?.roomId ?? null;
}
