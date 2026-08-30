import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import {
  cloneAvatarAsset,
  normalizeAndGroundAvatar,
  type AvatarAssetId,
} from './assets.ts';

const PREVIEW_TARGET_HEIGHT = 3.2;
const PREVIEW_CAMERA_FOV = 34;
const PREVIEW_MIN_DISTANCE = 4.4;
const PREVIEW_PADDING = 0.92;
const PREVIEW_MAX_DPR = 1.5;

interface PreviewMaterialState {
  readonly material: Material;
}

function setObjectShadows(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = false;
  });
}

function clonePreviewMaterials(root: Object3D): PreviewMaterialState[] {
  const states: PreviewMaterialState[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) {
      const cloned = object.material.map((material) => material.clone());
      object.material = cloned;
      for (const material of cloned) states.push({ material });
      return;
    }
    const material = object.material.clone();
    object.material = material;
    states.push({ material });
  });
  return states;
}

function disposePreviewMaterials(states: readonly PreviewMaterialState[]): void {
  for (const state of states) state.material.dispose();
}

export class AvatarPreview {
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(PREVIEW_CAMERA_FOV, 1, 0.1, 100);
  readonly #avatarRoot = new Group();
  readonly #timer = new Timer();

  #renderer: WebGLRenderer | null = null;
  #container: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #rafId: number | null = null;
  #avatarId: AvatarAssetId | null = null;
  #model: Group | null = null;
  #mixer: AnimationMixer | null = null;
  #materialStates: readonly PreviewMaterialState[] = [];
  #bounds: Box3 | null = null;

  constructor() {
    this.#scene.add(this.#avatarRoot);

    const ambient = new AmbientLight(0xffffff, 2.6);
    const key = new DirectionalLight(0xfff5df, 2.8);
    key.position.set(4.5, 8, 6);
    key.castShadow = true;
    this.#scene.add(ambient, key);
  }

  start(container: HTMLElement, avatarId: AvatarAssetId): void {
    if (this.#renderer !== null && this.#container === container) {
      this.select(avatarId);
      return;
    }

    this.destroy();
    this.#container = container;

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    this.#renderer = renderer;

    container.append(renderer.domElement);
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);

    this.#timer.connect(document);
    this.#timer.reset();
    this.select(avatarId);
    this.#resize();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  select(avatarId: AvatarAssetId): void {
    if (this.#renderer === null) {
      throw new Error('AvatarPreview.start() must be called before select().');
    }
    if (this.#avatarId === avatarId) return;

    this.#clearModel();
    const clone = cloneAvatarAsset(avatarId);
    normalizeAndGroundAvatar(clone.root, PREVIEW_TARGET_HEIGHT);
    setObjectShadows(clone.root);
    const materialStates = clonePreviewMaterials(clone.root);

    const bounds = new Box3().setFromObject(clone.root, true);
    const center = bounds.getCenter(new Vector3());
    clone.root.position.x -= center.x;
    clone.root.position.z -= center.z;
    clone.root.updateMatrixWorld(true);

    const groundedBounds = new Box3().setFromObject(clone.root, true);
    const mixer = new AnimationMixer(clone.root);
    const idleClip = clone.animations.find(({ name }) => name === 'idle');
    mixer.stopAllAction();
    if (idleClip !== undefined) mixer.clipAction(idleClip).play();

    this.#avatarRoot.add(clone.root);
    this.#avatarId = avatarId;
    this.#model = clone.root;
    this.#mixer = mixer;
    this.#materialStates = materialStates;
    this.#bounds = groundedBounds;
    this.#timer.reset();
    this.#applyCameraFit();
  }

  destroy(): void {
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#clearModel();
    this.#renderer?.domElement.remove();
    this.#renderer?.dispose();
    this.#renderer?.forceContextLoss();
    this.#renderer = null;
    this.#container = null;
    this.#timer.disconnect();
  }

  readonly #tick = (timestamp: number): void => {
    const renderer = this.#renderer;
    if (renderer === null) return;
    const deltaSeconds = Math.min(this.#timer.update(timestamp).getDelta(), 0.1);
    this.#mixer?.update(deltaSeconds);
    renderer.render(this.#scene, this.#camera);
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #clearModel(): void {
    if (this.#model !== null) this.#avatarRoot.remove(this.#model);
    this.#mixer?.stopAllAction();
    disposePreviewMaterials(this.#materialStates);
    this.#avatarId = null;
    this.#model = null;
    this.#mixer = null;
    this.#materialStates = [];
    this.#bounds = null;
  }

  #resize(): void {
    const renderer = this.#renderer;
    const container = this.#container;
    if (renderer === null || container === null) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PREVIEW_MAX_DPR));
    renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#applyCameraFit();
  }

  #applyCameraFit(): void {
    const bounds = this.#bounds;
    if (bounds === null) return;

    const size = bounds.getSize(new Vector3());
    const aspect = this.#camera.aspect || 1;
    const verticalFov = MathUtils.degToRad(this.#camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distanceForHeight = (size.y * PREVIEW_PADDING * 0.5) / Math.tan(verticalFov / 2);
    const distanceForWidth = (Math.max(size.x, size.z) * PREVIEW_PADDING * 0.5) / Math.tan(horizontalFov / 2);
    const distance = Math.max(PREVIEW_MIN_DISTANCE, distanceForHeight, distanceForWidth);

    this.#camera.position.set(distance * 0.55, size.y * 0.52, distance);
    this.#camera.lookAt(0, size.y * 0.45, 0);
    this.#camera.near = 0.1;
    this.#camera.far = Math.max(60, distance * 6);
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld(true);
  }
}
