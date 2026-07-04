const fs = require('fs');

let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

const target = `      const res = await this.client.chat.completions.create(params);
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);
    } catch (e: any) {`;

const inject = `      // Bypass OpenAI SDK completely to avoid proxy-connection issues with local routers
      const url = this.baseUrl.endsWith('/chat/completions') 
        ? this.baseUrl 
        : \`\${this.baseUrl}/chat/completions\`;
        
      const fetchRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${this.apiKey}\`
        },
        body: JSON.stringify(params)
      });

      if (!fetchRes.ok) {
        const errorText = await fetchRes.text();
        let parsedErr;
        try { parsedErr = JSON.parse(errorText); } catch {}
        const errorMsg = parsedErr?.error?.message || parsedErr?.errorMsg || errorText || fetchRes.statusText;
        
        if (fetchRes.status === 404 || fetchRes.status === 405) {
          if (!this.endpointMode) {
            this.endpointMode = 'completion';
            return this.completionFallback(messages);
          }
        }
        
        if (errorMsg.includes('connect proxy error') || errorMsg.includes('9router')) {
          throw new Error(\`9Router Proxy Error: \${errorMsg}\`);
        }
        
        throw new Error(\`HTTP \${fetchRes.status}: \${errorMsg}\`);
      }

      const res = await fetchRes.json() as any;
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);
    } catch (e: any) {`;

provider = provider.replace(target, inject);
fs.writeFileSync('src/providers/index.ts', provider);
console.log('OpenAI Provider switched to native fetch');
