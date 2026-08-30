import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_ASSET_IDS,
  AVATAR_CATALOG,
  avatarLabel,
  defaultAvatarAssetIdForPlayerId,
  isAvatarAssetId,
  normalizeAndGroundAvatar,
  resolveAvatarAssetId,
} from '../../../src/client/three/assets.ts';

interface GlbAccessor {
  readonly min?: number[];
  readonly max?: number[];
}

interface GlbAnimation {
  readonly name?: string;
}

interface GlbDocument {
  readonly asset?: {
    readonly version?: string;
  };
  readonly scene?: number;
  readonly scenes?: unknown[];
  readonly images?: Array<{
    readonly uri?: string;
  }>;
  readonly animations?: GlbAnimation[];
  readonly accessors?: GlbAccessor[];
}

interface ModelFixture {
  readonly id: string;
  readonly relativePath: string;
}

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const ENVIRONMENT_MODELS = Object.freeze([
  { id: 'floor', relativePath: 'assets/GLB format/template-floor.glb' },
  { id: 'floorDetail', relativePath: 'assets/GLB format/template-floor-detail-a.glb' },
  { id: 'floorLayer', relativePath: 'assets/GLB format/template-floor-layer.glb' },
  { id: 'wall', relativePath: 'assets/GLB format/template-wall.glb' },
  { id: 'halfWall', relativePath: 'assets/GLB format/template-wall-half.glb' },
  { id: 'wallCorner', relativePath: 'assets/GLB format/template-wall-corner.glb' },
  { id: 'wallDetail', relativePath: 'assets/GLB format/template-wall-detail-a.glb' },
  { id: 'wallTop', relativePath: 'assets/GLB format/template-wall-top.glb' },
  { id: 'gateDoor', relativePath: 'assets/GLB format/gate-door.glb' },
] as const satisfies readonly ModelFixture[]);

const CHARACTER_MODELS: readonly ModelFixture[] = Object.freeze(
  AVATAR_ASSET_IDS.map((id) => ({ id, relativePath: `assets/new_characters/${id}.glb` })),
);

const SELECTED_MODELS: readonly ModelFixture[] = Object.freeze([
  ...ENVIRONMENT_MODELS,
  ...CHARACTER_MODELS,
]);

const COLORMAPS = Object.freeze([
  'assets/GLB format/Textures/colormap.png',
  'assets/new_characters/Textures/colormap.png',
] as const);

const SELECTED_FILES: readonly string[] = Object.freeze([
  ...SELECTED_MODELS.map(({ relativePath }) => relativePath),
  ...COLORMAPS,
]);

const SELECTED_ASSET_BUDGET_BYTES = 3.5 * 1024 * 1024;

function repositoryPath(relativePath: string): string {
  return resolve(REPOSITORY_ROOT, relativePath);
}

function readGlb(relativePath: string): GlbDocument {
  const bytes = readFileSync(repositoryPath(relativePath));
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${relativePath} is not a GLB file`);
  }

  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  const jsonLength = bytes.readUInt32LE(12);
  const jsonChunkType = bytes.readUInt32LE(16);
  if (version !== 2 || declaredLength !== bytes.length) {
    throw new Error(`${relativePath} has an invalid GLB v2 header`);
  }
  if (jsonChunkType !== 0x4e4f534a || 20 + jsonLength > bytes.length) {
    throw new Error(`${relativePath} has an invalid JSON chunk`);
  }

  const json = bytes.toString('utf8', 20, 20 + jsonLength).trimEnd();
  return JSON.parse(json) as GlbDocument;
}

function animationNames(model: ModelFixture): readonly string[] {
  return readGlb(model.relativePath).animations?.map(({ name }) => name ?? '') ?? [];
}

describe('selected Three.js asset files', () => {
  it('stay inside the 3.5 MiB transfer budget', () => {
    const totalBytes = SELECTED_FILES.reduce(
      (total, relativePath) => total + statSync(repositoryPath(relativePath)).size,
      0,
    );

    expect(totalBytes).toBeLessThanOrEqual(SELECTED_ASSET_BUDGET_BYTES);
  });

  it('use valid PNG files for both pack-specific colormaps', () => {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const relativePath of COLORMAPS) {
      expect(readFileSync(repositoryPath(relativePath)).subarray(0, 8)).toEqual(pngSignature);
    }
  });
});

describe('avatar catalog helpers', () => {
  it('exposes the 12 selectable avatars with neutral explorer labels', () => {
    expect(Object.isFrozen(AVATAR_CATALOG)).toBe(true);
    expect(AVATAR_CATALOG).toHaveLength(12);
    expect(AVATAR_CATALOG.map(({ id }) => id)).toEqual(AVATAR_ASSET_IDS);
    expect(AVATAR_CATALOG.map(({ label }) => label)).toEqual([
      'Explorer A',
      'Explorer B',
      'Explorer C',
      'Explorer D',
      'Explorer E',
      'Explorer F',
      'Explorer G',
      'Explorer H',
      'Explorer I',
      'Explorer J',
      'Explorer K',
      'Explorer L',
    ]);
  });

  it('validates avatar ids, labels them, and falls back by seat', () => {
    expect(isAvatarAssetId('character-female-a')).toBe(true);
    expect(isAvatarAssetId('lion')).toBe(false);
    expect(avatarLabel('character-male-f')).toBe('Explorer L');
    expect(defaultAvatarAssetIdForPlayerId('player-1')).toBe('character-female-a');
    expect(defaultAvatarAssetIdForPlayerId('player-2')).toBe('character-male-a');
    expect(resolveAvatarAssetId('character-female-d', 'player-2')).toBe('character-female-d');
    expect(resolveAvatarAssetId('invalid-avatar', 'player-2')).toBe('character-male-a');
    expect(resolveAvatarAssetId(undefined, 'player-1')).toBe('character-female-a');
  });
});

describe('normalizeAndGroundAvatar', () => {
  it('uniformly scales a clone to its target height and grounds it at y=0', () => {
    const root = new Group();
    const geometry = new BoxGeometry(1, 4, 1);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.position.y = 1;
    root.add(mesh);

    const normalization = normalizeAndGroundAvatar(root, 2);

    expect(normalization.sourceHeight).toBeCloseTo(4);
    expect(normalization.appliedScale).toBeCloseTo(0.5);
    expect(normalization.bounds.min[1]).toBeCloseTo(0);
    expect(normalization.bounds.max[1]).toBeCloseTo(2);
    expect(root.scale.toArray()).toEqual([0.5, 0.5, 0.5]);

    geometry.dispose();
    material.dispose();
  });

  it('rejects non-positive and non-finite target heights', () => {
    const root = new Group();

    expect(() => normalizeAndGroundAvatar(root, 0)).toThrow(RangeError);
    expect(() => normalizeAndGroundAvatar(root, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('selected GLB contracts', () => {
  it.each(SELECTED_MODELS)('$id is GLB v2 with a default scene and external colormap', (model) => {
    const document = readGlb(model.relativePath);
    const sceneCount = document.scenes?.length ?? 0;

    expect(document.asset?.version).toBe('2.0');
    expect(Number.isInteger(document.scene)).toBe(true);
    expect(document.scene).toBeGreaterThanOrEqual(0);
    expect(document.scene).toBeLessThan(sceneCount);
    expect(sceneCount).toBeGreaterThan(0);
    expect(document.images?.map(({ uri }) => uri)).toEqual([
      'Textures/colormap.png',
    ]);
  });

  it.each(SELECTED_MODELS)('$id has ordered finite accessor bounds', (model) => {
    const boundedAccessors = (readGlb(model.relativePath).accessors ?? [])
      .filter(({ min, max }) => min !== undefined || max !== undefined);

    expect(boundedAccessors.length).toBeGreaterThan(0);
    for (const accessor of boundedAccessors) {
      expect(accessor.min).toBeDefined();
      expect(accessor.max).toBeDefined();
      expect(accessor.min?.length).toBe(accessor.max?.length);
      expect(accessor.min?.length ?? 0).toBeGreaterThan(0);

      const minimum = accessor.min ?? [];
      const maximum = accessor.max ?? [];
      for (const [index, lower] of minimum.entries()) {
        const upper = maximum[index];
        expect(Number.isFinite(lower)).toBe(true);
        expect(Number.isFinite(upper)).toBe(true);
        expect(upper).toBeGreaterThanOrEqual(lower);
      }
    }
  });

  it.each(CHARACTER_MODELS)('$id supplies idle and walk clips', (model) => {
    expect(animationNames(model)).toEqual(expect.arrayContaining(['idle', 'walk']));
  });

  it('gateDoor supplies open and close clips', () => {
    const gate = ENVIRONMENT_MODELS.find(({ id }) => id === 'gateDoor');
    if (gate === undefined) {
      throw new Error('Missing gateDoor fixture');
    }

    expect(animationNames(gate)).toEqual(expect.arrayContaining(['open', 'close']));
  });
});
