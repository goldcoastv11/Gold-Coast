import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OUTFITS, outfitFor } from './outfits';
import { OUTFIT_IDS } from '../../server/src/multiplayer/room';

describe('downloaded lounge outfits', () => {
  it('keeps multiplayer choices aligned and defaults old or invalid saved looks', () => {
    expect(OUTFITS.map(o => o.id)).toEqual([...OUTFIT_IDS]);
    expect(outfitFor().id).toBe('Casual_2');
    expect(outfitFor('../../missing').id).toBe('Casual_2');
  });
  it.each(OUTFITS)('$name includes its rig, motion clips and recolorable materials', outfit => {
    const model = JSON.parse(readFileSync(new URL(`../../public/models/quaternius/${outfit.id}.gltf`, import.meta.url), 'utf8'));
    expect(model.skins.length).toBeGreaterThan(0);
    expect(model.animations.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['Idle', 'Walk']));
    expect(model.materials.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining([...outfit.shirt, ...outfit.hair]));
    for (const buffer of model.buffers) expect(buffer.uri).toMatch(/^data:/);
  });
});
