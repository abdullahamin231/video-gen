// Loaded by Pi with `-e`. Pi takes MCP servers only from mcp.json files or an extension, so the runner
// registers its bridge here for this one session instead of editing the user's ~/.pi config.
const forwarded = ['VIDEO_RUNNER_URL', 'VIDEO_RUNNER_TOKEN', 'VIDEO_THREAD_ID', 'VIDEO_AGENT_ID', 'VIDEO_AGENT_ROLE'];

export default function videoRunner(pi) {
  const { VIDEO_RUNNER_NODE: command, VIDEO_RUNNER_BRIDGE: bridge } = process.env;
  if (!command || !bridge) return;
  pi.registerMcpServer('video_runner', {
    command,
    args: [bridge],
    env: Object.fromEntries(forwarded.map(name => [name, process.env[name] || ''])),
    exposure: 'direct',
    timeout: 86400,
    description: 'The local video runner: delegate sub-agents, read user feedback, checkpoints and delivery.',
  });
}
