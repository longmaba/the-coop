import { describe, expect, it } from 'vitest';
import {
  createAgentInvitePrompt,
  gameUrlForAgent,
} from '../../../src/client/agent-invite.ts';

describe('WebMCP agent invitation prompt', () => {
  it('keeps the current game path while removing room and pairing details', () => {
    expect(gameUrlForAgent('https://coop.example/games/the-coop/?room=secret#pair=token')).toBe(
      'https://coop.example/games/the-coop/',
    );
  });

  it('gives the agent the join details and human-led co-player boundaries', () => {
    expect(createAgentInvitePrompt('https://coop.example/play?room=old', 'ROOM_7')).toBe([
      'Open https://coop.example/play in a WebMCP-capable browser and connect to the page with WebMCP. Use the `join_game` tool to join room code ROOM_7, then play as Explorer 2 like a normal cooperative player.',
      'Play your own explorer and let the human lead the session and control Explorer 1. Do not give unsolicited directions or solve the puzzle for them; only offer suggestions when the human asks for help. Use the game\'s WebMCP observations and movement tools instead of source code, tests, or walkthroughs. Speak in a warm, casual tone like a friend playing alongside them.',
    ].join('\n\n'));
  });
});
