export function gameUrlForAgent(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function createAgentInvitePrompt(currentUrl: string, roomCode: string): string {
  const gameUrl = gameUrlForAgent(currentUrl);
  return [
    `Open ${gameUrl} in a WebMCP-capable browser and connect to the page with WebMCP. Use the \`join_game\` tool to join room code ${roomCode}, then play as Explorer 2 like a normal cooperative player.`,
    'Play your own explorer and let the human lead the session and control Explorer 1. Do not give unsolicited directions or solve the puzzle for them; only offer suggestions when the human asks for help. Use the game\'s WebMCP observations and movement tools instead of source code, tests, or walkthroughs. Speak in a warm, casual tone like a friend playing alongside them.',
  ].join('\n\n');
}
