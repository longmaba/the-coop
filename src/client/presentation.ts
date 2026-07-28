import type { CoopSnapshot } from './state.ts';

export interface CampaignPresentation {
  levelIndicator: string;
  finalLevel: boolean;
  completionTitle: string;
  completionObjective: string;
  advanceLabel: 'Next Level' | 'Play Again';
}

export function campaignPresentation(snapshot: CoopSnapshot): CampaignPresentation {
  const finalLevel = snapshot.levelNumber >= snapshot.levelCount;
  return {
    levelIndicator: `LEVEL ${snapshot.levelNumber} OF ${snapshot.levelCount}`,
    finalLevel,
    completionTitle: finalLevel ? 'Campaign complete.' : `${snapshot.levelName} cleared.`,
    completionObjective: finalLevel
      ? 'Campaign complete. Play again from Level 1 or replay this level.'
      : `${snapshot.levelName} cleared. Advance together or replay this level.`,
    advanceLabel: finalLevel ? 'Play Again' : 'Next Level',
  };
}
