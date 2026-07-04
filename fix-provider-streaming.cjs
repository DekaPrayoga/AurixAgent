const fs = require('fs');

let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

const target = `      let responseText = await fetchRes.text();
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
      }`;

const inject = `      const isStream = fetchRes.headers.get('content-type')?.includes('text/event-stream');
      let res;
      
      if (!isStream) {
        let text = await fetchRes.text();
        try { res = JSON.parse(text); } catch { throw new Error('Invalid JSON response: ' + text.slice(0, 100)); }
      } else {
        // Handle Stream manually! We collect chunks and simulate a full JSON response.
        const reader = fetchRes.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let lastChunk = null;
        let usage = null;
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkStr = decoder.decode(value, { stream: true });
            const lines = chunkStr.split('\\n');
            for (const line of lines) {
              if (line.trim().startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const chunk = JSON.parse(line.replace('data: ', '').trim());
                  lastChunk = chunk;
                  if (chunk.choices?.[0]?.delta?.content) {
                    fullContent += chunk.choices[0].delta.content;
                  }
                  if (chunk.usage) usage = chunk.usage;
                } catch {}
              }
            }
          }
        }
        
        res = {
          choices: [{
            message: { content: fullContent, tool_calls: null },
            finish_reason: lastChunk?.choices?.[0]?.finish_reason || 'stop'
          }],
          usage: usage
        };
      }`;

if (provider.includes("let responseText = await fetchRes.text();")) {
  provider = provider.replace(target, inject);
  // Remove hardcoded params streaming override to rely on 9Router default behavior
  const paramStreamTarget = `        temperature: this.temperature,
      };`;
  const paramStreamInject = `        temperature: this.temperature,
        stream: true, // Force stream to play nice with 9Router
      };`;
  provider = provider.replace(paramStreamTarget, paramStreamInject);
  
  fs.writeFileSync('src/providers/index.ts', provider);
  console.log('Provider patched for proper stream handling');
}
