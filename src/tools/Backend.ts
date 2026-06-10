import type { Tool } from './Registry.js';

export const backendTools: Tool[] = [
  {
    name: 'scaffold_api',
    description: 'Generate an API project (Express, Fastify, or Hono).',
    parameters: {
      type: 'object',
      properties: {
        framework: { type: 'string', description: 'express, fastify, or hono' },
        name: { type: 'string', description: 'Project name' },
        database: { type: 'string', description: 'sqlite, postgres, mongodb, or none' },
      },
      required: ['framework', 'name'],
    },
    async execute(args) {
      const framework = (args.framework as string).toLowerCase();
      const name = args.name as string;
      const db = (args.database as string) || 'none';

      const deps: Record<string, string[]> = {
        express: ['express', 'cors', 'helmet', 'dotenv'],
        fastify: ['fastify', '@fastify/cors'],
        hono: ['hono', '@hono/node-server'],
      };

      const dbDeps: Record<string, string[]> = {
        sqlite: ['better-sqlite3'],
        postgres: ['pg', 'pg-pool'],
        mongodb: ['mongodb'],
        none: [],
      };

      const allDeps = [...(deps[framework] || deps.express), ...dbDeps[db] || []];

      return `API scaffold for ${name} (${framework} + ${db}):\n\n\`\`\`bash\nmkdir ${name} && cd ${name}\nnpm init -y\nnpm install ${allDeps.join(' ')}\nnpm install -D typescript @types/node tsx\nnpx tsc --init\n\`\`\`\n\nCreate src/index.ts with your ${framework} server entry point.`;
    },
  },
  {
    name: 'generate_schema',
    description: 'Generate a database schema and migration file.',
    parameters: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'sqlite, postgres, or mongodb' },
        table: { type: 'string', description: 'Table/collection name' },
        fields: { type: 'string', description: 'Fields as "name:type,name:type" (e.g. "id:integer,name:string,email:string")' },
      },
      required: ['database', 'table', 'fields'],
    },
    async execute(args) {
      const db = (args.database as string).toLowerCase();
      const table = args.table as string;
      const fields = (args.fields as string).split(',').map(f => {
        const [name, type] = f.split(':').map(s => s.trim());
        return { name, type: type || 'text' };
      });

      if (db === 'sqlite') {
        const cols = fields.map(f => {
          const sqlType = { integer: 'INTEGER', string: 'TEXT', text: 'TEXT', boolean: 'INTEGER', float: 'REAL' }[f.type] || 'TEXT';
          return `  ${f.name} ${sqlType}${f.name === 'id' ? ' PRIMARY KEY' : ''}`;
        });
        return `CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(',\n')},\n  created_at TEXT DEFAULT (datetime('now')),\n  updated_at TEXT DEFAULT (datetime('now'))\n);`;
      }

      if (db === 'postgres') {
        const cols = fields.map(f => {
          const pgType = { integer: 'SERIAL', string: 'VARCHAR(255)', text: 'TEXT', boolean: 'BOOLEAN', float: 'REAL' }[f.type] || 'TEXT';
          return `  ${f.name} ${pgType}${f.name === 'id' ? ' PRIMARY KEY' : ''}`;
        });
        return `CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(',\n')},\n  created_at TIMESTAMP DEFAULT NOW(),\n  updated_at TIMESTAMP DEFAULT NOW()\n);`;
      }

      return `// MongoDB schema for ${table}\nconst schema = {\n${fields.map(f => `  ${f.name}: { type: '${f.type}' }`).join(',\n')},\n  created_at: { type: Date, default: Date.now },\n};`;
    },
  },
  {
    name: 'generate_endpoint',
    description: 'Generate REST CRUD endpoint code for a resource.',
    parameters: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'Resource name (e.g. users, posts)' },
        framework: { type: 'string', description: 'express, fastify, or hono' },
        operations: { type: 'string', description: 'Comma-separated: create,read,update,delete,list' },
      },
      required: ['resource'],
    },
    async execute(args) {
      const resource = args.resource as string;
      const framework = (args.framework as string) || 'express';
      const ops = ((args.operations as string) || 'create,read,update,delete,list').split(',');
      const r = `/${resource}`;
      const singular = resource.replace(/s$/, '');

      if (framework === 'express') {
        const routes: string[] = [];
        if (ops.includes('list')) routes.push(`router.get('${r}', async (req, res) => {\n  // List all ${resource}\n  res.json([]);\n});`);
        if (ops.includes('read')) routes.push(`router.get('${r}/:id', async (req, res) => {\n  // Get ${singular} by id\n  res.json({});\n});`);
        if (ops.includes('create')) routes.push(`router.post('${r}', async (req, res) => {\n  // Create ${singular}\n  res.status(201).json({});\n});`);
        if (ops.includes('update')) routes.push(`router.put('${r}/:id', async (req, res) => {\n  // Update ${singular}\n  res.json({});\n});`);
        if (ops.includes('delete')) routes.push(`router.delete('${r}/:id', async (req, res) => {\n  // Delete ${singular}\n  res.status(204).send();\n});`);
        return `const router = express.Router();\n\n${routes.join('\n\n')}\n\nexport default router;`;
      }

      return `// ${framework} CRUD for ${resource}\n// Operations: ${ops.join(', ')}\n// Use your framework's router pattern.`;
    },
  },
  {
    name: 'setup_auth',
    description: 'Generate authentication setup (JWT or session-based).',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'jwt or session' },
        framework: { type: 'string', description: 'express, fastify, or hono' },
      },
      required: ['method'],
    },
    async execute(args) {
      const method = (args.method as string).toLowerCase();
      if (method === 'jwt') {
        return `JWT Auth Setup:\n\n\`\`\`bash\nnpm install jsonwebtoken bcryptjs\nnpm install -D @types/jsonwebtoken @types/bcryptjs\n\`\`\`\n\n// middleware/auth.ts\nimport jwt from 'jsonwebtoken';\n\nexport function authMiddleware(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'No token' });\n  try {\n    req.user = jwt.verify(token, process.env.JWT_SECRET);\n    next();\n  } catch {\n    res.status(401).json({ error: 'Invalid token' });\n  }\n}`;
      }
      return `Session Auth Setup:\n\n\`\`\`bash\nnpm install express-session\n\`\`\`\n\n// Configure session middleware with secure cookies.`;
    },
  },
  {
    name: 'generate_dockerfile',
    description: 'Generate a Dockerfile and docker-compose.yml for the project.',
    parameters: {
      type: 'object',
      properties: {
        runtime: { type: 'string', description: 'node, python, go' },
        port: { type: 'number', description: 'Application port (default: 3000)' },
        database: { type: 'string', description: 'Include database service: postgres, mongodb, redis' },
      },
      required: ['runtime'],
    },
    async execute(args) {
      const runtime = args.runtime as string;
      const port = (args.port as number) || 3000;
      const db = args.database as string | undefined;

      let dockerfile = `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --production\nCOPY . .\nEXPOSE ${port}\nCMD ["node", "dist/index.js"]`;

      let compose = `services:\n  app:\n    build: .\n    ports:\n      - "${port}:${port}"\n    environment:\n      - NODE_ENV=production`;

      if (db === 'postgres') {
        compose += `\n      - DATABASE_URL=postgres://user:pass@db:5432/app\n    depends_on:\n      - db\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_USER: user\n      POSTGRES_PASSWORD: pass\n      POSTGRES_DB: app\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:`;
      } else if (db === 'mongodb') {
        compose += `\n      - MONGODB_URL=mongodb://db:27017/app\n    depends_on:\n      - db\n  db:\n    image: mongo:7\n    volumes:\n      - mongodata:/data/db\nvolumes:\n  mongodata:`;
      } else if (db === 'redis') {
        compose += `\n      - REDIS_URL=redis://cache:6379\n    depends_on:\n      - cache\n  cache:\n    image: redis:7-alpine`;
      }

      return `# Dockerfile\n${dockerfile}\n\n---\n\n# docker-compose.yml\n${compose}`;
    },
  },
];
