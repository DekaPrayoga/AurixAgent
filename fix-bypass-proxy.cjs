const fs = require('fs');

let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

// The Undici fetch implementation in Node/Bun can be forced to bypass proxies using an empty proxy dispatcher,
// but since we want maximum compatibility, we can just use the Undici `Agent` with no proxy.
const target = `      const fetchRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${this.apiKey}\`
        },
        body: JSON.stringify(params)
      });`;

const inject = `      let fetchOpts: any = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${this.apiKey}\`
        },
        body: JSON.stringify(params)
      };

      // Force direct connection (bypass global/system proxies)
      // This is crucial for local endpoints like 127.0.0.1 which get banned by external residential proxies.
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        try {
          const { Agent } = await import('undici');
          fetchOpts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } }); // Raw socket agent, no proxy
        } catch (e) {}
      }

      const fetchRes = await fetch(url, fetchOpts);`;

if (!provider.includes("fetchOpts.dispatcher")) {
  provider = provider.replace(target, inject);
  fs.writeFileSync('src/providers/index.ts', provider);
  console.log('Provider patched to bypass proxy for localhost');
}
