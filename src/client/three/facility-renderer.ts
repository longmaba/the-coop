import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LoopOnce,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFShadowMap,
  Plane,
  PointLight,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import {
  CSS2DObject,
  CSS2DRenderer,
} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { WorldPoint } from '../../game/types.ts';
import type { CoopSnapshot, RemotePlayer } from '../state.ts';
import {
  cloneAvatarAsset,
  cloneEnvironmentAsset,
  getThreeAssetDiagnostics,
  normalizeAndGroundAvatar,
  preloadThreeAssets,
  type AvatarAssetId,
  type EnvironmentAssetId,
} from './assets.ts';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
} from '../../game/constants.ts';
import {
  BOARD_BOUNDS,
  sceneToWorld,
  SCENE_CELL_SIZE,
  worldToScene,
} from './coordinates.ts';
import {
  getLevelVisualPlan,
  type CardinalDirection,
  type LevelVisualPlan,
  type MechanismPlacement,
} from './level-visuals.ts';

const CAMERA_ELEVATION = MathUtils.radToDeg(Math.asin(1 / Math.sqrt(3)));
const CAMERA_AZIMUTH = 45;
const CAMERA_DISTANCE = 160;
const CAMERA_TARGET_Y = 1.8;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 400;
const CAMERA_MARGIN = SCENE_CELL_SIZE * 1.4;
const MAX_POINT_LIGHTS = 4;
const TELEPORT_SNAP_DISTANCE = 72;
const WALL_HEIGHT = 4.25;
const PLAYER_HEIGHT = 4.2;

const COLOURS = Object.freeze({
  pending: 0x7ee8ff,
  accepted: 0x91f3b0,
  threshold: 0xffcc6e,
  rejected: 0xff6577,
  pressure: 0x78e6b0,
  teleporterAlpha: 0x56d7e9,
  teleporterBeta: 0xffb84d,
  relay: 0xb78cff,
  keycard: 0xf4d35e,
  exit: 0x8fc9e8,
  local: 0xf6c85f,
  partner: 0xc3b6ff,
  offline: 0xff6f7d,
});

export type SceneCue = 'plate' | 'door' | 'completion';

export interface SceneBridge {
  getSnapshot: () => CoopSnapshot;
  getPlayerId: () => string | null;
  sendTarget: (target: WorldPoint) => void;
  onGesture: () => void;
}

export interface FacilityRendererDiagnostics {
  readonly ready: boolean;
  readonly levelId: string;
  readonly cameraElevation: number;
  readonly cameraAzimuth: number;
  readonly canvasCount: number;
  readonly rafActive: boolean;
  readonly assets: number;
  readonly floors: number;
  readonly walls: number;
  readonly doors: number;
  readonly gateAnimations: readonly {
    readonly time: number;
    readonly duration: number;
    readonly travel: number;
  }[];
  readonly mechanisms: number;
  readonly players: number;
  readonly renderer: {
    readonly calls: number;
    readonly triangles: number;
    readonly geometries: number;
    readonly textures: number;
  };
}

interface AssetPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY?: number;
  readonly scale?: number | Vector3;
}

interface ReticleState {
  readonly point: Vector3;
  colour: number;
  expiresAt: number;
  duration: number;
}

interface GateVisual {
  readonly root: Group;
  readonly animatedPart: Object3D;
  readonly closedPosition: Vector3;
  readonly mixer: AnimationMixer;
  readonly action: AnimationAction;
  readonly duration: number;
  readonly statusMaterial: MeshStandardMaterial;
  time: number;
}

export function sampleAnimationPose(
  mixer: AnimationMixer,
  action: AnimationAction,
  time: number,
): void {
  action.paused = false;
  mixer.setTime(time);
  action.paused = true;
}

interface PlayerMaterialState {
  readonly material: Material;
  readonly originalOpacity: number;
  readonly originalTransparent: boolean;
}

interface PlayerVisual {
  readonly id: string;
  readonly root: Group;
  readonly model: Group;
  readonly mixer: AnimationMixer;
  readonly idleAction: AnimationAction | null;
  readonly walkAction: AnimationAction | null;
  readonly localRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly thresholdRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly label: CSS2DObject;
  readonly materialStates: readonly PlayerMaterialState[];
  drawX: number;
  drawY: number;
  initialized: boolean;
  activeClip: 'idle' | 'walk' | null;
}

interface SignalVisual {
  readonly placement: MechanismPlacement;
  readonly root: Group;
  readonly marker: MeshStandardMaterial;
  readonly accentMaterials: readonly MeshBasicMaterial[];
  readonly baseColour: Color;
  readonly activeColour: Color;
  readonly lightPriority: number;
  active: boolean;
}

interface CircuitVisual {
  readonly teleporterId: string;
  readonly materials: readonly MeshStandardMaterial[];
}

interface LevelResources {
  readonly geometries: Set<BufferGeometry>;
  readonly materials: Set<Material>;
  readonly instances: Set<InstancedMesh>;
  readonly labels: Set<HTMLElement>;
}

function directionOffset(direction: CardinalDirection): { x: number; z: number } {
  switch (direction) {
    case 'north': return { x: 0, z: -1 };
    case 'east': return { x: 1, z: 0 };
    case 'south': return { x: 0, z: 1 };
    case 'west': return { x: -1, z: 0 };
  }
}

function teleporterColour(id: string): number {
  return id.includes('beta') ? COLOURS.teleporterBeta : COLOURS.teleporterAlpha;
}

function inactiveColour(colour: number): Color {
  return new Color(colour).multiplyScalar(0.33);
}

function mechanismKey(placement: MechanismPlacement): string {
  if (placement.kind === 'exit') return `${placement.kind}:${placement.id}:${placement.cellIndex}`;
  return `${placement.kind}:${placement.id}`;
}

function mechanismLabel(placement: MechanismPlacement): string {
  const suffix = placement.id.includes('beta') || placement.id.endsWith('_b') ? 'B' : 'A';
  switch (placement.kind) {
    case 'pressure-plate': return suffix;
    case 'teleporter-power': return `Power ${suffix}`;
    case 'teleporter-pad': return `Pad ${suffix}`;
    case 'keycard': return `Card ${suffix}`;
    case 'relay': return `Relay ${suffix}`;
    case 'exit': return 'Exit';
    case 'threshold': return '';
  }
}

function createLabel(text: string, className: string, kind?: string): CSS2DObject {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  if (kind !== undefined) element.dataset.kind = kind;
  return new CSS2DObject(element);
}

function setObjectShadows(root: Object3D, cast: boolean, receive: boolean): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = cast;
    object.receiveShadow = receive;
  });
}

function clonePlayerMaterials(root: Object3D): PlayerMaterialState[] {
  const states: PlayerMaterialState[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) {
      const cloned = object.material.map((material) => material.clone());
      object.material = cloned;
      for (const material of cloned) {
        states.push({
          material,
          originalOpacity: material.opacity,
          originalTransparent: material.transparent,
        });
      }
      return;
    }
    const material = object.material.clone();
    object.material = material;
    states.push({
      material,
      originalOpacity: material.opacity,
      originalTransparent: material.transparent,
    });
  });
  return states;
}

function disposeMaterial(material: Material): void {
  material.dispose();
}

function matrixForPlacement(placement: AssetPlacement): Matrix4 {
  const scale = typeof placement.scale === 'number'
    ? new Vector3(placement.scale, placement.scale, placement.scale)
    : placement.scale?.clone() ?? new Vector3(1, 1, 1);
  return new Matrix4().compose(
    new Vector3(placement.x, placement.y, placement.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), placement.rotationY ?? 0),
    scale,
  );
}

function setSignalMaterial(
  visual: SignalVisual,
  active: boolean,
  pulse: number,
): void {
  visual.active = active;
  visual.marker.color.copy(active ? visual.activeColour : visual.baseColour);
  visual.marker.emissive.copy(visual.activeColour);
  visual.marker.emissiveIntensity = active ? 0.92 + pulse * 0.22 : 0.2;
  for (const material of visual.accentMaterials) {
    material.color.copy(active ? visual.activeColour : visual.baseColour);
    material.opacity = active ? 0.72 + pulse * 0.2 : 0.34;
  }
}

export class FacilityRenderer {
  readonly #bridge: SceneBridge;
  readonly #scene = new Scene();
  readonly #camera = new OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
  readonly #raycaster = new Raycaster();
  readonly #pointerNdc = new Vector2();
  readonly #groundPlane = new Plane(new Vector3(0, 1, 0), -0.06);
  readonly #levelRoot = new Group();
  readonly #playerRoot = new Group();
  readonly #gates: GateVisual[] = [];
  readonly #signals = new Map<string, SignalVisual>();
  readonly #circuits: CircuitVisual[] = [];
  readonly #players = new Map<string, PlayerVisual>();
  readonly #pointLights: PointLight[] = [];
  readonly #levelResources: LevelResources = {
    geometries: new Set(),
    materials: new Set(),
    instances: new Set(),
    labels: new Set(),
  };
  readonly #persistentGeometries = new Set<BufferGeometry>();
  readonly #persistentMaterials = new Set<Material>();
  readonly #reticleRoot = new Group();
  readonly #reticleMaterial = new MeshBasicMaterial({
    color: COLOURS.pending,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  #renderer: WebGLRenderer | null = null;
  #labelRenderer: CSS2DRenderer | null = null;
  #container: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #rafId: number | null = null;
  #ready = false;
  #destroyed = false;
  #renderedLevelId = '';
  #lastLevelEpoch = -1;
  #lastFrameTime = 0;
  #frozenVisualTime: number | null = null;
  #reticleState: ReticleState | null = null;
  #notifyCue: ((cue: SceneCue) => void) | null = null;
  #lastActivationCount = 0;
  #lastDoor = false;
  #lastComplete = false;
  #currentPlan: LevelVisualPlan | null = null;

  constructor(bridge: SceneBridge) {
    this.#bridge = bridge;
    this.#scene.add(this.#levelRoot, this.#playerRoot, this.#reticleRoot);

    const reticleGeometry = new RingGeometry(0.7, 0.86, 36);
    reticleGeometry.rotateX(-Math.PI / 2);
    const reticle = new Mesh(reticleGeometry, this.#reticleMaterial);
    reticle.renderOrder = 20;
    this.#reticleRoot.add(reticle);
    this.#reticleRoot.visible = false;
    this.#persistentGeometries.add(reticleGeometry);
    this.#persistentMaterials.add(this.#reticleMaterial);
  }

  setCueListener(listener: (cue: SceneCue) => void): void {
    this.#notifyCue = listener;
  }

  setMoveFeedback(accepted: boolean, routeKind?: string): void {
    if (this.#reticleState === null) return;
    this.#reticleState.colour = !accepted
      ? COLOURS.rejected
      : routeKind === 'threshold-stop'
        ? COLOURS.threshold
        : COLOURS.accepted;
    this.#reticleState.expiresAt = this.#visualNow() + 450;
    this.#reticleState.duration = 450;
  }

  setVisualTime(milliseconds: number | null): void {
    this.#frozenVisualTime = milliseconds !== null && Number.isFinite(milliseconds)
      ? Math.max(0, milliseconds)
      : null;
  }

  async start(container: HTMLElement): Promise<void> {
    if (this.#ready) return;
    if (this.#destroyed) throw new Error('Cannot start a destroyed facility renderer.');
    await preloadThreeAssets();
    if (this.#destroyed) return;

    this.#container = container;
    this.#renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFShadowMap;
    this.#renderer.setClearColor(0x0e1420, 1);
    this.#renderer.domElement.setAttribute('aria-hidden', 'true');

    this.#labelRenderer = new CSS2DRenderer();
    this.#labelRenderer.domElement.className = 'facility-label-layer';
    this.#labelRenderer.domElement.setAttribute('aria-hidden', 'true');

    container.append(this.#renderer.domElement, this.#labelRenderer.domElement);
    this.#installLighting();
    this.#configureCamera();
    this.#installPointLights();
    this.#installBackdrop();
    this.#resize();

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#renderer.domElement.addEventListener('pointerdown', this.#onPointerDown);

    const snapshot = this.#bridge.getSnapshot();
    this.#rebuildLevel(snapshot.levelId);
    this.#lastLevelEpoch = snapshot.levelEpoch;
    this.#synchronizePlayers(snapshot.players, 0, true);
    this.#updateMechanisms(snapshot, this.#visualNow());
    this.#updateGates(snapshot, 0, true);

    this.#ready = true;
    this.#lastFrameTime = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  worldToScreen(point: WorldPoint): WorldPoint {
    const container = this.#container;
    if (container === null) return { x: point.x, y: point.y };
    const scenePoint = worldToScene(point);
    const projected = new Vector3(scenePoint.x, 0.08, scenePoint.z).project(this.#camera);
    const rect = container.getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - projected.y) * 0.5 * rect.height,
    };
  }

  getDiagnostics(): FacilityRendererDiagnostics {
    const rendererInfo = this.#renderer?.info;
    const plan = this.#currentPlan;
    return {
      ready: this.#ready,
      levelId: this.#renderedLevelId,
      cameraElevation: CAMERA_ELEVATION,
      cameraAzimuth: CAMERA_AZIMUTH,
      canvasCount: this.#container?.querySelectorAll('canvas').length ?? 0,
      rafActive: this.#rafId !== null,
      assets: this.#ready ? getThreeAssetDiagnostics().length : 0,
      floors: plan?.floors.length ?? 0,
      walls: (plan?.wallEdges.length ?? 0) + (plan?.wallTops.length ?? 0),
      doors: plan?.doors.length ?? 0,
      gateAnimations: this.#gates.map((gate) => ({
        time: gate.time,
        duration: gate.duration,
        travel: gate.animatedPart.position.distanceTo(gate.closedPosition),
      })),
      mechanisms: plan?.mechanisms.length ?? 0,
      players: this.#players.size,
      renderer: {
        calls: rendererInfo?.render.calls ?? 0,
        triangles: rendererInfo?.render.triangles ?? 0,
        geometries: rendererInfo?.memory.geometries ?? 0,
        textures: rendererInfo?.memory.textures ?? 0,
      },
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#ready = false;
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#renderer?.domElement.removeEventListener('pointerdown', this.#onPointerDown);

    this.#disposeLevel();
    for (const visual of this.#players.values()) {
      visual.mixer.stopAllAction();
      visual.label.element.remove();
      visual.localRing.geometry.dispose();
      visual.localRing.material.dispose();
      visual.thresholdRing.geometry.dispose();
      visual.thresholdRing.material.dispose();
      for (const state of visual.materialStates) disposeMaterial(state.material);
    }
    this.#players.clear();
    for (const geometry of this.#persistentGeometries) geometry.dispose();
    for (const material of this.#persistentMaterials) material.dispose();
    this.#persistentGeometries.clear();
    this.#persistentMaterials.clear();

    this.#labelRenderer?.domElement.remove();
    this.#renderer?.domElement.remove();
    this.#renderer?.dispose();
    this.#renderer?.forceContextLoss();
    this.#labelRenderer = null;
    this.#renderer = null;
    this.#container = null;
  }

  #visualNow(): number {
    return this.#frozenVisualTime ?? performance.now();
  }

  #installLighting(): void {
    const fill = new HemisphereLight(0xf4f2ff, 0x25273a, 2.25);
    this.#scene.add(fill);

    const key = new DirectionalLight(0xfff7e1, 3.2);
    key.position.set(32, 68, 38);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -70;
    key.shadow.camera.right = 70;
    key.shadow.camera.top = 55;
    key.shadow.camera.bottom = -55;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 180;
    key.shadow.bias = -0.00035;
    this.#scene.add(key);
  }

  #installPointLights(): void {
    for (let index = 0; index < MAX_POINT_LIGHTS; index += 1) {
      const light = new PointLight(0xffffff, 0, 8, 2);
      light.visible = false;
      this.#pointLights.push(light);
      this.#scene.add(light);
    }
  }

  #installBackdrop(): void {
    const geometry = new BoxGeometry(
      BOARD_BOUNDS.width + 8,
      0.8,
      BOARD_BOUNDS.depth + 8,
    );
    const material = new MeshStandardMaterial({
      color: 0x141b29,
      roughness: 0.92,
      metalness: 0.05,
    });
    const backdrop = new Mesh(geometry, material);
    backdrop.position.y = -0.48;
    backdrop.receiveShadow = true;
    this.#scene.add(backdrop);
    this.#persistentGeometries.add(geometry);
    this.#persistentMaterials.add(material);
  }

  #configureCamera(): void {
    const elevation = MathUtils.degToRad(CAMERA_ELEVATION);
    const azimuth = MathUtils.degToRad(CAMERA_AZIMUTH);
    const horizontal = CAMERA_DISTANCE * Math.cos(elevation);
    this.#camera.position.set(
      horizontal * Math.sin(azimuth),
      CAMERA_TARGET_Y + CAMERA_DISTANCE * Math.sin(elevation),
      horizontal * Math.cos(azimuth),
    );
    this.#camera.lookAt(0, CAMERA_TARGET_Y, 0);
    this.#camera.updateMatrixWorld(true);
  }

  #resize(): void {
    const renderer = this.#renderer;
    const labelRenderer = this.#labelRenderer;
    const container = this.#container;
    if (renderer === null || labelRenderer === null || container === null) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);

    this.#camera.updateMatrixWorld(true);
    const corners = [
      new Vector3(BOARD_BOUNDS.minX, 0, BOARD_BOUNDS.minZ),
      new Vector3(BOARD_BOUNDS.minX, 0, BOARD_BOUNDS.maxZ),
      new Vector3(BOARD_BOUNDS.maxX, 0, BOARD_BOUNDS.minZ),
      new Vector3(BOARD_BOUNDS.maxX, 0, BOARD_BOUNDS.maxZ),
      new Vector3(BOARD_BOUNDS.minX, 5.5, BOARD_BOUNDS.minZ),
      new Vector3(BOARD_BOUNDS.minX, 5.5, BOARD_BOUNDS.maxZ),
      new Vector3(BOARD_BOUNDS.maxX, 5.5, BOARD_BOUNDS.minZ),
      new Vector3(BOARD_BOUNDS.maxX, 5.5, BOARD_BOUNDS.maxZ),
    ].map((point) => point.applyMatrix4(this.#camera.matrixWorldInverse));
    const minX = Math.min(...corners.map(({ x }) => x)) - CAMERA_MARGIN;
    const maxX = Math.max(...corners.map(({ x }) => x)) + CAMERA_MARGIN;
    const minY = Math.min(...corners.map(({ y }) => y)) - CAMERA_MARGIN;
    const maxY = Math.max(...corners.map(({ y }) => y)) + CAMERA_MARGIN;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const requiredWidth = maxX - minX;
    const requiredHeight = maxY - minY;
    const aspect = width / height;
    const halfWidth = Math.max(requiredWidth / 2, requiredHeight * aspect / 2);
    const halfHeight = halfWidth / aspect;
    this.#camera.left = centerX - halfWidth;
    this.#camera.right = centerX + halfWidth;
    this.#camera.top = centerY + halfHeight;
    this.#camera.bottom = centerY - halfHeight;
    this.#camera.updateProjectionMatrix();
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    this.#bridge.onGesture();
    const renderer = this.#renderer;
    if (!this.#ready || renderer === null) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.#pointerNdc.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointerNdc, this.#camera);
    const hit = this.#raycaster.ray.intersectPlane(this.#groundPlane, new Vector3());
    if (hit === null) return;
    const snapshot = this.#bridge.getSnapshot();
    if (
      snapshot.phase !== 'playing'
      || hit.x < BOARD_BOUNDS.minX
      || hit.x >= BOARD_BOUNDS.maxX
      || hit.z < BOARD_BOUNDS.minZ
      || hit.z >= BOARD_BOUNDS.maxZ
    ) return;

    const target = sceneToWorld({ x: hit.x, z: hit.z });
    const now = this.#visualNow();
    this.#reticleState = {
      point: hit.clone(),
      colour: COLOURS.pending,
      expiresAt: now + 700,
      duration: 700,
    };
    this.#reticleRoot.position.set(hit.x, 0.1, hit.z);
    this.#reticleRoot.visible = true;
    this.#bridge.sendTarget(target);
  };

  readonly #tick = (time: number): void => {
    if (this.#destroyed || !this.#ready) return;
    const deltaSeconds = Math.min(0.05, Math.max(0, (time - this.#lastFrameTime) / 1000));
    this.#lastFrameTime = time;
    const snapshot = this.#bridge.getSnapshot();
    const levelChanged = snapshot.levelId !== this.#renderedLevelId;
    const epochChanged = snapshot.levelEpoch !== this.#lastLevelEpoch;
    if (levelChanged) this.#rebuildLevel(snapshot.levelId);
    if (epochChanged) {
      this.#lastLevelEpoch = snapshot.levelEpoch;
      this.#reticleState = null;
      this.#reticleRoot.visible = false;
    }

    this.#emitCues(snapshot, epochChanged);
    this.#synchronizePlayers(snapshot.players, deltaSeconds, levelChanged || epochChanged);
    const now = this.#visualNow();
    this.#updateMechanisms(snapshot, now);
    this.#updateGates(snapshot, deltaSeconds, levelChanged || epochChanged);
    this.#updateReticle(now);
    this.#renderer?.render(this.#scene, this.#camera);
    this.#labelRenderer?.render(this.#scene, this.#camera);
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #emitCues(snapshot: CoopSnapshot, epochChanged: boolean): void {
    const activationCount = snapshot.pressurePlates.filter(({ occupied }) => occupied).length
      + snapshot.teleporters.filter(({ powered }) => powered).length
      + snapshot.keycards.filter(({ collected }) => collected).length
      + snapshot.relayButtons.filter(({ occupiedBy }) => occupiedBy !== null).length;
    if (epochChanged) {
      this.#lastActivationCount = activationCount;
      this.#lastDoor = snapshot.doorOpen;
      this.#lastComplete = snapshot.phase === 'completed';
      return;
    }
    if (activationCount > this.#lastActivationCount) this.#notifyCue?.('plate');
    if (snapshot.doorOpen && !this.#lastDoor) this.#notifyCue?.('door');
    if (snapshot.phase === 'completed' && !this.#lastComplete) this.#notifyCue?.('completion');
    this.#lastActivationCount = activationCount;
    this.#lastDoor = snapshot.doorOpen;
    this.#lastComplete = snapshot.phase === 'completed';
  }

  #createInstancedAsset(
    id: EnvironmentAssetId,
    placements: readonly AssetPlacement[],
  ): Group {
    const output = new Group();
    if (placements.length === 0) return output;
    const prototype = cloneEnvironmentAsset(id).root;
    prototype.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(prototype, true);
    const center = bounds.getCenter(new Vector3());
    const normalize = new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);

    prototype.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const instanced = new InstancedMesh(object.geometry, object.material, placements.length);
      placements.forEach((placement, index) => {
        const matrix = matrixForPlacement(placement)
          .multiply(normalize)
          .multiply(object.matrixWorld);
        instanced.setMatrixAt(index, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      this.#levelResources.instances.add(instanced);
      output.add(instanced);
    });
    return output;
  }

  #rebuildLevel(levelId: string): void {
    this.#disposeLevel();
    const plan = getLevelVisualPlan(levelId);
    this.#currentPlan = plan;
    this.#renderedLevelId = plan.levelId;

    const floorPlacements = plan.floors.map((floor) => ({
      x: floor.position.x,
      y: 0,
      z: floor.position.z,
      rotationY: floor.rotationY,
    }));
    const normalFloors = floorPlacements.filter((_, index) => plan.floors[index]?.variant === 'normal');
    const detailFloors = floorPlacements.filter((_, index) => plan.floors[index]?.variant === 'detail');
    this.#levelRoot.add(
      this.#createInstancedAsset('floor', normalFloors),
      this.#createInstancedAsset('floorDetail', detailFloors),
    );

    const wallCaps = plan.wallTops.map((wall) => ({
      x: wall.position.x,
      y: WALL_HEIGHT - 0.02,
      z: wall.position.z,
      rotationY: wall.rotationY,
    }));
    this.#levelRoot.add(this.#createInstancedAsset('floor', wallCaps));

    const wallBuckets: Record<'wall' | 'wallDetail' | 'wallTop' | 'halfWall', AssetPlacement[]> = {
      wall: [],
      wallDetail: [],
      wallTop: [],
      halfWall: [],
    };
    plan.wallEdges.forEach((edge, index) => {
      const offset = directionOffset(edge.direction);
      const base = {
        x: edge.position.x + offset.x * 1.5,
        y: 0,
        z: edge.position.z + offset.z * 1.5,
        rotationY: edge.rotationY,
      };
      const cameraFacingPerimeter = (
        edge.direction === 'east' && edge.grid.x === GRID_WIDTH - 1
      ) || (
        edge.direction === 'south' && edge.grid.y === GRID_HEIGHT - 1
      );
      if (cameraFacingPerimeter) {
        const tangent = edge.direction === 'east'
          ? { x: 0, z: 1 }
          : { x: 1, z: 0 };
        for (const shift of [-1, 1]) {
          wallBuckets.halfWall.push({
            ...base,
            x: base.x + tangent.x * shift,
            z: base.z + tangent.z * shift,
            scale: new Vector3(1, 0.58, 1),
          });
        }
      } else if (edge.variant === 'detail') {
        wallBuckets.wallDetail.push(base);
      } else if (index % 17 === 0) {
        wallBuckets.wallTop.push(base);
      } else {
        wallBuckets.wall.push(base);
      }
    });
    this.#levelRoot.add(
      this.#createInstancedAsset('wall', wallBuckets.wall),
      this.#createInstancedAsset('wallDetail', wallBuckets.wallDetail),
      this.#createInstancedAsset('wallTop', wallBuckets.wallTop),
      this.#createInstancedAsset('halfWall', wallBuckets.halfWall),
    );

    const cornerPlacements = plan.wallCorners.map((corner) => {
      const first = directionOffset(corner.directions[0]);
      const second = directionOffset(corner.directions[1]);
      return {
        x: corner.position.x + (first.x + second.x) * 1.5,
        y: 0,
        z: corner.position.z + (first.z + second.z) * 1.5,
        rotationY: corner.rotationY,
      };
    });
    this.#levelRoot.add(this.#createInstancedAsset('wallCorner', cornerPlacements));

    this.#buildGates(plan);
    this.#buildMechanisms(plan);
    this.#buildCircuits(plan);
    this.#resize();
  }

  #buildGates(plan: LevelVisualPlan): void {
    for (const door of plan.doors) {
      const clone = cloneEnvironmentAsset('gateDoor');
      const bounds = new Box3().setFromObject(clone.root, true);
      const center = bounds.getCenter(new Vector3());
      clone.root.position.set(-center.x, -bounds.min.y, -center.z);
      setObjectShadows(clone.root, true, true);

      const wrapper = new Group();
      wrapper.position.set(door.position.x, 0.02, door.position.z);
      wrapper.rotation.y = door.passageAxis === 'x' ? Math.PI / 2 : 0;
      wrapper.scale.setScalar(0.95);
      wrapper.add(clone.root);

      const statusMaterial = this.#ownLevelMaterial(new MeshStandardMaterial({
        color: 0x81465c,
        emissive: 0x81465c,
        emissiveIntensity: 0.4,
        roughness: 0.25,
      }));
      const statusGeometry = this.#ownLevelGeometry(new SphereGeometry(0.16, 12, 8));
      const status = new Mesh(statusGeometry, statusMaterial);
      status.position.set(0, 4.3, 0.78);
      wrapper.add(status);
      this.#levelRoot.add(wrapper);

      const clip = clone.animations.find(({ name }) => name === 'open');
      if (clip === undefined) throw new Error('gate-door.glb is missing the open animation.');
      const mixer = new AnimationMixer(clone.root);
      const action = mixer.clipAction(clip);
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      sampleAnimationPose(mixer, action, 0);
      const animatedPart = clone.root.getObjectByName('door');
      if (animatedPart === undefined) throw new Error('gate-door.glb is missing its animated door node.');
      this.#gates.push({
        root: wrapper,
        animatedPart,
        closedPosition: animatedPart.position.clone(),
        mixer,
        action,
        duration: clip.duration,
        statusMaterial,
        time: 0,
      });
    }
  }

  #buildMechanisms(plan: LevelVisualPlan): void {
    const basePlacements: AssetPlacement[] = [];
    for (const placement of plan.mechanisms) {
      if (placement.kind === 'threshold') continue;
      const scale = placement.kind === 'teleporter-pad' || placement.kind === 'exit' ? 0.9 : 0.78;
      basePlacements.push({
        x: placement.position.x,
        y: 0.03,
        z: placement.position.z,
        rotationY: placement.rotationY,
        scale,
      });
    }
    this.#levelRoot.add(this.#createInstancedAsset('floorLayer', basePlacements));

    let exitLabelAdded = false;
    for (const placement of plan.mechanisms) {
      const visual = this.#createSignalVisual(placement);
      this.#signals.set(mechanismKey(placement), visual);
      this.#levelRoot.add(visual.root);

      const labelText = mechanismLabel(placement);
      const shouldLabel = labelText.length > 0 && (placement.kind !== 'exit' || !exitLabelAdded);
      if (shouldLabel) {
        const label = createLabel(labelText, 'world-label', placement.kind.replace('-pad', ''));
        label.position.set(0, placement.kind === 'teleporter-pad' ? 2.1 : 1.25, 0);
        visual.root.add(label);
        this.#levelResources.labels.add(label.element);
        if (placement.kind === 'exit') exitLabelAdded = true;
      }
    }
  }

  #createSignalVisual(placement: MechanismPlacement): SignalVisual {
    let colour: number = COLOURS.exit;
    let lightPriority = 0;
    switch (placement.kind) {
      case 'pressure-plate':
        colour = COLOURS.pressure;
        lightPriority = 3;
        break;
      case 'teleporter-power':
      case 'teleporter-pad':
        colour = teleporterColour(placement.teleporterId);
        lightPriority = placement.kind === 'teleporter-pad' ? 4 : 3;
        break;
      case 'relay':
        colour = COLOURS.relay;
        lightPriority = 3;
        break;
      case 'keycard':
        colour = COLOURS.keycard;
        lightPriority = 2;
        break;
      case 'threshold':
        colour = COLOURS.threshold;
        break;
      case 'exit':
        colour = COLOURS.exit;
        break;
    }

    const root = new Group();
    root.position.set(placement.position.x, 0.43, placement.position.z);
    const marker = this.#ownLevelMaterial(new MeshStandardMaterial({
      color: inactiveColour(colour),
      emissive: colour,
      emissiveIntensity: 0.2,
      metalness: 0.16,
      roughness: 0.38,
    }));
    const accents: MeshBasicMaterial[] = [];
    const addAccent = (geometry: BufferGeometry, opacity = 0.22): Mesh<BufferGeometry, MeshBasicMaterial> => {
      const material = this.#ownLevelMaterial(new MeshBasicMaterial({
        color: inactiveColour(colour),
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
      }));
      accents.push(material);
      const mesh = new Mesh(this.#ownLevelGeometry(geometry), material);
      mesh.renderOrder = 5;
      root.add(mesh);
      return mesh;
    };

    if (placement.kind === 'threshold') {
      const ring = addAccent(new TorusGeometry(1.15, 0.09, 8, 32), 0.55);
      ring.rotation.x = Math.PI / 2;
    } else if (placement.kind === 'pressure-plate') {
      const pad = new Mesh(
        this.#ownLevelGeometry(new BoxGeometry(2.5, 0.16, 2.5)),
        marker,
      );
      root.add(pad);
      const frame = addAccent(new TorusGeometry(1.54, 0.1, 8, 4), 0.54);
      frame.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    } else if (placement.kind === 'teleporter-pad') {
      const disc = new Mesh(
        this.#ownLevelGeometry(new CylinderGeometry(1.24, 1.24, 0.14, 32)),
        marker,
      );
      root.add(disc);
      const outer = addAccent(new TorusGeometry(1.38, 0.1, 8, 36));
      outer.rotation.x = Math.PI / 2;
      const inner = addAccent(new TorusGeometry(0.76, 0.06, 8, 28));
      inner.rotation.x = Math.PI / 2;
      const beam = addAccent(new CylinderGeometry(0.72, 0.72, 2.6, 20, 1, true), 0.04);
      beam.position.y = 1.35;
    } else if (placement.kind === 'teleporter-power') {
      const button = new Mesh(
        this.#ownLevelGeometry(new CylinderGeometry(0.92, 1.08, 0.22, 20)),
        marker,
      );
      root.add(button);
      const bar = addAccent(new BoxGeometry(1.05, 0.05, 0.18), 0.48);
      bar.position.y = 0.14;
    } else if (placement.kind === 'relay') {
      const button = new Mesh(
        this.#ownLevelGeometry(new CylinderGeometry(0.94, 1.08, 0.22, 24)),
        marker,
      );
      root.add(button);
      const horizontal = addAccent(new BoxGeometry(1.1, 0.06, 0.16), 0.48);
      horizontal.position.y = 0.14;
      const vertical = addAccent(new BoxGeometry(0.16, 0.06, 1.1), 0.48);
      vertical.position.y = 0.14;
    } else if (placement.kind === 'keycard') {
      const card = new Mesh(
        this.#ownLevelGeometry(new BoxGeometry(1.35, 0.12, 0.78)),
        marker,
      );
      card.position.y = 0.72;
      card.rotation.y = Math.PI / 8;
      root.add(card);
      const halo = addAccent(new TorusGeometry(1.12, 0.07, 8, 28), 0.35);
      halo.rotation.x = Math.PI / 2;
    } else {
      const disc = new Mesh(
        this.#ownLevelGeometry(new CylinderGeometry(1.35, 1.35, 0.1, 32)),
        marker,
      );
      root.add(disc);
      const ring = addAccent(new TorusGeometry(1.48, 0.08, 8, 32), 0.4);
      ring.rotation.x = Math.PI / 2;
    }

    return {
      placement,
      root,
      marker,
      accentMaterials: accents,
      baseColour: inactiveColour(colour),
      activeColour: new Color(colour),
      lightPriority,
      active: false,
    };
  }

  #buildCircuits(plan: LevelVisualPlan): void {
    const materials = new Map<string, MeshStandardMaterial>();
    for (const circuit of plan.circuits) {
      let material = materials.get(circuit.teleporterId);
      if (material === undefined) {
        const colour = teleporterColour(circuit.teleporterId);
        material = this.#ownLevelMaterial(new MeshStandardMaterial({
          color: inactiveColour(colour),
          emissive: colour,
          emissiveIntensity: 0.08,
          transparent: true,
          opacity: 0.24,
          roughness: 0.5,
        }));
        materials.set(circuit.teleporterId, material);
      }
      const [source, bend, target] = circuit.path;
      this.#addCircuitSegment(source, bend, material);
      this.#addCircuitSegment(bend, target, material);
    }
    for (const [teleporterId, material] of materials) {
      this.#circuits.push({ teleporterId, materials: [material] });
    }
  }

  #addCircuitSegment(
    start: { readonly x: number; readonly z: number },
    end: { readonly x: number; readonly z: number },
    material: MeshStandardMaterial,
  ): void {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return;
    const geometry = this.#ownLevelGeometry(new BoxGeometry(length, 0.06, 0.14));
    const segment = new Mesh(geometry, material);
    segment.position.set((start.x + end.x) / 2, 0.47, (start.z + end.z) / 2);
    segment.rotation.y = Math.atan2(-dz, dx);
    segment.receiveShadow = false;
    this.#levelRoot.add(segment);
  }

  #updateMechanisms(snapshot: CoopSnapshot, now: number): void {
    const pulse = (Math.sin(now / 220) + 1) / 2;
    const activeLights: SignalVisual[] = [];
    for (const visual of this.#signals.values()) {
      const placement = visual.placement;
      let active = false;
      let visible = true;
      switch (placement.kind) {
        case 'pressure-plate': {
          const remote = snapshot.pressurePlates.find(({ id }) => id === placement.id);
          active = remote?.occupied === true
            || (placement.id.endsWith('_a') ? snapshot.nearPlatePressed : snapshot.farPlatePressed);
          break;
        }
        case 'teleporter-power':
        case 'teleporter-pad':
          active = snapshot.teleporters.find(({ id }) => id === placement.teleporterId)?.powered === true;
          break;
        case 'keycard':
          active = !(
            snapshot.keycards.find(({ id }) => id === placement.id)?.collected === true
            || snapshot.collectedKeycardIds.includes(placement.id)
          );
          visible = active;
          break;
        case 'relay':
          active = snapshot.relayButtons.find(({ id }) => id === placement.id)?.occupiedBy !== null;
          break;
        case 'exit':
          active = true;
          break;
        case 'threshold':
          active = !snapshot.doorOpen;
          visible = active;
          break;
      }
      visual.root.visible = visible;
      setSignalMaterial(visual, active, pulse);
      if (active && visible && visual.lightPriority > 0) activeLights.push(visual);
    }

    for (const circuit of this.#circuits) {
      const powered = snapshot.teleporters.find(({ id }) => id === circuit.teleporterId)?.powered === true;
      for (const material of circuit.materials) {
        material.emissiveIntensity = powered ? 0.78 + pulse * 0.22 : 0.08;
        material.opacity = powered ? 0.78 : 0.24;
        material.color.set(powered
          ? teleporterColour(circuit.teleporterId)
          : inactiveColour(teleporterColour(circuit.teleporterId)));
      }
    }

    activeLights.sort((a, b) => b.lightPriority - a.lightPriority);
    this.#pointLights.forEach((light, index) => {
      const signal = activeLights[index];
      if (signal === undefined) {
        light.visible = false;
        light.intensity = 0;
        return;
      }
      light.visible = true;
      light.color.copy(signal.activeColour);
      light.intensity = 5.5;
      light.distance = signal.placement.kind === 'teleporter-pad' ? 9 : 6;
      light.position.copy(signal.root.position);
      light.position.y += 1.4;
    });
  }

  #updateGates(snapshot: CoopSnapshot, deltaSeconds: number, snap: boolean): void {
    const latched = this.#currentPlan !== null
      && snapshot.latchedGateIds.includes(
        this.#currentPlan.doors[0]?.id ?? '',
      );
    for (const gate of this.#gates) {
      const target = snapshot.doorOpen ? gate.duration : 0;
      gate.time = snap
        ? target
        : MathUtils.clamp(
          gate.time + Math.sign(target - gate.time) * Math.min(deltaSeconds, Math.abs(target - gate.time)),
          0,
          gate.duration,
        );
      sampleAnimationPose(gate.mixer, gate.action, gate.time);
      const statusColour = latched
        ? COLOURS.accepted
        : snapshot.doorOpen
          ? COLOURS.pending
          : 0x81465c;
      gate.statusMaterial.color.setHex(statusColour);
      gate.statusMaterial.emissive.setHex(statusColour);
      gate.statusMaterial.emissiveIntensity = latched ? 1.2 : 0.45;
    }
  }

  #ensurePlayer(player: RemotePlayer): PlayerVisual {
    const existing = this.#players.get(player.id);
    if (existing !== undefined) return existing;
    const assetId: AvatarAssetId = player.id === 'player-1' ? 'lion' : 'penguin';
    const clone = cloneAvatarAsset(assetId);
    normalizeAndGroundAvatar(clone.root, PLAYER_HEIGHT);
    setObjectShadows(clone.root, true, false);
    const materialStates = clonePlayerMaterials(clone.root);

    const wrapper = new Group();
    wrapper.add(clone.root);
    const localRing = new Mesh(
      new RingGeometry(1.08, 1.22, 32),
      new MeshBasicMaterial({
        color: COLOURS.partner,
        transparent: true,
        opacity: 0.76,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    localRing.rotation.x = -Math.PI / 2;
    localRing.position.y = 0.08;
    wrapper.add(localRing);
    const thresholdRing = new Mesh(
      new RingGeometry(1.34, 1.45, 32),
      new MeshBasicMaterial({
        color: COLOURS.threshold,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    thresholdRing.rotation.x = -Math.PI / 2;
    thresholdRing.position.y = 0.09;
    thresholdRing.visible = false;
    wrapper.add(thresholdRing);

    const label = createLabel(
      player.id === 'player-1' ? 'P1' : 'P2',
      'player-label',
    );
    label.position.set(0, PLAYER_HEIGHT + 2, 0);
    wrapper.add(label);

    const mixer = new AnimationMixer(clone.root);
    const idleClip = clone.animations.find(({ name }) => name === 'idle');
    const walkClip = clone.animations.find(({ name }) => name === 'walk');
    const idleAction = idleClip === undefined ? null : mixer.clipAction(idleClip);
    const walkAction = walkClip === undefined ? null : mixer.clipAction(walkClip);
    idleAction?.play();
    this.#playerRoot.add(wrapper);

    const visual: PlayerVisual = {
      id: player.id,
      root: wrapper,
      model: clone.root,
      mixer,
      idleAction,
      walkAction,
      localRing,
      thresholdRing,
      label,
      materialStates,
      drawX: player.worldX,
      drawY: player.worldY,
      initialized: false,
      activeClip: idleAction === null ? null : 'idle',
    };
    this.#players.set(player.id, visual);
    return visual;
  }

  #synchronizePlayers(
    remotePlayers: readonly RemotePlayer[],
    deltaSeconds: number,
    snap: boolean,
  ): void {
    const remoteIds = new Set(remotePlayers.map(({ id }) => id));
    for (const visual of this.#players.values()) {
      visual.root.visible = remoteIds.has(visual.id);
    }

    for (const remote of remotePlayers) {
      const visual = this.#ensurePlayer(remote);
      visual.root.visible = true;
      const distance = Math.hypot(remote.worldX - visual.drawX, remote.worldY - visual.drawY);
      const shouldSnap = snap || !visual.initialized || distance > TELEPORT_SNAP_DISTANCE;
      const previousX = visual.drawX;
      const previousY = visual.drawY;
      if (shouldSnap) {
        visual.drawX = remote.worldX;
        visual.drawY = remote.worldY;
      } else {
        const alpha = 1 - Math.exp(-12 * deltaSeconds);
        visual.drawX = MathUtils.lerp(visual.drawX, remote.worldX, alpha);
        visual.drawY = MathUtils.lerp(visual.drawY, remote.worldY, alpha);
      }
      visual.initialized = true;
      const movementX = visual.drawX - previousX;
      const movementY = visual.drawY - previousY;
      const moving = !shouldSnap && Math.hypot(movementX, movementY) > 0.01;
      if (moving) visual.root.rotation.y = Math.atan2(movementX, movementY);
      this.#setPlayerClip(visual, moving ? 'walk' : 'idle');
      visual.mixer.update(deltaSeconds);

      const scenePoint = worldToScene({ x: visual.drawX, y: visual.drawY });
      visual.root.position.set(scenePoint.x, 0.08, scenePoint.z);
      visual.thresholdRing.visible = remote.routeKind === 'threshold-stop';
      const local = remote.id === this.#bridge.getPlayerId();
      visual.localRing.material.color.setHex(local ? COLOURS.local : COLOURS.partner);
      visual.localRing.material.opacity = local ? 0.95 : 0.62;
      const labelElement = visual.label.element;
      labelElement.dataset.local = String(local);
      labelElement.dataset.connected = String(remote.connected);
      for (const state of visual.materialStates) {
        state.material.transparent = remote.connected ? state.originalTransparent : true;
        state.material.opacity = remote.connected ? state.originalOpacity : 0.36;
        state.material.needsUpdate = true;
      }
    }
  }

  #setPlayerClip(visual: PlayerVisual, clip: 'idle' | 'walk'): void {
    if (visual.activeClip === clip) return;
    const next = clip === 'walk' ? visual.walkAction : visual.idleAction;
    const previous = visual.activeClip === 'walk' ? visual.walkAction : visual.idleAction;
    if (next === null) return;
    previous?.fadeOut(0.12);
    next.reset().fadeIn(0.12).play();
    visual.activeClip = clip;
  }

  #updateReticle(now: number): void {
    const state = this.#reticleState;
    if (state === null || now >= state.expiresAt) {
      this.#reticleRoot.visible = false;
      this.#reticleState = null;
      return;
    }
    const remaining = (state.expiresAt - now) / state.duration;
    this.#reticleRoot.visible = true;
    this.#reticleRoot.position.set(state.point.x, 0.11, state.point.z);
    this.#reticleRoot.scale.setScalar(1 + (1 - remaining) * 0.72);
    this.#reticleMaterial.color.setHex(state.colour);
    this.#reticleMaterial.opacity = MathUtils.clamp(remaining, 0, 1);
  }

  #ownLevelGeometry<T extends BufferGeometry>(geometry: T): T {
    this.#levelResources.geometries.add(geometry);
    return geometry;
  }

  #ownLevelMaterial<T extends Material>(material: T): T {
    this.#levelResources.materials.add(material);
    return material;
  }

  #disposeLevel(): void {
    for (const gate of this.#gates) {
      gate.mixer.stopAllAction();
      gate.action.stop();
    }
    this.#gates.length = 0;
    this.#signals.clear();
    this.#circuits.length = 0;
    for (const label of this.#levelResources.labels) label.remove();
    for (const instance of this.#levelResources.instances) instance.dispose();
    for (const geometry of this.#levelResources.geometries) geometry.dispose();
    for (const material of this.#levelResources.materials) material.dispose();
    this.#levelResources.labels.clear();
    this.#levelResources.instances.clear();
    this.#levelResources.geometries.clear();
    this.#levelResources.materials.clear();
    this.#levelRoot.clear();
    this.#currentPlan = null;
  }
}
