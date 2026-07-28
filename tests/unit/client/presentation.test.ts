import { describe, expect, it } from 'vitest';
import { campaignPresentation } from '../../../src/client/presentation.ts';
import { EMPTY_SNAPSHOT } from '../../../src/client/state.ts';

describe('campaignPresentation', () => {
  it('offers advancement and replay before the final level', () => {
    expect(campaignPresentation({
      ...EMPTY_SNAPSHOT,
      levelNumber: 2,
      levelName: 'Powered Transit',
    })).toMatchObject({
      levelIndicator: 'LEVEL 2 OF 4',
      finalLevel: false,
      completionTitle: 'Powered Transit cleared.',
      advanceLabel: 'Next Level',
    });
  });

  it('offers Play Again and replay after the final level', () => {
    expect(campaignPresentation({
      ...EMPTY_SNAPSHOT,
      levelNumber: 4,
      levelName: 'Crossed Circuits',
    })).toEqual({
      levelIndicator: 'LEVEL 4 OF 4',
      finalLevel: true,
      completionTitle: 'Campaign complete.',
      completionObjective: 'Campaign complete. Play again from Level 1 or replay this level.',
      advanceLabel: 'Play Again',
    });
  });
});
