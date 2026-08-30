import {
  Box3,
  LoadingManager,
  type AnimationClip,
  type Group,
  type Object3D,
  type Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATAR_IDS, type AvatarId } from '../../game/index.ts';
import characterColormapUrl from '../../../assets/new_characters/Textures/colormap.png?url';
import characterFemaleAUrl from '../../../assets/new_characters/character-female-a.glb?url';
import characterFemaleBUrl from '../../../assets/new_characters/character-female-b.glb?url';
import characterFemaleCUrl from '../../../assets/new_characters/character-female-c.glb?url';
import characterFemaleDUrl from '../../../assets/new_characters/character-female-d.glb?url';
import characterFemaleEUrl from '../../../assets/new_characters/character-female-e.glb?url';
import characterFemaleFUrl from '../../../assets/new_characters/character-female-f.glb?url';
import characterMaleAUrl from '../../../assets/new_characters/character-male-a.glb?url';
import characterMaleBUrl from '../../../assets/new_characters/character-male-b.glb?url';
import characterMaleCUrl from '../../../assets/new_characters/character-male-c.glb?url';
import characterMaleDUrl from '../../../assets/new_characters/character-male-d.glb?url';
import characterMaleEUrl from '../../../assets/new_characters/character-male-e.glb?url';
import characterMaleFUrl from '../../../assets/new_characters/character-male-f.glb?url';
import environmentColormapUrl from '../../../assets/GLB format/Textures/colormap.png?url';
import gateDoorUrl from '../../../assets/GLB format/gate-door.glb?url';
import floorDetailUrl from '../../../assets/GLB format/template-floor-detail-a.glb?url';
import floorLayerUrl from '../../../assets/GLB format/template-floor-layer.glb?url';
import floorUrl from '../../../assets/GLB format/template-floor.glb?url';
import wallCornerUrl from '../../../assets/GLB format/template-wall-corner.glb?url';
import wallDetailUrl from '../../../assets/GLB format/template-wall-detail-a.glb?url';
import halfWallUrl from '../../../assets/GLB format/template-wall-half.glb?url';
import wallTopUrl from '../../../assets/GLB format/template-wall-top.glb?url';
import wallUrl from '../../../assets/GLB format/template-wall.glb?url';

export const ENVIRONMENT_ASSET_IDS = Object.freeze([
  'floor',
  'floorDetail',
  'floorLayer',
  'wall',
  'halfWall',
  'wallCorner',
  'wallDetail',
  'wallTop',
  'gateDoor',
] as const);

export const AVATAR_ASSET_IDS = AVATAR_IDS;

export type EnvironmentAssetId = (typeof ENVIRONMENT_ASSET_IDS)[number];
export type AvatarAssetId = AvatarId;
export type ThreeAssetId = EnvironmentAssetId | AvatarAssetId;
export type AssetPack = 'environment' | 'characters';

export interface AvatarCatalogEntry {
  readonly id: AvatarAssetId;
  readonly label: string;
}

export interface AssetDiagnostics {
  readonly id: ThreeAssetId;
  readonly pack: AssetPack;
  readonly sourceUrl: string;
  readonly colormapUrl: string;
  readonly animationNames: readonly string[];
}

export interface LoadedAssetClone {
  readonly root: Group;
  readonly animations: readonly AnimationClip[];
  readonly diagnostics: AssetDiagnostics;
}

export interface AvatarBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface AvatarNormalization {
  readonly sourceHeight: number;
  readonly appliedScale: number;
  readonly groundOffsetY: number;
  readonly bounds: AvatarBounds;
}

interface AssetDefinition {
  readonly pack: AssetPack;
  readonly sourceUrl: string;
}

interface LoadedTemplate {
  readonly root: Group;
  readonly animations: readonly AnimationClip[];
  readonly diagnostics: AssetDiagnostics;
}

const THREE_ASSET_IDS: readonly ThreeAssetId[] = Object.freeze([
  ...ENVIRONMENT_ASSET_IDS,
  ...AVATAR_ASSET_IDS,
]);

const AVATAR_DETAILS = Object.freeze({
  'character-female-a': Object.freeze({ label: 'Explorer A', sourceUrl: characterFemaleAUrl }),
  'character-female-b': Object.freeze({ label: 'Explorer B', sourceUrl: characterFemaleBUrl }),
  'character-female-c': Object.freeze({ label: 'Explorer C', sourceUrl: characterFemaleCUrl }),
  'character-female-d': Object.freeze({ label: 'Explorer D', sourceUrl: characterFemaleDUrl }),
  'character-female-e': Object.freeze({ label: 'Explorer E', sourceUrl: characterFemaleEUrl }),
  'character-female-f': Object.freeze({ label: 'Explorer F', sourceUrl: characterFemaleFUrl }),
  'character-male-a': Object.freeze({ label: 'Explorer G', sourceUrl: characterMaleAUrl }),
  'character-male-b': Object.freeze({ label: 'Explorer H', sourceUrl: characterMaleBUrl }),
  'character-male-c': Object.freeze({ label: 'Explorer I', sourceUrl: characterMaleCUrl }),
  'character-male-d': Object.freeze({ label: 'Explorer J', sourceUrl: characterMaleDUrl }),
  'character-male-e': Object.freeze({ label: 'Explorer K', sourceUrl: characterMaleEUrl }),
  'character-male-f': Object.freeze({ label: 'Explorer L', sourceUrl: characterMaleFUrl }),
} satisfies Readonly<Record<AvatarAssetId, { readonly label: string; readonly sourceUrl: string }>>);

const AVATAR_ID_SET = new Set<string>(AVATAR_ASSET_IDS);

export const AVATAR_CATALOG: readonly AvatarCatalogEntry[] = Object.freeze(
  AVATAR_ASSET_IDS.map((id) => Object.freeze({
    id,
    label: AVATAR_DETAILS[id].label,
  })),
);

const ASSET_DEFINITIONS = Object.freeze({
  floor: Object.freeze({ pack: 'environment', sourceUrl: floorUrl }),
  floorDetail: Object.freeze({ pack: 'environment', sourceUrl: floorDetailUrl }),
  floorLayer: Object.freeze({ pack: 'environment', sourceUrl: floorLayerUrl }),
  wall: Object.freeze({ pack: 'environment', sourceUrl: wallUrl }),
  halfWall: Object.freeze({ pack: 'environment', sourceUrl: halfWallUrl }),
  wallCorner: Object.freeze({ pack: 'environment', sourceUrl: wallCornerUrl }),
  wallDetail: Object.freeze({ pack: 'environment', sourceUrl: wallDetailUrl }),
  wallTop: Object.freeze({ pack: 'environment', sourceUrl: wallTopUrl }),
  gateDoor: Object.freeze({ pack: 'environment', sourceUrl: gateDoorUrl }),
  'character-female-a': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleAUrl }),
  'character-female-b': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleBUrl }),
  'character-female-c': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleCUrl }),
  'character-female-d': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleDUrl }),
  'character-female-e': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleEUrl }),
  'character-female-f': Object.freeze({ pack: 'characters', sourceUrl: characterFemaleFUrl }),
  'character-male-a': Object.freeze({ pack: 'characters', sourceUrl: characterMaleAUrl }),
  'character-male-b': Object.freeze({ pack: 'characters', sourceUrl: characterMaleBUrl }),
  'character-male-c': Object.freeze({ pack: 'characters', sourceUrl: characterMaleCUrl }),
  'character-male-d': Object.freeze({ pack: 'characters', sourceUrl: characterMaleDUrl }),
  'character-male-e': Object.freeze({ pack: 'characters', sourceUrl: characterMaleEUrl }),
  'character-male-f': Object.freeze({ pack: 'characters', sourceUrl: characterMaleFUrl }),
} satisfies Readonly<Record<ThreeAssetId, AssetDefinition>>);

const COLORMAP_URLS: Readonly<Record<AssetPack, string>> = Object.freeze({
  environment: environmentColormapUrl,
  characters: characterColormapUrl,
});

const PACK_COLORMAP_PATH = /(?:^|\/)Textures\/colormap\.png(?:[?#].*)?$/;

function createPackLoader(colormapUrl: string): GLTFLoader {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (
    PACK_COLORMAP_PATH.test(url.replaceAll('\\', '/')) ? colormapUrl : url
  ));
  return new GLTFLoader(manager);
}

const LOADERS: Readonly<Record<AssetPack, GLTFLoader>> = Object.freeze({
  environment: createPackLoader(environmentColormapUrl),
  characters: createPackLoader(characterColormapUrl),
});

const templates = new Map<ThreeAssetId, LoadedTemplate>();
const templateLoads = new Map<ThreeAssetId, Promise<LoadedTemplate>>();
let preloadPromise: Promise<void> | undefined;

function freezeDiagnostics(
  id: ThreeAssetId,
  definition: AssetDefinition,
  animations: readonly AnimationClip[],
): AssetDiagnostics {
  return Object.freeze({
    id,
    pack: definition.pack,
    sourceUrl: definition.sourceUrl,
    colormapUrl: COLORMAP_URLS[definition.pack],
    animationNames: Object.freeze(animations.map(({ name }) => name)),
  });
}

async function loadTemplate(id: ThreeAssetId): Promise<LoadedTemplate> {
  const definition = ASSET_DEFINITIONS[id];
  const gltf = await LOADERS[definition.pack].loadAsync(definition.sourceUrl);
  const animations: readonly AnimationClip[] = Object.freeze([...gltf.animations]);

  return Object.freeze({
    root: gltf.scene,
    animations,
    diagnostics: freezeDiagnostics(id, definition, animations),
  });
}

async function ensureTemplate(id: ThreeAssetId): Promise<void> {
  if (templates.has(id)) {
    return;
  }

  let templateLoad = templateLoads.get(id);
  if (templateLoad === undefined) {
    templateLoad = loadTemplate(id);
    templateLoads.set(id, templateLoad);
  }

  try {
    templates.set(id, await templateLoad);
  } finally {
    if (templateLoads.get(id) === templateLoad) {
      templateLoads.delete(id);
    }
  }
}

async function loadAllTemplates(): Promise<void> {
  await Promise.all(THREE_ASSET_IDS.map(ensureTemplate));
}

/**
 * Loads the selected environment and character assets exactly once after a
 * successful preload. A failed batch is cleared so the lobby can retry.
 */
export function preloadThreeAssets(): Promise<void> {
  if (preloadPromise === undefined) {
    preloadPromise = loadAllTemplates().catch((error: unknown) => {
      preloadPromise = undefined;
      throw error;
    });
  }

  return preloadPromise;
}

export function isThreeAssetLibraryReady(): boolean {
  return templates.size === THREE_ASSET_IDS.length;
}

function getTemplate(id: ThreeAssetId): LoadedTemplate {
  const template = templates.get(id);
  if (template === undefined) {
    throw new Error(
      `Three.js asset "${id}" is not loaded. Call preloadThreeAssets() first.`,
    );
  }
  return template;
}

function cloneTemplate(id: ThreeAssetId): LoadedAssetClone {
  const template = getTemplate(id);
  return Object.freeze({
    root: cloneSkeleton(template.root) as Group,
    animations: template.animations,
    diagnostics: template.diagnostics,
  });
}

export function cloneEnvironmentAsset(id: EnvironmentAssetId): LoadedAssetClone {
  return cloneTemplate(id);
}

export function cloneAvatarAsset(id: AvatarAssetId): LoadedAssetClone {
  return cloneTemplate(id);
}

export function isAvatarAssetId(value: unknown): value is AvatarAssetId {
  return typeof value === 'string' && AVATAR_ID_SET.has(value);
}

export function avatarLabel(id: AvatarAssetId): string {
  return AVATAR_DETAILS[id].label;
}

export function defaultAvatarAssetIdForPlayerId(playerId: string | null | undefined): AvatarAssetId {
  return playerId === 'player-2' ? 'character-male-a' : 'character-female-a';
}

export function resolveAvatarAssetId(
  value: unknown,
  playerId?: string | null,
): AvatarAssetId {
  return isAvatarAssetId(value) ? value : defaultAvatarAssetIdForPlayerId(playerId);
}

export function getThreeAssetDiagnostics(): readonly AssetDiagnostics[] {
  return Object.freeze(
    THREE_ASSET_IDS.map((id) => getTemplate(id).diagnostics),
  );
}

export function findAssetClip(
  id: ThreeAssetId,
  clipName: string,
): AnimationClip | undefined {
  return getTemplate(id).animations.find(({ name }) => name === clipName);
}

function isFiniteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z);
}

function pointTuple(vector: Vector3): readonly [number, number, number] {
  return Object.freeze([vector.x, vector.y, vector.z] as const);
}

/**
 * Uniformly scales an avatar to the requested height and moves its lowest
 * rendered point onto y=0. Call this on a detached clone before positioning it.
 */
export function normalizeAndGroundAvatar(
  root: Object3D,
  targetHeight = 1,
): AvatarNormalization {
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
    throw new RangeError('Avatar target height must be a finite positive number.');
  }

  root.updateMatrixWorld(true);
  const sourceBounds = new Box3().setFromObject(root, true);
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (
    sourceBounds.isEmpty()
    || !isFiniteVector(sourceBounds.min)
    || !isFiniteVector(sourceBounds.max)
    || !Number.isFinite(sourceHeight)
    || sourceHeight <= 0
  ) {
    throw new Error('Avatar bounds must be finite and have a positive height.');
  }

  const appliedScale = targetHeight / sourceHeight;
  root.scale.multiplyScalar(appliedScale);
  root.updateMatrixWorld(true);

  const scaledBounds = new Box3().setFromObject(root, true);
  const groundOffsetY = -scaledBounds.min.y;
  root.position.y += groundOffsetY;
  root.updateMatrixWorld(true);

  const groundedBounds = new Box3().setFromObject(root, true);
  if (
    groundedBounds.isEmpty()
    || !isFiniteVector(groundedBounds.min)
    || !isFiniteVector(groundedBounds.max)
  ) {
    throw new Error('Normalized avatar bounds must remain finite.');
  }

  return Object.freeze({
    sourceHeight,
    appliedScale,
    groundOffsetY,
    bounds: Object.freeze({
      min: pointTuple(groundedBounds.min),
      max: pointTuple(groundedBounds.max),
    }),
  });
}
