import {
  defaultAvatarIdForSeat,
  type AvatarId,
  type JoinOptions,
  type MoveTargetCommand,
  type RestartCommand,
  type WorldPoint,
} from '../game/index.ts';
import {
  createTeammateObservation,
  moveAcceptance,
  movementSnapshot,
  resolveTeammateMovementTarget,
} from '../mcp/game-tools-policy.ts';
import { PlayerTwoMovementCoordinator } from '../mcp/movement.ts';
import { CueAudio } from './audio.ts';
import { cleanupOwnedBrowserLifecycle, ownsBrowserLifecycle } from './lifecycle.ts';
import { CoopNetwork, savedRoomId } from './network.ts';
import { campaignPresentation } from './presentation.ts';
import { TransientChatPopup } from './transient-chat.ts';
import {
  AVATAR_CATALOG,
  avatarLabel,
  isAvatarAssetId,
  isThreeAssetLibraryReady,
  preloadThreeAssets,
} from './three/assets.ts';
import { AvatarPreview } from './three/avatar-preview.ts';
import { FacilityRenderer } from './three/facility-renderer.ts';
import {
  cloneSnapshot,
  EMPTY_SNAPSHOT,
  nextTransitionSequence,
  type ClientStatus,
  type CoopSnapshot,
} from './state.ts';
import {
  browserGameUnavailable,
  browserMovementUnavailableReason,
  registerWebMcpTools,
  type BrowserGameUnavailable,
  type BrowserJoinResult,
  type BrowserMovementTarget,
} from './webmcp.ts';
import './styles.css';

const app: HTMLElement = (() => {
  const mount = document.querySelector<HTMLElement>('#app');
  if (mount === null) throw new Error('Missing #app mount element.');
  return mount;
})();

const audio = new CueAudio();
let network: CoopNetwork | null = null;
let facility: FacilityRenderer | null = null;
let snapshot: CoopSnapshot = cloneSnapshot(EMPTY_SNAPSHOT);
let moveSeq = 0;
let transitionSeq = 0;
let lifecycleGeneration = 0;
let status: ClientStatus = 'landing';
let statusDetail = '';
let browserToolTerminal = false;
let selectedAvatarId: AvatarId = defaultAvatarIdForSeat(0);
let avatarPreview: AvatarPreview | null = null;
const playerTwoMovement = new PlayerTwoMovementCoordinator();

const chatPopup = new TransientChatPopup({
  show(message) {
    const popup = element<HTMLElement>('[data-testid="chat-popup"]');
    const text = element<HTMLElement>('[data-testid="chat-message"]');
    if (popup === null || text === null) return false;
    text.textContent = message;
    popup.hidden = false;
    return true;
  },
  hide() {
    const popup = element<HTMLElement>('[data-testid="chat-popup"]');
    if (popup !== null) popup.hidden = true;
  },
});

const roomIdFromUrl = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('room')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{4,128}$/.test(value) ? value : null;
};

interface PairingInvite {
  roomId: string;
  pairingToken: string;
}

interface PendingJoin {
  roomId: string;
  pairingToken?: string;
}

let pendingJoin: PendingJoin | null = null;

const pairingInviteFromUrl = (): PairingInvite | null => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const roomId = params.get('room')?.trim() ?? '';
  const pairingToken = params.get('pair')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{4,128}$/.test(roomId) && /^[A-Za-z0-9_-]{40,128}$/.test(pairingToken)
    ? { roomId, pairingToken }
    : null;
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

function avatarChoicesMarkup(): string {
  return AVATAR_CATALOG.map(({ id, label }, index) => `
    <label class="avatar-choice" title="${label}">
      <input
        type="radio"
        name="avatar"
        value="${id}"
        data-testid="avatar-option-${id}"
        aria-label="${label}"
        ${id === selectedAvatarId ? 'checked' : ''}
      />
      <span aria-hidden="true">${String.fromCharCode(65 + index)}</span>
    </label>`).join('');
}

function pairingTokenFor(roomId: string): string | undefined {
  return pendingJoin?.roomId === roomId ? pendingJoin.pairingToken : undefined;
}

function clearJoinIntentFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  url.hash = '';
  history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function startAvatarPreview(generation: number): void {
  void preloadThreeAssets().then(() => {
    if (generation !== lifecycleGeneration || status !== 'landing') return;
    const root = element<HTMLElement>('[data-testid="avatar-preview"]');
    if (root === null) return;
    const preview = new AvatarPreview();
    preview.start(root, selectedAvatarId);
    if (generation !== lifecycleGeneration || status !== 'landing') {
      preview.destroy();
      return;
    }
    avatarPreview?.destroy();
    avatarPreview = preview;
    const placeholder = element<HTMLElement>('[data-testid="avatar-preview-status"]');
    if (placeholder !== null) placeholder.hidden = true;
  }).catch(() => {
    if (generation !== lifecycleGeneration || status !== 'landing') return;
    setText('[data-testid="avatar-preview-status"]', 'Preview unavailable');
  });
}

function landing(error = ''): void {
  const generation = ++lifecycleGeneration;
  chatPopup.clear();
  facility?.destroy();
  facility = null;
  avatarPreview?.destroy();
  avatarPreview = null;
  app.innerHTML = `
    <main class="landing" data-testid="landing-shell">
      <section class="landing-card" aria-labelledby="game-title">
        <p class="eyebrow">Realtime facility puzzle</p>
        <h1 id="game-title">THE COOP</h1>
        <p class="theme">Hold the line. Open the door. Get both explorers home.</p>
        <section class="character-customization" data-testid="avatar-customization" aria-labelledby="avatar-heading">
          <div class="avatar-preview-panel">
            <div class="avatar-preview" data-testid="avatar-preview">
              <span class="avatar-preview-status" data-testid="avatar-preview-status" role="status">Loading character preview…</span>
            </div>
            <div class="avatar-selection-copy">
              <p class="eyebrow">Your character</p>
              <h2 id="avatar-heading" data-testid="selected-avatar-name">${avatarLabel(selectedAvatarId)}</h2>
              <p>Choose your explorer before creating or joining a room.</p>
            </div>
          </div>
          <fieldset class="avatar-options">
            <legend>Choose a character</legend>
            <div class="avatar-choice-grid">${avatarChoicesMarkup()}</div>
          </fieldset>
        </section>
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
          <p>Click your explorer’s destination. Hold controls for your partner, collect shared keycards, and unlock each facility gate.</p>
          <p>Movement is pointer-only; the server owns every route and outcome.</p>
        </section>
      </section>
    </main>`;
  setText('[data-testid="room-error"]', error);
  const input = element<HTMLInputElement>('[data-testid="room-code-input"]');
  if (input !== null && pendingJoin !== null) input.value = pendingJoin.roomId;
  element<HTMLButtonElement>('[data-testid="create-room"]')?.addEventListener('click', () => { void startCreate(); });
  const join = (): void => {
    const roomId = input?.value.trim() ?? '';
    void startJoin(roomId, pairingTokenFor(roomId));
  };
  element<HTMLButtonElement>('[data-testid="join-room"]')?.addEventListener('click', join);
  input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') join(); });
  for (const option of app.querySelectorAll<HTMLInputElement>('input[name="avatar"]')) {
    option.addEventListener('change', () => {
      if (!option.checked || !isAvatarAssetId(option.value)) return;
      selectedAvatarId = option.value;
      setText('[data-testid="selected-avatar-name"]', avatarLabel(selectedAvatarId));
      avatarPreview?.select(selectedAvatarId);
    });
  }
  startAvatarPreview(generation);
}

function gameShell(): void {
  chatPopup.clear();
  avatarPreview?.destroy();
  avatarPreview = null;
  app.innerHTML = `
    <main class="game-shell" data-testid="game-shell">
      <header class="hud" aria-label="Game status">
        <div><span class="hud-label">YOU</span> <strong data-testid="local-player">Connecting…</strong></div>
        <div class="level-heading"><span class="hud-label" data-testid="level-indicator">LEVEL 1 OF 4</span> <strong data-testid="level-name">Pressure Lock</strong></div>
        <div><span class="hud-label">ROOM</span> <code data-testid="hud-room-code">—</code> <button type="button" data-testid="copy-room-code">Copy code</button> <button type="button" data-testid="copy-invite">Copy invite</button></div>
        <div><span class="hud-label">PARTNER</span> <strong data-testid="partner-status">Waiting for seat 2</strong></div>
        <button class="icon-button" type="button" data-testid="mute-toggle" aria-pressed="false">Sound on</button>
        <button class="quiet-button" type="button" data-testid="return-to-lobby">Leave room</button>
      </header>
      <p class="objective" data-testid="objective" aria-live="polite">Waiting for both explorers…</p>
      <aside class="chat-popup" data-testid="chat-popup" role="status" aria-live="polite" aria-atomic="true" hidden>
        <span class="chat-popup-label" aria-hidden="true">Agent message</span>
        <p data-testid="chat-message"></p>
      </aside>
      <p id="game-help" class="sr-only">Puzzle facility. Click a destination to move your explorer. Coordinate movement-triggered controls with your partner and get both explorers to the exit.</p>
      <div id="facility-root" class="facility-root" role="application" aria-describedby="game-help" aria-label="The Coop puzzle facility"></div>
      <div class="asset-loading-overlay" data-testid="asset-loading-overlay" role="status" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span>
        <strong>Preparing the facility</strong>
        <span>Loading explorers and modular level assets…</span>
      </div>
      <div class="connection-overlay" data-testid="reconnect-overlay" role="status" aria-live="polite" hidden><strong>Reconnecting</strong><span>Connection lost. Retrying…</span></div>
      <div class="error-overlay" data-testid="error-overlay" role="alertdialog" aria-modal="true" hidden>
        <h2>Connection problem</h2><p data-testid="error-detail">The game server could not be reached.</p>
        <button class="primary" type="button" data-testid="error-to-lobby">Return to lobby</button>
      </div>
      <div class="completion-overlay" data-testid="completion-overlay" role="dialog" aria-modal="true" hidden>
        <p class="eyebrow">Facility cleared</p><h2 data-testid="completion-title">Both explorers made it out.</h2>
        <div class="completion-actions">
          <button class="primary" type="button" data-testid="advance-level">Next Level</button>
          <button type="button" data-testid="restart-level">Replay Level</button>
        </div>
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
    requestReplay();
  });
  element<HTMLButtonElement>('[data-testid="advance-level"]')?.addEventListener('click', () => {
    audio.unlock();
    requestAdvance();
  });
}

async function createRenderer(generation: number): Promise<void> {
  await preloadThreeAssets();
  if (generation !== lifecycleGeneration) return;
  const root = element<HTMLElement>('#facility-root');
  if (root === null) throw new Error('Missing facility renderer mount.');
  const renderer = new FacilityRenderer({
    getSnapshot: () => snapshot,
    getPlayerId: () => network?.playerId ?? null,
    sendTarget: (target) => sendTarget(target),
    onGesture: () => audio.unlock(),
  });
  renderer.setCueListener((cue) => audio.play(cue));
  try {
    await renderer.start(root);
  } catch (error: unknown) {
    renderer.destroy();
    throw error;
  }
  if (generation !== lifecycleGeneration) {
    renderer.destroy();
    return;
  }
  facility = renderer;
  const loading = element<HTMLElement>('[data-testid="asset-loading-overlay"]');
  if (loading !== null) loading.hidden = true;
}

function sendTarget(target: WorldPoint): void {
  if (snapshot.phase !== 'playing') return;
  audio.play('click');
  network?.sendMove({ seq: ++moveSeq, worldX: target.x, worldY: target.y } satisfies MoveTargetCommand);
}

function nextTransitionCommand(): RestartCommand {
  transitionSeq = nextTransitionSequence(transitionSeq, snapshot.levelEpoch);
  return { seq: transitionSeq };
}

function requestReplay(): void {
  network?.restart(nextTransitionCommand());
}

function requestAdvance(): void {
  network?.advance(nextTransitionCommand());
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
  const campaign = campaignPresentation(snapshot);
  setText('[data-testid="local-player"]', localPlayer);
  setText('[data-testid="level-indicator"]', campaign.levelIndicator);
  setText('[data-testid="level-name"]', snapshot.levelName);
  setText('[data-testid="hud-room-code"]', formatRoomCode());
  setText('[data-testid="partner-status"]', partnerStatus);
  const objective = snapshot.phase === 'completed'
    ? campaign.completionObjective
    : snapshot.phase === 'reconnectGrace'
      ? `Partner reconnect window: ${Math.ceil(snapshot.reconnectRemainingSeconds)}s`
      : snapshot.phase === 'playing'
        ? snapshot.objective
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
  if (complete !== null) {
    complete.hidden = snapshot.phase !== 'completed';
    setText('[data-testid="completion-title"]', campaign.completionTitle);
    const advance = element<HTMLButtonElement>('[data-testid="advance-level"]');
    if (advance !== null) advance.textContent = campaign.advanceLabel;
  }
  const abandoned = element<HTMLElement>('[data-testid="abandoned-overlay"]');
  if (abandoned !== null) { abandoned.hidden = status !== 'abandoned' && snapshot.phase !== 'abandoned'; setText('[data-testid="abandoned-detail"]', statusDetail || 'Your partner did not reconnect in time.'); }
}

function createNetwork(generation: number): CoopNetwork {
  const createdNetwork = new CoopNetwork({
    onSnapshot(next) {
      if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) return;
      snapshot = cloneSnapshot(next);
      const localPlayer = snapshot.players.find(({ id }) => id === network?.playerId);
      if (localPlayer !== undefined) moveSeq = Math.max(moveSeq, localPlayer.lastMoveSeq);
      playerTwoMovement.observe(movementSnapshot(snapshot));
      renderHud();
    },
    onStatus(nextStatus, detail = '') {
      if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) return;
      status = nextStatus;
      statusDetail = detail;
      if (nextStatus === 'reconnecting') audio.play('reconnect');
      const unavailableReason = browserMovementUnavailableReason(nextStatus);
      if (unavailableReason !== null) {
        playerTwoMovement.markUnavailable(detail || unavailableReason);
      }
      if (nextStatus === 'error' || nextStatus === 'abandoned') {
        browserToolTerminal = true;
      }
      renderHud();
    },
    onSeat() {
      if (ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) renderHud();
    },
    onMoveResult(result) {
      if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) return;
      playerTwoMovement.handleMoveResult(moveAcceptance(result));
      facility?.setMoveFeedback(result.accepted, result.routeKind);
      audio.play(result.accepted ? 'click' : 'rejection');
    },
    onRestarted() {
      if (ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) renderHud();
    },
    onAdvanced() {
      if (ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) renderHud();
    },
    onAbandoned() {
      if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, createdNetwork)) return;
      playerTwoMovement.markUnavailable('The browser session was abandoned.');
      browserToolTerminal = true;
      status = 'abandoned';
      statusDetail = 'Your partner did not reconnect in time.';
      renderHud();
    },
  });
  return createdNetwork;
}

function selectedHumanJoinOptions(): JoinOptions {
  return {
    roomMode: 'human-human',
    controllerKind: 'human',
    avatarId: selectedAvatarId,
  };
}

async function startCreate(): Promise<void> {
  pendingJoin = null;
  const generation = ++lifecycleGeneration;
  gameShell();
  status = 'creating';
  statusDetail = '';
  browserToolTerminal = false;
  try {
    await createRenderer(generation);
  } catch (error: unknown) {
    if (generation !== lifecycleGeneration) return;
    showAssetError(error);
    return;
  }
  if (generation !== lifecycleGeneration) return;
  const attemptedNetwork = createNetwork(generation);
  network = attemptedNetwork;
  try {
    await attemptedNetwork.create(selectedHumanJoinOptions());
  } catch {
    showConnectionError(attemptedNetwork, generation);
  }
}

async function startJoin(rawRoomId: string, pairingToken?: string): Promise<void> {
  const roomId = rawRoomId.trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(roomId)) { landing('Enter a valid room code.'); return; }
  const generation = ++lifecycleGeneration;
  gameShell();
  status = 'joining';
  statusDetail = '';
  browserToolTerminal = false;
  try {
    await createRenderer(generation);
  } catch (error: unknown) {
    if (generation !== lifecycleGeneration) return;
    showAssetError(error);
    return;
  }
  if (generation !== lifecycleGeneration) return;
  const attemptedNetwork = createNetwork(generation);
  network = attemptedNetwork;
  try {
    const restored = await attemptedNetwork.reconnectIfMatching(roomId);
    if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, attemptedNetwork)) return;
    if (!restored) {
      await attemptedNetwork.join(roomId, pairingToken === undefined
        ? selectedHumanJoinOptions()
        : {
            roomMode: 'human-ai',
            controllerKind: 'human',
            playerId: 'player-1',
            pairingToken,
            avatarId: selectedAvatarId,
          });
    }
    if (!ownsBrowserLifecycle(lifecycleGeneration, network, generation, attemptedNetwork)) return;
    pendingJoin = null;
    clearJoinIntentFromUrl();
  } catch {
    showConnectionError(attemptedNetwork, generation);
  }
}

function showAssetError(error: unknown): void {
  facility?.destroy();
  facility = null;
  network?.dispose(true);
  network = null;
  status = 'error';
  statusDetail = error instanceof Error
    ? `Visual assets could not be loaded: ${error.message}`
    : 'Visual assets could not be loaded. Return to the lobby and retry.';
  const loading = element<HTMLElement>('[data-testid="asset-loading-overlay"]');
  if (loading !== null) loading.hidden = true;
  renderHud();
}

function showConnectionError(attemptedNetwork: CoopNetwork, generation: number): void {
  cleanupOwnedBrowserLifecycle(
    lifecycleGeneration,
    network,
    generation,
    attemptedNetwork,
    () => {
      const error = statusDetail || 'The room could not be reached.';
      attemptedNetwork.dispose(true);
      network = null;
      snapshot = cloneSnapshot(EMPTY_SNAPSHOT);
      status = 'landing';
      history.replaceState(null, '', window.location.pathname);
      landing(error);
    },
  );
}

function returnToLobby(): void {
  playerTwoMovement.markUnavailable('The browser left the Player 2 session.');
  network?.dispose(true);
  network = null;
  snapshot = cloneSnapshot(EMPTY_SNAPSHOT);
  moveSeq = 0;
  transitionSeq = 0;
  status = 'landing';
  statusDetail = '';
  pendingJoin = null;
  history.replaceState(null, '', window.location.pathname);
  landing();
}

function currentBrowserGameUnavailable(): BrowserGameUnavailable | null {
  return browserGameUnavailable({
    status,
    phase: snapshot.phase,
    hasNetwork: network !== null,
    seat: network?.seat ?? null,
    playerId: network?.playerId ?? null,
    roomId: network?.roomId ?? null,
    terminal: browserToolTerminal,
  });
}

async function joinGameFromWebMcp(code: string): Promise<BrowserJoinResult> {
  if (status !== 'landing' || network !== null) {
    throw new Error('join_game is available only from an unseated landing page.');
  }
  const generation = ++lifecycleGeneration;
  let attemptedNetwork: CoopNetwork | null = null;
  gameShell();
  status = 'joining';
  statusDetail = '';
  browserToolTerminal = false;
  try {
    await createRenderer(generation);
    if (generation !== lifecycleGeneration) throw new Error('The join_game attempt was cancelled by a newer page lifecycle.');
    attemptedNetwork = createNetwork(generation);
    network = attemptedNetwork;
    await attemptedNetwork.joinAsPlayerTwo(code, selectedHumanJoinOptions());
    if (generation !== lifecycleGeneration || network !== attemptedNetwork) {
      attemptedNetwork.dispose(true);
      throw new Error('The join_game attempt became stale before seat confirmation.');
    }
    if (
      attemptedNetwork.seat !== 1
      || attemptedNetwork.playerId !== 'player-2'
      || attemptedNetwork.roomId === null
    ) {
      throw new Error('The server did not confirm Player 2 in seat 2.');
    }
    return { joined: true, roomId: attemptedNetwork.roomId, playerId: 'player-2' };
  } catch (error) {
    if (generation === lifecycleGeneration) {
      const detail = statusDetail || (error instanceof Error ? error.message : 'The room could not be reached.');
      if (attemptedNetwork !== null) showConnectionError(attemptedNetwork, generation);
      else landing(detail);
      throw new Error(detail, { cause: error });
    }
    throw error;
  }
}

function observeGameFromWebMcp(): Record<string, unknown> | BrowserGameUnavailable {
  const unavailable = currentBrowserGameUnavailable();
  if (unavailable !== null) return unavailable;
  return createTeammateObservation(snapshot, {
    roomId: network!.roomId!,
    reconnecting: status === 'reconnecting',
    pairingAvailable: false,
  });
}

async function movePlayerTwoFromWebMcp(
  target: BrowserMovementTarget,
  waitUntil: 'accepted' | 'arrived',
) {
  const unavailable = currentBrowserGameUnavailable();
  if (unavailable !== null) return unavailable;
  const authoritative = movementSnapshot(snapshot);
  const resolved = resolveTeammateMovementTarget(snapshot, target);
  if (resolved === null) {
    return {
      status: 'rejected' as const,
      seq: -1 as const,
      target,
      effectiveTarget: null,
      currentPosition: authoritative.playerTwo?.grid ?? null,
      phase: snapshot.phase,
      reason: target.kind === 'interactable'
        ? `Interactable ${target.id} is not available in ${snapshot.levelId}.`
        : 'The target is outside the level grid.',
    };
  }
  const pending = playerTwoMovement.begin(
    authoritative,
    resolved.command.grid,
    waitUntil,
    resolved.validArrivals,
  );
  if (!network!.sendMove({
    seq: pending.seq,
    worldX: resolved.command.world.x,
    worldY: resolved.command.world.y,
  })) playerTwoMovement.markUnavailable('Player 2 is disconnected from the local game server.');
  return pending.outcome;
}

function installDiagnostics(): void {
  if (import.meta.env.PROD || new URLSearchParams(window.location.search).get('e2e') !== '1') return;
  const bridge = {
    get state(): CoopSnapshot { return cloneSnapshot(snapshot); },
    get roomId(): string | null { return network?.roomId ?? null; },
    get playerId(): string | null { return network?.playerId ?? null; },
    get assetReady(): boolean { return isThreeAssetLibraryReady() && facility !== null; },
    get renderer(): unknown { return facility?.getDiagnostics() ?? null; },
    worldToScreen(point: WorldPoint): WorldPoint { return facility?.worldToScreen(point) ?? { x: 64 + point.x, y: 72 + point.y }; },
    sendMoveTarget(point: WorldPoint): void { sendTarget(point); },
    restartLevel(): void { requestReplay(); },
    nextLevel(): void { requestAdvance(); },
    setVisualTime(milliseconds: number | null): void { facility?.setVisualTime(milliseconds); },
  };
  Object.assign(window, { __THE_COOP_E2E__: bridge });
}

declare global { interface Window { __THE_COOP_E2E__?: unknown; } }

const startupPairingInvite = pairingInviteFromUrl();
const startupRoomFromUrl = roomIdFromUrl();
pendingJoin = startupPairingInvite ?? (
  startupRoomFromUrl === null ? null : { roomId: startupRoomFromUrl }
);
const startupSavedRoom = pendingJoin === null ? savedRoomId() : null;

landing();
void registerWebMcpTools({
  displayMessage: (message) => chatPopup.show(message),
  joinGame: joinGameFromWebMcp,
  observeGame: observeGameFromWebMcp,
  movePlayerTwo: movePlayerTwoFromWebMcp,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'WebMCP tool registration failed.');
});
installDiagnostics();
if (startupSavedRoom !== null) void startJoin(startupSavedRoom);
