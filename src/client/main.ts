import Phaser from 'phaser';
import type { MoveTargetCommand, RestartCommand, WorldPoint } from '../game/index.ts';
import { CueAudio } from './audio.ts';
import { FacilityScene } from './facility-scene.ts';
import { CoopNetwork, savedRoomId } from './network.ts';
import {
  cloneSnapshot,
  EMPTY_SNAPSHOT,
  nextRestartSequence,
  type ClientStatus,
  type CoopSnapshot,
} from './state.ts';
import './styles.css';

const app: HTMLElement = (() => {
  const mount = document.querySelector<HTMLElement>('#app');
  if (mount === null) throw new Error('Missing #app mount element.');
  return mount;
})();

const audio = new CueAudio();
let network: CoopNetwork | null = null;
let game: Phaser.Game | null = null;
let facility: FacilityScene | null = null;
let snapshot: CoopSnapshot = cloneSnapshot(EMPTY_SNAPSHOT);
let moveSeq = 0;
let restartSeq = 0;
let status: ClientStatus = 'landing';
let statusDetail = '';

const roomIdFromUrl = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('room')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{4,128}$/.test(value) ? value : null;
};

function element<T extends HTMLElement>(selector: string): T | null { return app.querySelector<T>(selector); }

function setText(selector: string, text: string): void { const node = element<HTMLElement>(selector); if (node !== null) node.textContent = text; }

function formatRoomCode(): string { return network?.roomId ?? '—'; }

function inviteUrl(): string {
  const roomId = network?.roomId;
  return roomId === null || roomId === undefined ? window.location.href : `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
}

async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* Clipboard availability is non-essential. */ }
}

function landing(error = ''): void {
  facility = null;
  game?.destroy(true);
  game = null;
  app.innerHTML = `
    <main class="landing" data-testid="landing-shell">
      <section class="landing-card" aria-labelledby="game-title">
        <p class="eyebrow">Realtime facility puzzle</p>
        <h1 id="game-title">THE COOP</h1>
        <p class="theme">Hold the line. Open the door. Get both explorers home.</p>
        <div class="lobby-actions">
          <button class="primary" type="button" data-testid="create-room">Create Room</button>
          <div class="join-row">
            <label class="sr-only" for="room-code">Room code</label>
            <input id="room-code" data-testid="room-code-input" autocomplete="off" maxlength="128" placeholder="Enter room code" />
            <button type="button" data-testid="join-room">Join</button>
          </div>
          <p class="form-error" data-testid="room-error" role="alert"></p>
        </div>
        <section class="instructions" aria-label="How to play">
          <h2>Two seats. One exit.</h2>
          <p>Click your explorer’s destination. One player holds Plate A while the other crosses to Plate B, opening the mechanical door.</p>
          <p>Movement is pointer-only; the server owns every route and outcome.</p>
        </section>
      </section>
    </main>`;
  setText('[data-testid="room-error"]', error);
  const input = element<HTMLInputElement>('[data-testid="room-code-input"]');
  element<HTMLButtonElement>('[data-testid="create-room"]')?.addEventListener('click', () => { void startCreate(); });
  element<HTMLButtonElement>('[data-testid="join-room"]')?.addEventListener('click', () => { void startJoin(input?.value ?? ''); });
  input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') void startJoin(input.value); });
}

function gameShell(): void {
  app.innerHTML = `
    <main class="game-shell" data-testid="game-shell">
      <header class="hud" aria-label="Game status">
        <div><span class="hud-label">YOU</span> <strong data-testid="local-player">Connecting…</strong></div>
        <div><span class="hud-label">ROOM</span> <code data-testid="hud-room-code">—</code> <button type="button" data-testid="copy-room-code">Copy code</button> <button type="button" data-testid="copy-invite">Copy invite</button></div>
        <div><span class="hud-label">PARTNER</span> <strong data-testid="partner-status">Waiting for seat 2</strong></div>
        <button class="icon-button" type="button" data-testid="mute-toggle" aria-pressed="false">Sound on</button>
        <button class="quiet-button" type="button" data-testid="return-to-lobby">Leave room</button>
      </header>
      <p class="objective" data-testid="objective" aria-live="polite">Waiting for both explorers…</p>
      <p id="game-help" class="sr-only">Puzzle facility. Click a destination to move your explorer. Stand on either pressure plate to hold the door open for your partner.</p>
      <div id="phaser-root" class="phaser-root" role="application" aria-describedby="game-help" aria-label="The Coop puzzle facility"></div>
      <div class="connection-overlay" data-testid="reconnect-overlay" role="status" aria-live="polite" hidden><strong>Reconnecting</strong><span>Connection lost. Retrying…</span></div>
      <div class="error-overlay" data-testid="error-overlay" role="alertdialog" aria-modal="true" hidden>
        <h2>Connection problem</h2><p data-testid="error-detail">The game server could not be reached.</p>
        <button class="primary" type="button" data-testid="error-to-lobby">Return to lobby</button>
      </div>
      <div class="completion-overlay" data-testid="completion-overlay" role="dialog" aria-modal="true" hidden>
        <p class="eyebrow">Facility cleared</p><h2>Both explorers made it out.</h2>
        <button class="primary" type="button" data-testid="restart-level">Restart level</button>
      </div>
      <div class="abandoned-overlay" data-testid="abandoned-overlay" role="alertdialog" aria-modal="true" hidden>
        <h2>Session ended</h2><p data-testid="abandoned-detail">Your partner did not reconnect in time.</p>
        <button class="primary" type="button" data-testid="back-to-lobby">Return to lobby</button>
      </div>
    </main>`;
  element<HTMLButtonElement>('[data-testid="copy-room-code"]')?.addEventListener('click', () => { void copy(formatRoomCode()); });
  element<HTMLButtonElement>('[data-testid="copy-invite"]')?.addEventListener('click', () => { void copy(inviteUrl()); });
  element<HTMLButtonElement>('[data-testid="mute-toggle"]')?.addEventListener('click', toggleMute);
  element<HTMLButtonElement>('[data-testid="return-to-lobby"]')?.addEventListener('click', returnToLobby);
  element<HTMLButtonElement>('[data-testid="back-to-lobby"]')?.addEventListener('click', returnToLobby);
  element<HTMLButtonElement>('[data-testid="error-to-lobby"]')?.addEventListener('click', returnToLobby);
  element<HTMLButtonElement>('[data-testid="restart-level"]')?.addEventListener('click', () => {
    audio.unlock();
    requestRestart();
  });
}

function createGame(): void {
  const scene = new FacilityScene({
    getSnapshot: () => snapshot,
    getPlayerId: () => network?.playerId ?? null,
    sendTarget: (target) => sendTarget(target),
    onGesture: () => audio.unlock(),
  });
  scene.setCueListener((cue) => audio.play(cue));
  facility = scene;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'phaser-root',
    backgroundColor: '#071116',
    scene: [scene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1280, height: 720 },
  });
}

function sendTarget(target: WorldPoint): void {
  if (snapshot.phase !== 'playing') return;
  audio.play('click');
  network?.sendMove({ seq: ++moveSeq, worldX: target.x, worldY: target.y } satisfies MoveTargetCommand);
}

function requestRestart(): void {
  restartSeq = nextRestartSequence(restartSeq, snapshot.levelEpoch);
  network?.restart({ seq: restartSeq } satisfies RestartCommand);
}

function toggleMute(): void {
  audio.unlock();
  audio.setMuted(!audio.muted);
  renderHud();
}

function renderHud(): void {
  if (status === 'landing') return;
  const localSeat = network?.seat;
  const localPlayer = localSeat === null || localSeat === undefined ? 'Assigning seat…' : `Explorer ${localSeat + 1}`;
  const partner = snapshot.players.find((player) => player.id !== network?.playerId);
  const partnerStatus = partner === undefined ? 'Waiting for the second seat' : partner.connected ? 'Connected' : 'Reconnecting';
  setText('[data-testid="local-player"]', localPlayer);
  setText('[data-testid="hud-room-code"]', formatRoomCode());
  setText('[data-testid="partner-status"]', partnerStatus);
  const objective = snapshot.phase === 'completed'
    ? 'Exit secured. Either explorer can restart.'
    : snapshot.phase === 'reconnectGrace'
      ? `Partner reconnect window: ${Math.ceil(snapshot.reconnectRemainingSeconds)}s`
      : snapshot.phase === 'playing'
        ? snapshot.doorOpen ? 'Door open: get both explorers into the exit zone.' : 'Stand on either pressure plate to hold the door open.'
        : 'Waiting for both explorers to connect.';
  setText('[data-testid="objective"]', objective);
  const mute = element<HTMLButtonElement>('[data-testid="mute-toggle"]');
  if (mute !== null) { mute.textContent = audio.muted ? 'Sound off' : 'Sound on'; mute.setAttribute('aria-pressed', String(audio.muted)); }
  const reconnect = element<HTMLElement>('[data-testid="reconnect-overlay"]');
  if (reconnect !== null) { reconnect.hidden = status !== 'reconnecting' && snapshot.phase !== 'reconnectGrace'; reconnect.querySelector('span')!.textContent = statusDetail || objective; }
  const error = element<HTMLElement>('[data-testid="error-overlay"]');
  if (error !== null) {
    error.hidden = status !== 'error';
    setText('[data-testid="error-detail"]', statusDetail || 'The game server could not be reached.');
  }
  const complete = element<HTMLElement>('[data-testid="completion-overlay"]');
  if (complete !== null) complete.hidden = snapshot.phase !== 'completed';
  const abandoned = element<HTMLElement>('[data-testid="abandoned-overlay"]');
  if (abandoned !== null) { abandoned.hidden = status !== 'abandoned' && snapshot.phase !== 'abandoned'; setText('[data-testid="abandoned-detail"]', statusDetail || 'Your partner did not reconnect in time.'); }
}

function createNetwork(): CoopNetwork {
  return new CoopNetwork({
    onSnapshot(next) { snapshot = cloneSnapshot(next); renderHud(); },
    onStatus(nextStatus, detail = '') { status = nextStatus; statusDetail = detail; if (nextStatus === 'reconnecting') audio.play('reconnect'); renderHud(); },
    onSeat() { renderHud(); },
    onMoveResult(result) {
      facility?.setMoveFeedback(result.accepted, result.routeKind);
      audio.play(result.accepted ? 'click' : 'rejection');
    },
    onRestarted() { renderHud(); },
    onAbandoned() { status = 'abandoned'; statusDetail = 'Your partner did not reconnect in time.'; renderHud(); },
  });
}

async function startCreate(): Promise<void> {
  gameShell();
  createGame();
  network = createNetwork();
  try { await network.create(); } catch { showConnectionError(); }
}

async function startJoin(rawRoomId: string): Promise<void> {
  const roomId = rawRoomId.trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(roomId)) { landing('Enter a valid room code.'); return; }
  gameShell();
  createGame();
  network = createNetwork();
  try {
    const restored = await network.reconnectIfMatching(roomId);
    if (!restored) await network.join(roomId);
  } catch { showConnectionError(); }
}

function showConnectionError(): void {
  const error = statusDetail || 'The room could not be reached.';
  network?.dispose(true);
  network = null;
  snapshot = cloneSnapshot(EMPTY_SNAPSHOT);
  status = 'landing';
  history.replaceState(null, '', window.location.pathname);
  landing(error);
}

function returnToLobby(): void {
  network?.dispose(true);
  network = null;
  snapshot = cloneSnapshot(EMPTY_SNAPSHOT);
  moveSeq = 0;
  restartSeq = 0;
  status = 'landing';
  statusDetail = '';
  history.replaceState(null, '', window.location.pathname);
  landing();
}

function installDiagnostics(): void {
  if (import.meta.env.PROD || new URLSearchParams(window.location.search).get('e2e') !== '1') return;
  const bridge = {
    get state(): CoopSnapshot { return cloneSnapshot(snapshot); },
    get roomId(): string | null { return network?.roomId ?? null; },
    get playerId(): string | null { return network?.playerId ?? null; },
    worldToScreen(point: WorldPoint): WorldPoint { return facility?.worldToScreen(point) ?? { x: 64 + point.x, y: 72 + point.y }; },
    sendMoveTarget(point: WorldPoint): void { sendTarget(point); },
    restartLevel(): void { requestRestart(); },
  };
  Object.assign(window, { __THE_COOP_E2E__: bridge });
}

declare global { interface Window { __THE_COOP_E2E__?: unknown; } }

landing();
installDiagnostics();
const startupRoom = roomIdFromUrl() ?? savedRoomId();
if (startupRoom !== null) void startJoin(startupRoom);
