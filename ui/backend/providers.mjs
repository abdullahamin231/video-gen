import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const providerNames = ['Codex', 'Claude', 'OpenCode'];
const executables = { Codex: 'codex', Claude: 'claude', OpenCode: 'opencode' };
export async function executable(name) {
  if (!providerNames.includes(name)) throw new Error('Unsupported CLI provider');
  for (const folder of (process.env.PATH || '').split(path.delimiter)) {
    const filename = path.join(folder, executables[name]);
    try { await access(filename, constants.X_OK); return filename; } catch { /* Next PATH entry. */ }
  }
  throw new Error(`${executables[name]} is not installed or is not on the server’s PATH.`);
}

export function invocation(provider, { model = '', session = '', bridge, env = {}, node = process.execPath, root }) {
  const childEnv = { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0', MCP_TIMEOUT: '30000', MCP_TOOL_TIMEOUT: '86400000' };
  // A CLI launched from an existing Claude session is still a separate runner session.
  delete childEnv.CLAUDECODE;
  delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  let args;
  if (provider === 'Codex') {
    args = ['exec', '--json', '--color', 'never', '-C', root, '-s', 'workspace-write', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=true'];
    if (bridge) args.push('-c', `mcp_servers.video_runner.command=${JSON.stringify(node)}`, '-c', `mcp_servers.video_runner.args=${JSON.stringify([bridge])}`, '-c', 'mcp_servers.video_runner.env_vars=["VIDEO_RUNNER_URL","VIDEO_RUNNER_TOKEN","VIDEO_THREAD_ID","VIDEO_AGENT_ID"]', '-c', 'mcp_servers.video_runner.tool_timeout_sec=86400', '-c', 'mcp_servers.video_runner.required=true', '-c', 'mcp_servers.video_runner.default_tools_approval_mode="approve"');
    if (model) args.push('-m', model);
    if (session) args.push('resume', session);
    args.push('-');
  } else if (provider === 'Claude') {
    args = ['--print', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,mcp__video_runner__*'];
    if (bridge) args.push('--mcp-config', JSON.stringify({ mcpServers: { video_runner: { command: node, args: [bridge] } } }));
    if (model) args.push('--model', model);
    if (session) args.push('--resume', session);
  } else if (provider === 'OpenCode') {
    args = ['run', '--standalone', '--format', 'json', '--auto'];
    if (model) args.push('--model', model);
    if (session) args.push('--session', session);
    const config = { permission: { external_directory: 'deny' } };
    if (bridge) config.mcp = { video_runner: { type: 'local', command: [node, bridge], enabled: true, timeout: 86400000 } };
    childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  } else throw new Error('Unsupported CLI provider');
  return { args, env: childEnv };
}

export async function capture(command, args, { cwd, timeout = 15000, maxBytes = 1000000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', stopped = false;
    const kill = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* Already exited. */ } };
    const timer = setTimeout(() => { stopped = true; kill(); }, timeout);
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > maxBytes) { stopped = true; kill(); } });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-32000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code: stopped ? -1 : code, stdout: stdout.slice(0, maxBytes), stderr, timedOut: stopped }); });
  });
}

export async function discoverProviders(root) {
  return Promise.all(providerNames.map(async name => {
    try {
      const command = await executable(name);
      const version = await capture(command, ['--version'], { cwd: root, timeout: 10000 });
      let models = [];
      if (name === 'Codex') {
        try {
          const cache = JSON.parse(await readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json'), 'utf8'));
          models = (cache.models || []).map(model => model.slug).filter(Boolean);
        } catch { /* Custom model IDs remain available. */ }
      } else if (name === 'Claude') models = ['opus', 'sonnet', 'haiku'];
      return { name, installed: version.code === 0, version: version.stdout.trim().slice(0, 200), models: [...new Set(models)], error: version.code === 0 ? '' : version.stderr.slice(-1000), auth: 'Uses existing CLI login; verified when a run starts' };
    } catch (error) { return { name, installed: false, models: [], error: error.message }; }
  }));
}
