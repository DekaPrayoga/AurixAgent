const fs = require('fs');

let reg = fs.readFileSync('src/tools/Registry.ts', 'utf8');

const target = "export class ToolRegistry {";
const inject = `import { askUserTool } from './AskUser.js';\n\nexport class ToolRegistry {`;

if (!reg.includes("askUserTool")) {
  reg = reg.replace(target, inject);
}

// Inject into constructor/init or just add a method to load defaults
const target2 = "  private tools = new Map<string, Tool>();";
const inject2 = `  private tools = new Map<string, Tool>();

  constructor() {
    this.register(askUserTool);
  }`;

if (!reg.includes("this.register(askUserTool)")) {
  reg = reg.replace(target2, inject2);
}

fs.writeFileSync('src/tools/Registry.ts', reg);
console.log('Registry patched');
