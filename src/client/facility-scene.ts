import Phaser from 'phaser';
import { CELL_SIZE, GRID_HEIGHT, GRID_WIDTH, LEVEL_ONE, type WorldPoint } from '../game/index.ts';
import type { CoopSnapshot, RemotePlayer } from './state.ts';

const BOARD_X = 64;
const BOARD_Y = 72;
const BOARD_WIDTH = GRID_WIDTH * CELL_SIZE;
const BOARD_HEIGHT = GRID_HEIGHT * CELL_SIZE;

export interface SceneBridge {
  getSnapshot: () => CoopSnapshot;
  getPlayerId: () => string | null;
  sendTarget: (target: WorldPoint) => void;
  onGesture: () => void;
}

interface RenderPlayer extends RemotePlayer { drawX: number; drawY: number; }

export class FacilityScene extends Phaser.Scene {
  #bridge: SceneBridge;
  #art!: Phaser.GameObjects.Graphics;
  #reticle!: Phaser.GameObjects.Graphics;
  #playerLabels: Phaser.GameObjects.Text[] = [];
  #players: RenderPlayer[] = [];
  #reticleState: { x: number; y: number; colour: number; expires: number } | null = null;
  #lastPlate = false;
  #lastDoor = false;
  #lastComplete = false;
  #notifyCue: ((cue: 'plate' | 'door' | 'completion') => void) | null = null;

  constructor(bridge: SceneBridge) {
    super({ key: 'facility' });
    this.#bridge = bridge;
  }

  setCueListener(listener: (cue: 'plate' | 'door' | 'completion') => void): void { this.#notifyCue = listener; }

  setMoveFeedback(accepted: boolean, routeKind?: string): void {
    if (this.#reticleState !== null) {
      this.#reticleState.colour = !accepted ? 0xff6577 : routeKind === 'threshold-stop' ? 0xffcc6e : 0x91f3b0;
      this.#reticleState.expires = this.time.now + 450;
    }
  }

  worldToScreen(point: WorldPoint): WorldPoint {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((BOARD_X + point.x) / 1280) * rect.width,
      y: rect.top + ((BOARD_Y + point.y) / 720) * rect.height,
    };
  }

  create(): void {
    this.#art = this.add.graphics();
    this.#reticle = this.add.graphics();
    this.#playerLabels = [0, 1].map(() => this.add.text(0, 0, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#07151b', fontStyle: 'bold',
    }).setOrigin(0.5));
    for (const [label, point] of [['A', LEVEL_ONE.nearPlate], ['B', LEVEL_ONE.farPlate]] as const) {
      this.add.text(BOARD_X + (point.x + 0.5) * CELL_SIZE, BOARD_Y + point.y * CELL_SIZE + 4, label, {
        fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#d6ffe0', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(2);
    }
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.#onPointer(pointer));
  }

  override update(_time: number, delta: number): void {
    const snapshot = this.#bridge.getSnapshot();
    this.#synchronizePlayers(snapshot.players, Math.min(1, delta / 100));
    const plates = snapshot.nearPlatePressed || snapshot.farPlatePressed;
    if (plates && !this.#lastPlate) this.#notifyCue?.('plate');
    if (snapshot.doorOpen && !this.#lastDoor) this.#notifyCue?.('door');
    if (snapshot.phase === 'completed' && !this.#lastComplete) this.#notifyCue?.('completion');
    this.#lastPlate = plates;
    this.#lastDoor = snapshot.doorOpen;
    this.#lastComplete = snapshot.phase === 'completed';
    this.#draw(snapshot, this.time.now);
  }

  #onPointer(pointer: Phaser.Input.Pointer): void {
    this.#bridge.onGesture();
    const worldX = pointer.x - BOARD_X;
    const worldY = pointer.y - BOARD_Y;
    const snapshot = this.#bridge.getSnapshot();
    if (snapshot.phase !== 'playing' || worldX < 0 || worldY < 0 || worldX >= BOARD_WIDTH || worldY >= BOARD_HEIGHT) return;
    this.#reticleState = { x: pointer.x, y: pointer.y, colour: 0x7ee8ff, expires: this.time.now + 700 };
    this.#bridge.sendTarget({ x: worldX, y: worldY });
  }

  #synchronizePlayers(remote: RemotePlayer[], amount: number): void {
    this.#players = remote.map((player, index) => {
      const previous = this.#players[index];
      return {
        ...player,
        drawX: previous?.id === player.id ? Phaser.Math.Linear(previous.drawX, player.worldX, amount) : player.worldX,
        drawY: previous?.id === player.id ? Phaser.Math.Linear(previous.drawY, player.worldY, amount) : player.worldY,
      };
    });
  }

  #draw(snapshot: CoopSnapshot, now: number): void {
    const art = this.#art;
    art.clear();
    art.fillStyle(0x071116, 1).fillRect(0, 0, 1280, 720);
    art.fillStyle(0x10232b, 1).fillRoundedRect(42, 50, 1196, 620, 14);
    art.fillStyle(0x0b1b22, 1).fillRect(BOARD_X, BOARD_Y, BOARD_WIDTH, BOARD_HEIGHT);

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const offset = (x + y) % 2 === 0 ? 0x15313a : 0x122b33;
        art.fillStyle(offset, 1).fillRect(BOARD_X + x * CELL_SIZE + 1, BOARD_Y + y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        art.lineStyle(1, 0x244650, 0.38).strokeRect(BOARD_X + x * CELL_SIZE, BOARD_Y + y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    art.fillStyle(0x091419, 1).fillRect(BOARD_X - 8, BOARD_Y - 8, BOARD_WIDTH + 16, 8);
    art.fillStyle(0x091419, 1).fillRect(BOARD_X - 8, BOARD_Y + BOARD_HEIGHT, BOARD_WIDTH + 16, 8);
    art.lineStyle(2, 0x3c7380, 0.7).strokeRect(BOARD_X - 1, BOARD_Y - 1, BOARD_WIDTH + 2, BOARD_HEIGHT + 2);

    for (const wallKey of LEVEL_ONE.walls) {
      const [x, y] = wallKey.split(',').map(Number);
      if (x === undefined || y === undefined) continue;
      const sx = BOARD_X + x * CELL_SIZE;
      const sy = BOARD_Y + y * CELL_SIZE;
      art.fillStyle(0x1a2930, 1).fillRoundedRect(sx + 3, sy + 3, CELL_SIZE - 6, CELL_SIZE - 6, 5);
      art.fillStyle(0x38515a, 1).fillRect(sx + 7, sy + 7, CELL_SIZE - 14, 7);
      art.fillStyle(0x0d1419, 1).fillRect(sx + 8, sy + 20, CELL_SIZE - 16, 18);
    }

    this.#drawPlate(LEVEL_ONE.nearPlate, snapshot.nearPlatePressed);
    this.#drawPlate(LEVEL_ONE.farPlate, snapshot.farPlatePressed);
    for (const cell of LEVEL_ONE.exitCells) {
      const pulse = 0.55 + Math.sin(now / 230) * 0.15;
      art.fillStyle(0x315f87, pulse).fillRect(BOARD_X + cell.x * CELL_SIZE + 5, BOARD_Y + cell.y * CELL_SIZE + 5, CELL_SIZE - 10, CELL_SIZE - 10);
    }
    art.lineStyle(2, 0x8fc9e8, 0.85).strokeRect(BOARD_X + 19 * CELL_SIZE + 5, BOARD_Y + 4 * CELL_SIZE + 5, 3 * CELL_SIZE - 10, 4 * CELL_SIZE - 10);

    for (const cell of LEVEL_ONE.doorCells) {
      const sx = BOARD_X + cell.x * CELL_SIZE;
      const sy = BOARD_Y + cell.y * CELL_SIZE;
      const slide = snapshot.doorOpen ? 30 + Math.sin(now / 150) * 2 : 0;
      const panelWidth = (CELL_SIZE - 8 - slide) / 2;
      art.fillStyle(snapshot.doorOpen ? 0x72d6df : 0x81465c, 1);
      art.fillRect(sx + 4, sy + 4, panelWidth, CELL_SIZE - 8);
      art.fillRect(sx + CELL_SIZE / 2 + slide / 2, sy + 4, panelWidth, CELL_SIZE - 8);
      art.lineStyle(1, 0xd2faff, 0.6);
      art.strokeRect(sx + 4, sy + 4, panelWidth, CELL_SIZE - 8);
      art.strokeRect(sx + CELL_SIZE / 2 + slide / 2, sy + 4, panelWidth, CELL_SIZE - 8);
    }
    if (!snapshot.doorOpen) {
      const threshold = LEVEL_ONE.leftThreshold;
      art.lineStyle(2, 0xffcc6e, 0.75).strokeCircle(BOARD_X + (threshold.x + 0.5) * CELL_SIZE, BOARD_Y + (threshold.y + 0.5) * CELL_SIZE, 15);
    }

    const localId = this.#bridge.getPlayerId();
    this.#players.forEach((player, index) => this.#drawPlayer(player, index, localId));
    this.#drawReticle(now);
  }

  #drawPlate(point: { x: number; y: number }, pressed: boolean): void {
    const x = BOARD_X + point.x * CELL_SIZE;
    const y = BOARD_Y + point.y * CELL_SIZE;
    this.#art.fillStyle(pressed ? 0x9bf4ad : 0x346750, pressed ? 1 : 0.9).fillRoundedRect(x + 8, y + 8, CELL_SIZE - 16, CELL_SIZE - 16, 7);
    this.#art.lineStyle(pressed ? 3 : 2, pressed ? 0xe9ffb9 : 0x7adf99, 1).strokeRoundedRect(x + 8, y + 8, CELL_SIZE - 16, CELL_SIZE - 16, 7);
  }

  #drawPlayer(player: RenderPlayer, index: number, localId: string | null): void {
    const x = BOARD_X + player.drawX;
    const y = BOARD_Y + player.drawY;
    const local = player.id === localId;
    const colour = index === 0 ? 0x5be1f0 : 0xffae5f;
    this.#art.fillStyle(0x000000, 0.26).fillCircle(x + 3, y + 5, 16);
    this.#art.lineStyle(local ? 3 : 1, local ? 0xffffff : 0x16252b, 1).strokeCircle(x, y, 17);
    this.#art.fillStyle(colour, player.connected ? 1 : 0.35).fillCircle(x, y, 14);
    if (!player.connected) this.#art.lineStyle(2, 0xff6577, 1).lineBetween(x - 10, y - 10, x + 10, y + 10);
    if (player.routeKind === 'threshold-stop') this.#art.lineStyle(2, 0xffcc6e, 1).strokeCircle(x, y, 21);
    const label = this.#playerLabels[index];
    if (label !== undefined) label.setText(index === 0 ? '1' : '2').setPosition(x, y - 1).setVisible(true);
  }

  #drawReticle(now: number): void {
    this.#reticle.clear();
    if (this.#reticleState === null) return;
    if (now > this.#reticleState.expires) { this.#reticleState = null; return; }
    const progress = (this.#reticleState.expires - now) / 700;
    this.#reticle.lineStyle(2, this.#reticleState.colour, progress).strokeCircle(this.#reticleState.x, this.#reticleState.y, 10 + (1 - progress) * 13);
  }
}
