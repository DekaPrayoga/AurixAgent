const fs = require('fs');

let commands = fs.readFileSync('src/cli/commands.ts', 'utf8');

const target = `export function createSlashCommands(`;
const inject = `export function createSlashCommands(
  config: AurixConfig,
  saveConfigObj: (c: AurixConfig) => void,
  registry: ToolRegistry,
  agent: AgentLoop,
  onExit: () => void,
  onSwitchMode?: (mode: 'auto' | 'chat') => void
): SlashCommand[] {
  const commandsList: SlashCommand[] = [
    {
      name: 'dashboard',
      description: 'Launch the Aurix Web Dashboard & API Server',
      execute: async () => {
        import('../api/Server.js').then(({ AurixServer }) => {
          const server = new AurixServer(registry);
          server.start(3000);
        }).catch(e => {
          console.error('Failed to start dashboard server:', e);
        });
        return '[System] Starting Aurix Web Dashboard on http://localhost:3000...';
      }
    },
    {
      name: 'cron',
      description: 'List active cron jobs. Use dashboard to add/remove jobs.',
      execute: async () => {
        return '[System] Cron Daemon is active. Open the dashboard (/dashboard) to manage triggers.';
      }
    },`;

if (!commands.includes("name: 'dashboard'")) {
  commands = commands.replace(/export function createSlashCommands\([\s\S]*?\]: SlashCommand\[\] \{\n  const commandsList: SlashCommand\[\] = \[/, inject);
  fs.writeFileSync('src/cli/commands.ts', commands);
  console.log('Commands patched with /dashboard and /cron');
}
