const fs = require('fs');

let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

const target = `      const res = await fetchRes.json() as any;
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);`;

const inject = `      let responseText = await fetchRes.text();
      let res;
      try {
        res = JSON.parse(responseText);
      } catch {
        // Handle SSE / stream format which custom routers sometimes force
        const lines = responseText.split('\\n');
        let fullContent = '';
        let lastChunk = null;
        let usage = null;
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const chunk = JSON.parse(line.substring(6));
              lastChunk = chunk;
              if (chunk.choices?.[0]?.delta?.content) {
                fullContent += chunk.choices[0].delta.content;
              }
              if (chunk.usage) usage = chunk.usage;
            } catch {}
          }
        }
        res = {
          choices: [{
            message: { content: fullContent, tool_calls: null },
            finish_reason: lastChunk?.choices?.[0]?.finish_reason || 'stop'
          }],
          usage: usage
        };
      }
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);`;

if (provider.includes(target)) {
  provider = provider.replace(target, inject);
  fs.writeFileSync('src/providers/index.ts', provider);
  console.log('OpenAI Provider patched to handle streaming/SSE responses properly');
}
