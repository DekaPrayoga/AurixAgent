import chalk from 'chalk';
import { drawBox } from './SetupUI.js';
import {
  loadMcpConfig,
  addMcpServer,
  removeMcpServer,
  toggleMcpServer,
  mcpManager,
  PRESET_SERVERS,
  type McpServerConfig,
} from '../mcp/McpRegistry.js';
import { fetchCatalog, searchCatalog, type CatalogEntry } from '../mcp/McpCatalog.js';

const teal = chalk.hex('#fab283');
const dim = chalk.hex('#808080');
const green = chalk.hex('#7fd88f');
const red = chalk.hex('#f87171');
const bright = chalk.hex('#eeeeee');
const cyan = chalk.hex('#5c9cf5');
const yellow = chalk.hex('#fbbf24');

type MenuItem = {
  label: string;
  sublabel?: string;
  action: string;
  data?: any;
};

export async function openMcpManager(): Promise<void> {
  while (true) {
    const action = await showMainMenu();
    if (action === 'exit') return;
    if (action === 'list') await showServerList();
    if (action === 'add_preset') await showAddPreset();
    if (action === 'add_custom') await showAddCustom();
    if (action === 'catalog') await showCatalog();
    if (action === 'manage') await showManageServers();
    if (action === 'status') showStatus();
  }
}

async function showMainMenu(): Promise<string> {
  const items: MenuItem[] = [
    { label: 'Server List', sublabel: 'View configured MCP servers', action: 'list' },
    { label: 'Add Preset', sublabel: 'Add from built-in presets', action: 'add_preset' },
    { label: 'Add Custom', sublabel: 'Add custom MCP server', action: 'add_custom' },
    { label: 'Browse Catalog', sublabel: 'Search online MCP servers', action: 'catalog' },
    { label: 'Manage Servers', sublabel: 'Toggle, remove, or restart', action: 'manage' },
    { label: 'Status', sublabel: 'Show running server stats', action: 'status' },
  ];

  const idx = await showSelector('MCP Server Manager', items);
  return idx >= 0 ? items[idx].action : 'exit';
}

async function showServerList(): Promise<void> {
  const config = loadMcpConfig();
  if (config.servers.length === 0) {
    console.log('\n' + dim('  No MCP servers configured.') + '\n');
    console.log('  ' + cyan('Use "Add Preset" or "Browse Catalog" to add one.') + '\n');
    await waitKey();
    return;
  }

  const items: MenuItem[] = config.servers.map(s => ({
    label: `${s.enabled ? green('[ON]') : red('[OFF]')} ${s.name}`,
    sublabel: s.description || `${s.command} ${(s.args || []).join(' ')}`.slice(0, 50),
    action: 'back',
    data: s,
  }));
  items.push({ label: '← Back', action: 'back' });

  await showSelector('Configured Servers', items);
}

async function showAddPreset(): Promise<void> {
  const config = loadMcpConfig();
  const existing = new Set(config.servers.map(s => s.name));

  const items: MenuItem[] = Object.entries(PRESET_SERVERS)
    .filter(([name]) => !existing.has(name))
    .map(([name, preset]) => ({
      label: name,
      sublabel: preset.description || '',
      action: 'add',
      data: { name, ...preset },
    }));

  if (items.length === 0) {
    console.log('\n' + dim('  All presets already added.') + '\n');
    await waitKey();
    return;
  }

  items.push({ label: '← Back', action: 'back' });

  const idx = await showSelector('Add Preset Server', items);
  if (idx < 0 || idx >= items.length - 1) return;

  const selected = items[idx].data;
  if (selected) {
    addMcpServer({ ...selected, enabled: true });
    console.log('\n' + green(`  Added: ${selected.name}`) + '\n');

    if (selected.env && Object.keys(selected.env).length > 0) {
      console.log('  ' + yellow('Set required environment variables:'));
      for (const [k, v] of Object.entries(selected.env)) {
        if ((v as string).startsWith('<')) {
          console.log('  ' + cyan(`  export ${k}="${v}"`));
        }
      }
      console.log();
    }

    await waitKey();
  }
}

async function showAddCustom(): Promise<void> {
  const name = await readInput('Server name', 'e.g. my_server');
  if (!name || name === '__back__') return;

  const command = await readInput('Command', 'e.g. npx, node, python');
  if (!command || command === '__back__') return;

  const argsStr = await readInput('Arguments (space-separated)', 'e.g. -y @some/mcp-server');
  if (argsStr === '__back__') return;

  const desc = await readInput('Description (optional)', '');
  if (desc === '__back__') return;

  addMcpServer({
    name: name.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
    command,
    args: argsStr ? argsStr.split(/\s+/) : [],
    description: desc || undefined,
    enabled: true,
  });

  console.log('\n' + green(`  Added custom server: ${name}`) + '\n');
  await waitKey();
}

async function showCatalog(): Promise<void> {
  console.log('\n' + dim('  Fetching MCP server catalog...') + '\n');
  const catalog = await fetchCatalog();

  if (catalog.length === 0) {
    console.log('  ' + dim('Could not fetch catalog. Using built-in list.') + '\n');
    await waitKey();
    return;
  }

  const query = await readInput('Search catalog (empty for all)', '');
  if (query === '__back__') return;

  const results = query ? searchCatalog(catalog, query) : catalog;
  if (results.length === 0) {
    console.log('  ' + dim('No matching servers found.') + '\n');
    await waitKey();
    return;
  }

  const items: MenuItem[] = results.slice(0, 20).map(e => ({
    label: e.name,
    sublabel: `[${e.category}] ${e.description}`.slice(0, 60),
    action: 'install',
    data: e,
  }));
  items.push({ label: '← Back', action: 'back' });

  const idx = await showSelector('MCP Catalog', items);
  if (idx < 0 || idx >= items.length - 1) return;

  const entry: CatalogEntry = items[idx].data;
  if (entry) {
    addMcpServer({
      name: entry.name,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      description: entry.description,
      enabled: true,
    });
    console.log('\n' + green(`  Installed: ${entry.name}`) + '\n');
    await waitKey();
  }
}

async function showManageServers(): Promise<void> {
  const config = loadMcpConfig();
  if (config.servers.length === 0) {
    console.log('\n' + dim('  No servers to manage.') + '\n');
    await waitKey();
    return;
  }

  const items: MenuItem[] = config.servers.map(s => {
    const client = mcpManager.getClient(s.name);
    const status = client?.running ? green('running') : dim('stopped');
    const tools = client?.tools.length ? ` (${client.tools.length} tools)` : '';
    return {
      label: `${s.name} [${status}${tools}]`,
      sublabel: s.enabled ? 'enabled' : 'disabled',
      action: 'manage',
      data: s,
    };
  });
  items.push({ label: '← Back', action: 'back' });

  const idx = await showSelector('Manage Servers', items);
  if (idx < 0 || idx >= items.length - 1) return;

  const server = items[idx].data as McpServerConfig;
  if (!server) return;

  const actions: MenuItem[] = [
    { label: server.enabled ? 'Disable' : 'Enable', action: 'toggle' },
    { label: 'Restart', action: 'restart' },
    { label: 'Remove', action: 'remove' },
    { label: '← Back', action: 'back' },
  ];

  const aidx = await showSelector(`Manage: ${server.name}`, actions);
  if (aidx < 0 || aidx >= actions.length - 1) return;

  const act = actions[aidx].action;
  if (act === 'toggle') {
    const newState = toggleMcpServer(server.name);
    console.log(`\n  ${server.name}: ${newState ? green('enabled') : red('disabled')}\n`);
  } else if (act === 'restart') {
    console.log(`\n  ${dim('Restarting ' + server.name + '...')}\n`);
    const ok = await mcpManager.restartServer(server.name);
    console.log(`  ${ok ? green('Started') : red('Failed')}\n`);
  } else if (act === 'remove') {
    await mcpManager.stopServer(server.name);
    removeMcpServer(server.name);
    console.log(`\n  ${green('Removed: ' + server.name)}\n`);
  }

  await waitKey();
}

function showStatus(): void {
  const status = mcpManager.getStatus();
  const total = status.length;
  const running = status.filter(s => s.running).length;
  const tools = mcpManager.getToolCount();

  console.log();
  const lines = [
    `${bright.bold('MCP Server Status')}`,
    '',
    `Total: ${bright(String(total))}  Running: ${green(String(running))}  Tools: ${cyan(String(tools))}`,
    '',
    ...status.map(s => {
      const icon = s.running ? green('●') : red('○');
      const state = s.running ? green('running') : s.enabled ? yellow('stopped') : dim('disabled');
      const toolInfo = s.toolCount > 0 ? cyan(` ${s.toolCount} tools`) : '';
      const err = s.error ? red(` [${s.error.slice(0, 40)}]`) : '';
      return `  ${icon} ${s.name} ${state}${toolInfo}${err}`;
    }),
  ];
  drawBox(lines, 64);
  console.log();
}

// --- Low-level TUI helpers ---

function showSelector(title: string, items: MenuItem[]): Promise<number> {
  return new Promise(resolve => {
    let selected = 0;
    const render = () => {
      console.clear();
      console.log();
      console.log('  ' + teal.bold(title));
      console.log();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const marker = i === selected ? cyan('  ▶ ') : '    ';
        const label = i === selected ? bright(item.label) : dim(item.label);
        console.log(marker + label);
        if (item.sublabel) {
          console.log('      ' + chalk.hex('#606060')(item.sublabel));
        }
      }

      console.log();
      console.log('  ' + dim('↑↓ navigate  ⏎ select  esc back'));
    };

    render();

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (data: string) => {
      if (data === '\r' || data === '\n') {
        cleanup();
        resolve(selected);
        return;
      }
      if (data === '\x1b' || data === '\x03') {
        cleanup();
        resolve(-1);
        return;
      }
      if (data === ' ') {
        cleanup();
        resolve(selected);
        return;
      }
      // Arrow keys: ESC[A (up), ESC[B (down)
      if (data === '\x1b[A' || data === '\x1b[1;2A') {
        selected = Math.max(0, selected - 1);
        render();
      } else if (data === '\x1b[B' || data === '\x1b[1;2B') {
        selected = Math.min(items.length - 1, selected + 1);
        render();
      } else if (data === 'k' || data === 'w') {
        selected = Math.max(0, selected - 1);
        render();
      } else if (data === 'j' || data === 's') {
        selected = Math.min(items.length - 1, selected + 1);
        render();
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}

function readInput(label: string, placeholder: string): Promise<string> {
  return new Promise(resolve => {
    console.log();
    console.log('  ' + teal(label));
    if (placeholder) console.log('  ' + dim(placeholder));
    console.log();
    console.log('  > ');

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buf = '';
    const onData = (data: string) => {
      if (data === '\r' || data === '\n') {
        cleanup();
        resolve(buf.trim());
        return;
      }
      if (data === '\x1b' || data === '\x03') {
        cleanup();
        resolve('__back__');
        return;
      }
      if (data === '\x7f' || data === '\b') {
        buf = buf.slice(0, -1);
        process.stdout.write('\r  > ' + buf + '  ');
        return;
      }
      buf += data;
      process.stdout.write('\r  > ' + buf + '  ');
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && wasRaw) stdin.setRawMode(true);
      stdin.pause();
      console.log();
    };

    stdin.on('data', onData);
  });
}

function waitKey(): Promise<void> {
  return new Promise(resolve => {
    console.log('  ' + dim('Press any key to continue...'));
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      stdin.pause();
      resolve();
    };
    stdin.on('data', onData);
  });
}
