const fs = require('fs');
let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

// 1. Add abort controller to AgentLoop
if (!agent.includes("private abortController: AbortController;")) {
  agent = agent.replace(
    "private ledger = new TokenLedger();",
    "private ledger = new TokenLedger();\n  private abortController = new AbortController();"
  );
}

// 2. Update interrupt() to trigger abort
const targetInterrupt = `  interrupt(): void {
    this.interrupted = true;
  }`;
const injectInterrupt = `  interrupt(): void {
    this.interrupted = true;
    this.abortController.abort();
  }`;
if (agent.includes(targetInterrupt)) {
  agent = agent.replace(targetInterrupt, injectInterrupt);
}

fs.writeFileSync('src/agent/AgentLoop.ts', agent);
console.log('AgentLoop patched for ESC AbortController');

// Now update the Provider to accept and use the signal
let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

// Add signal to Provider interface
if (!provider.includes("signal?: AbortSignal")) {
  provider = provider.replace(
    "chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse>;",
    "chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse>;"
  );
  
  // Add it to OpenAIProvider signature
  provider = provider.replace(
    "async chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {",
    "async chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse> {"
  );

  // Inject signal into the native fetch call
  const targetFetch = `      const fetchRes = await fetch(url, fetchOpts);`;
  const injectFetch = `      if (signal) fetchOpts.signal = signal;
      const fetchRes = await fetch(url, fetchOpts);`;
  provider = provider.replace(targetFetch, injectFetch);
  
  fs.writeFileSync('src/providers/index.ts', provider);
  console.log('Provider patched to use AbortSignal');
}
