import Phaser from 'phaser';
import {
  CELL_SIZE,
  GRID_HEIGHT,
  GRID_WIDTH,
  LEVEL_CATALOG,
  LEVEL_ONE,
  type GridPoint,
  type WorldPoint,
} from '../game/index.ts';
import type { CoopSnapshot, RemotePlayer } from './state.ts';

const BOARD_X = 64;
const BOARD_Y = 72;
const BOARD_WIDTH = GRID_WIDTH * CELL_SIZE;
const BOARD_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const TELEPORTER_COLOURS = [0x66e1ff, 0xffb45f] as const;

type Level = (typeof LEVEL_CATALOG)[number];
type SceneCue = 'plate' | 'door' | 'completion';

export interface SceneBridge {
  getSnapshot: () => CoopSnapshot;
  getPlayerId: () => string | null;
  sendTarget: (target: WorldPoint) => void;
  onGesture: () => void;
}

interface RenderPlayer extends RemotePlayer {
  drawX: number;
  drawY: number;
}

function levelFor(levelId: string): Level {
  return LEVEL_CATALOG.find((level) => level.id === levelId) ?? LEVEL_ONE;
}

function mechanismLabel(id: string): string {
  if (id.includes('alpha') || id.endsWith('_a')) return 'A';
  if (id.includes('beta') || id.endsWith('_b')) return 'B';
  return '';
}

function cellCenter(point: GridPoint): WorldPoint {
  return {
    x: BOARD_X + (point.x + 0.5) * CELL_SIZE,
    y: BOARD_Y + (point.y + 0.5) * CELL_SIZE,
  };
}

export class FacilityScene extends Phaser.Scene {
  #bridge: SceneBridge;
  #art!: Phaser.GameObjects.Graphics;
  #reticle!: Phaser.GameObjects.Graphics;
  #playerLabels: Phaser.GameObjects.Text[] = [];
  #levelLabels: Phaser.GameObjects.Text[] = [];
  #players: RenderPlayer[] = [];
  #renderedLevelId = '';
  #reticleState: { x: number; y: number; colour: number; expires: number } | null = null;
  #lastActivationCount = 0;
  #lastDoor = false;
  #lastComplete = false;
  #lastLevelEpoch = -1;
  #notifyCue: ((cue: SceneCue) => void) | null = null;

  constructor(bridge: SceneBridge) {
    super({ key: 'facility' });
    this.#bridge = bridge;
  }

  setCueListener(listener: (cue: SceneCue) => void): void {
    this.#notifyCue = listener;
  }

  setMoveFeedback(accepted: boolean, routeKind?: string): void {
    if (this.#reticleState !== null) {
      this.#reticleState.colour = !accepted
        ? 0xff6577
        : routeKind === 'threshold-stop'
          ? 0xffcc6e
          : 0x91f3b0;
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
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#07151b',
      fontStyle: 'bold',
    }).setOrigin(0.5));
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.#onPointer(pointer));
  }

  override update(_time: number, delta: number): void {
    const snapshot = this.#bridge.getSnapshot();
    const level = levelFor(snapshot.levelId);
    const levelEpochChanged = this.#lastLevelEpoch !== snapshot.levelEpoch;
    if (this.#renderedLevelId !== level.id) this.#rebuildLevelLabels(level);
    else if (levelEpochChanged) {
      this.#players = [];
      this.#reticleState = null;
    }

    this.#synchronizePlayers(snapshot.players, Math.min(1, delta / 100));
    const activationCount = snapshot.pressurePlates.filter(({ occupied }) => occupied).length
      + snapshot.teleporters.filter(({ powered }) => powered).length
      + snapshot.keycards.filter(({ collected }) => collected).length
      + snapshot.relayButtons.filter(({ occupiedBy }) => occupiedBy !== null).length;

    if (levelEpochChanged) {
      this.#lastLevelEpoch = snapshot.levelEpoch;
      this.#lastActivationCount = activationCount;
      this.#lastDoor = snapshot.doorOpen;
      this.#lastComplete = snapshot.phase === 'completed';
    } else {
      if (activationCount > this.#lastActivationCount) this.#notifyCue?.('plate');
      if (snapshot.doorOpen && !this.#lastDoor) this.#notifyCue?.('door');
      if (snapshot.phase === 'completed' && !this.#lastComplete) this.#notifyCue?.('completion');
      this.#lastActivationCount = activationCount;
      this.#lastDoor = snapshot.doorOpen;
      this.#lastComplete = snapshot.phase === 'completed';
    }

    this.#draw(level, snapshot, this.time.now);
  }

  #onPointer(pointer: Phaser.Input.Pointer): void {
    this.#bridge.onGesture();
    const worldX = pointer.x - BOARD_X;
    const worldY = pointer.y - BOARD_Y;
    const snapshot = this.#bridge.getSnapshot();
    if (
      snapshot.phase !== 'playing'
      || worldX < 0
      || worldY < 0
      || worldX >= BOARD_WIDTH
      || worldY >= BOARD_HEIGHT
    ) return;
    this.#reticleState = {
      x: pointer.x,
      y: pointer.y,
      colour: 0x7ee8ff,
      expires: this.time.now + 700,
    };
    this.#bridge.sendTarget({ x: worldX, y: worldY });
  }

  #rebuildLevelLabels(level: Level): void {
    for (const label of this.#levelLabels) label.destroy();
    this.#levelLabels = [];
    this.#players = [];
    this.#reticleState = null;
    this.#renderedLevelId = level.id;

    for (const pressurePlate of level.pressurePlates) {
      this.#addLevelLabel(
        `PLATE ${mechanismLabel(pressurePlate.id)}`,
        pressurePlate.grid,
        '#d6ffe0',
      );
    }
    level.teleporters.forEach((teleporter, index) => {
      const letter = mechanismLabel(teleporter.id);
      const colour = index === 0 ? '#b8f5ff' : '#ffddb8';
      this.#addLevelLabel(`${letter} POWER`, teleporter.power.grid, colour);
      for (const pad of teleporter.pads) {
        this.#addLevelLabel(`${letter} PAD`, pad.grid, colour);
      }
    });
    for (const keycard of level.keycards) {
      this.#addLevelLabel(
        `CARD ${mechanismLabel(keycard.id)}`,
        keycard.grid,
        '#ffe79e',
      );
    }
    for (const relay of level.relayButtons) {
      this.#addLevelLabel(
        `GATE ${mechanismLabel(relay.id)}`,
        relay.grid,
        '#e4c5ff',
      );
    }
  }

  #addLevelLabel(text: string, point: GridPoint, colour: string): void {
    const center = cellCenter(point);
    this.#levelLabels.push(this.add.text(center.x, BOARD_Y + point.y * CELL_SIZE + 4, text, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '9px',
      color: colour,
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5, 0).setDepth(2));
  }

  #synchronizePlayers(remote: RemotePlayer[], amount: number): void {
    this.#players = remote.map((player, index) => {
      const previous = this.#players[index];
      return {
        ...player,
        drawX: previous?.id === player.id
          ? Phaser.Math.Linear(previous.drawX, player.worldX, amount)
          : player.worldX,
        drawY: previous?.id === player.id
          ? Phaser.Math.Linear(previous.drawY, player.worldY, amount)
          : player.worldY,
      };
    });
  }

  #draw(level: Level, snapshot: CoopSnapshot, now: number): void {
    const art = this.#art;
    art.clear();
    art.fillStyle(0x071116, 1).fillRect(0, 0, 1280, 720);
    art.fillStyle(0x10232b, 1).fillRoundedRect(42, 50, 1196, 620, 14);
    art.fillStyle(0x0b1b22, 1).fillRect(BOARD_X, BOARD_Y, BOARD_WIDTH, BOARD_HEIGHT);

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const offset = (x + y) % 2 === 0 ? 0x15313a : 0x122b33;
        art.fillStyle(offset, 1).fillRect(
          BOARD_X + x * CELL_SIZE + 1,
          BOARD_Y + y * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
        );
        art.lineStyle(1, 0x244650, 0.38).strokeRect(
          BOARD_X + x * CELL_SIZE,
          BOARD_Y + y * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
        );
      }
    }
    art.fillStyle(0x091419, 1).fillRect(BOARD_X - 8, BOARD_Y - 8, BOARD_WIDTH + 16, 8);
    art.fillStyle(0x091419, 1).fillRect(BOARD_X - 8, BOARD_Y + BOARD_HEIGHT, BOARD_WIDTH + 16, 8);
    art.lineStyle(2, 0x3c7380, 0.7).strokeRect(
      BOARD_X - 1,
      BOARD_Y - 1,
      BOARD_WIDTH + 2,
      BOARD_HEIGHT + 2,
    );

    for (const wallKey of level.walls) {
      const [rawX, rawY] = wallKey.split(',');
      const x = Number(rawX);
      const y = Number(rawY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const sx = BOARD_X + x * CELL_SIZE;
      const sy = BOARD_Y + y * CELL_SIZE;
      art.fillStyle(0x1a2930, 1).fillRoundedRect(sx + 3, sy + 3, CELL_SIZE - 6, CELL_SIZE - 6, 5);
      art.fillStyle(0x38515a, 1).fillRect(sx + 7, sy + 7, CELL_SIZE - 14, 7);
      art.fillStyle(0x0d1419, 1).fillRect(sx + 8, sy + 20, CELL_SIZE - 16, 18);
    }

    for (const pressurePlate of level.pressurePlates) {
      const remote = snapshot.pressurePlates.find(({ id }) => id === pressurePlate.id);
      const legacyPressed = pressurePlate.id === 'plate_a'
        ? snapshot.nearPlatePressed
        : pressurePlate.id === 'plate_b' && snapshot.farPlatePressed;
      this.#drawPressurePlate(
        pressurePlate.grid,
        remote?.occupied === true || legacyPressed,
      );
    }

    level.teleporters.forEach((teleporter, index) => {
      const remote = snapshot.teleporters.find(({ id }) => id === teleporter.id);
      const powered = remote?.powered === true;
      const colour = TELEPORTER_COLOURS[index % TELEPORTER_COLOURS.length] ?? TELEPORTER_COLOURS[0];
      this.#drawCircuit(
        teleporter.power.grid,
        teleporter.pads.map(({ grid }) => grid),
        powered,
        colour,
      );
      this.#drawPowerButton(teleporter.power.grid, powered, colour);
      for (const pad of teleporter.pads) {
        this.#drawTeleporterPad(pad.grid, powered, colour, now);
      }
    });

    for (const keycard of level.keycards) {
      const remote = snapshot.keycards.find(({ id }) => id === keycard.id);
      const collected = remote?.collected === true || snapshot.collectedKeycardIds.includes(keycard.id);
      this.#drawKeycard(keycard.grid, collected);
    }

    for (const relay of level.relayButtons) {
      const remote = snapshot.relayButtons.find(({ id }) => id === relay.id);
      this.#drawRelayButton(relay.grid, remote?.occupiedBy ?? null);
    }

    this.#drawExit(level.exitCells, now);
    const latched = snapshot.latchedGateIds.includes(level.doorId);
    this.#drawGate(level.doorCells, snapshot.doorOpen, latched, now);
    if (!snapshot.doorOpen) {
      for (const threshold of [level.leftThreshold, level.rightThreshold]) {
        const center = cellCenter(threshold);
        art.lineStyle(2, 0xffcc6e, 0.65).strokeCircle(center.x, center.y, 15);
      }
    }

    const localId = this.#bridge.getPlayerId();
    this.#players.forEach((player, index) => this.#drawPlayer(player, index, localId));
    this.#drawReticle(now);
  }

  #drawPressurePlate(point: GridPoint, occupied: boolean): void {
    const x = BOARD_X + point.x * CELL_SIZE;
    const y = BOARD_Y + point.y * CELL_SIZE;
    this.#art
      .fillStyle(occupied ? 0x9bf4ad : 0x346750, occupied ? 1 : 0.9)
      .fillRoundedRect(x + 8, y + 8, CELL_SIZE - 16, CELL_SIZE - 16, 7);
    this.#art
      .lineStyle(occupied ? 3 : 2, occupied ? 0xe9ffb9 : 0x7adf99, 1)
      .strokeRoundedRect(x + 8, y + 8, CELL_SIZE - 16, CELL_SIZE - 16, 7);
  }

  #drawCircuit(
    power: GridPoint,
    pads: readonly GridPoint[],
    powered: boolean,
    colour: number,
  ): void {
    const source = cellCenter(power);
    for (const pad of pads) {
      const target = cellCenter(pad);
      this.#art.lineStyle(powered ? 3 : 2, colour, powered ? 0.72 : 0.18);
      this.#art.beginPath();
      this.#art.moveTo(source.x, source.y);
      this.#art.lineTo(target.x, source.y);
      this.#art.lineTo(target.x, target.y);
      this.#art.strokePath();
      this.#art.fillStyle(colour, powered ? 0.9 : 0.35).fillCircle(target.x, source.y, 3);
    }
  }

  #drawPowerButton(point: GridPoint, powered: boolean, colour: number): void {
    const x = BOARD_X + point.x * CELL_SIZE;
    const y = BOARD_Y + point.y * CELL_SIZE;
    this.#art
      .fillStyle(powered ? colour : 0x263c43, powered ? 0.95 : 0.9)
      .fillRoundedRect(x + 9, y + 9, CELL_SIZE - 18, CELL_SIZE - 18, 4);
    this.#art
      .lineStyle(powered ? 3 : 2, powered ? 0xf4ffff : colour, powered ? 1 : 0.55)
      .strokeRoundedRect(x + 9, y + 9, CELL_SIZE - 18, CELL_SIZE - 18, 4);
    this.#art.lineStyle(2, powered ? 0x071116 : colour, 0.9)
      .lineBetween(x + 17, y + 24, x + 31, y + 24);
  }

  #drawTeleporterPad(point: GridPoint, powered: boolean, colour: number, now: number): void {
    const center = cellCenter(point);
    const pulse = powered ? 0.72 + Math.sin(now / 150) * 0.2 : 0.22;
    this.#art.fillStyle(colour, pulse * 0.35).fillCircle(center.x, center.y, 17);
    this.#art.lineStyle(powered ? 4 : 2, colour, powered ? pulse : 0.45).strokeCircle(center.x, center.y, 17);
    this.#art.lineStyle(1, powered ? 0xf2ffff : colour, powered ? 0.95 : 0.3)
      .strokeCircle(center.x, center.y, 10);
    if (!powered) {
      this.#art.lineStyle(2, 0x6d7f84, 0.75)
        .lineBetween(center.x - 9, center.y - 9, center.x + 9, center.y + 9);
    }
  }

  #drawKeycard(point: GridPoint, collected: boolean): void {
    const x = BOARD_X + point.x * CELL_SIZE;
    const y = BOARD_Y + point.y * CELL_SIZE;
    this.#art
      .fillStyle(collected ? 0x304044 : 0xf2c85b, collected ? 0.45 : 1)
      .fillRoundedRect(x + 11, y + 14, CELL_SIZE - 22, CELL_SIZE - 28, 4);
    this.#art
      .lineStyle(2, collected ? 0x8ea0a4 : 0xfff0a8, collected ? 0.5 : 1)
      .strokeRoundedRect(x + 11, y + 14, CELL_SIZE - 22, CELL_SIZE - 28, 4);
    this.#art.fillStyle(collected ? 0x52666a : 0x6b5420, 1).fillCircle(x + 18, y + 24, 3);
    if (collected) {
      this.#art.lineStyle(3, 0x9bf4ad, 0.9)
        .lineBetween(x + 17, y + 25, x + 22, y + 30)
        .lineBetween(x + 22, y + 30, x + 32, y + 18);
    }
  }

  #drawRelayButton(point: GridPoint, occupiedBy: string | null): void {
    const center = cellCenter(point);
    const occupied = occupiedBy !== null;
    this.#art.fillStyle(occupied ? 0xd3a7ff : 0x503a66, occupied ? 1 : 0.86)
      .fillCircle(center.x, center.y, 14);
    this.#art.lineStyle(occupied ? 3 : 2, occupied ? 0xf7eaff : 0xb98cde, 1)
      .strokeCircle(center.x, center.y, 14);
    this.#art.lineStyle(2, occupied ? 0x4c286a : 0xc9a6e7, 0.9)
      .lineBetween(center.x - 6, center.y, center.x + 6, center.y);
  }

  #drawExit(cells: readonly GridPoint[], now: number): void {
    if (cells.length === 0) return;
    const pulse = 0.55 + Math.sin(now / 230) * 0.15;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const cell of cells) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
      this.#art.fillStyle(0x315f87, pulse).fillRect(
        BOARD_X + cell.x * CELL_SIZE + 5,
        BOARD_Y + cell.y * CELL_SIZE + 5,
        CELL_SIZE - 10,
        CELL_SIZE - 10,
      );
    }
    this.#art.lineStyle(2, 0x8fc9e8, 0.85).strokeRect(
      BOARD_X + minX * CELL_SIZE + 5,
      BOARD_Y + minY * CELL_SIZE + 5,
      (maxX - minX + 1) * CELL_SIZE - 10,
      (maxY - minY + 1) * CELL_SIZE - 10,
    );
  }

  #drawGate(cells: readonly GridPoint[], open: boolean, latched: boolean, now: number): void {
    for (const cell of cells) {
      const sx = BOARD_X + cell.x * CELL_SIZE;
      const sy = BOARD_Y + cell.y * CELL_SIZE;
      const slide = open ? 30 + Math.sin(now / 150) * 2 : 0;
      const panelWidth = (CELL_SIZE - 8 - slide) / 2;
      this.#art.fillStyle(open ? (latched ? 0x8be9af : 0x72d6df) : 0x81465c, 1);
      this.#art.fillRect(sx + 4, sy + 4, panelWidth, CELL_SIZE - 8);
      this.#art.fillRect(sx + CELL_SIZE / 2 + slide / 2, sy + 4, panelWidth, CELL_SIZE - 8);
      this.#art.lineStyle(1, latched ? 0xe7ffbd : 0xd2faff, 0.75);
      this.#art.strokeRect(sx + 4, sy + 4, panelWidth, CELL_SIZE - 8);
      this.#art.strokeRect(
        sx + CELL_SIZE / 2 + slide / 2,
        sy + 4,
        panelWidth,
        CELL_SIZE - 8,
      );
      if (latched) {
        this.#art.fillStyle(0xe7ffbd, 0.95).fillCircle(sx + CELL_SIZE / 2, sy + 8, 3);
      }
    }
  }

  #drawPlayer(player: RenderPlayer, index: number, localId: string | null): void {
    const x = BOARD_X + player.drawX;
    const y = BOARD_Y + player.drawY;
    const local = player.id === localId;
    const colour = index === 0 ? 0x5be1f0 : 0xffae5f;
    this.#art.fillStyle(0x000000, 0.26).fillCircle(x + 3, y + 5, 16);
    this.#art.lineStyle(local ? 3 : 1, local ? 0xffffff : 0x16252b, 1).strokeCircle(x, y, 17);
    this.#art.fillStyle(colour, player.connected ? 1 : 0.35).fillCircle(x, y, 14);
    if (!player.connected) {
      this.#art.lineStyle(2, 0xff6577, 1).lineBetween(x - 10, y - 10, x + 10, y + 10);
    }
    if (player.routeKind === 'threshold-stop') {
      this.#art.lineStyle(2, 0xffcc6e, 1).strokeCircle(x, y, 21);
    }
    const label = this.#playerLabels[index];
    if (label !== undefined) {
      label.setText(index === 0 ? '1' : '2').setPosition(x, y - 1).setVisible(true);
    }
  }

  #drawReticle(now: number): void {
    this.#reticle.clear();
    if (this.#reticleState === null) return;
    if (now > this.#reticleState.expires) {
      this.#reticleState = null;
      return;
    }
    const progress = (this.#reticleState.expires - now) / 700;
    this.#reticle
      .lineStyle(2, this.#reticleState.colour, progress)
      .strokeCircle(
        this.#reticleState.x,
        this.#reticleState.y,
        10 + (1 - progress) * 13,
      );
  }
}
