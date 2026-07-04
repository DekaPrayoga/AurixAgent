const fs = require('fs');
let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

// The original code was throwing the OpenAI SDK error object, which hides the actual response body.
// We need to extract the actual API response body so it's visible.

const target = `    } catch (e: any) {
      if ((e.status === 404 || e.status === 405) && !this.endpointMode) {
        this.endpointMode = 'completion';
        return this.completionFallback(messages);
      }
      throw e;
    }`;

const inject = `    } catch (e: any) {
      if ((e.status === 404 || e.status === 405) && !this.endpointMode) {
        this.endpointMode = 'completion';
        return this.completionFallback(messages);
      }
      
      // If it's a 403 or API error, try to extract the real response body from 9router/OpenAI SDK
      let errorMsg = e.message || String(e);
      if (e.response && e.response.data) {
        try {
          const parsed = typeof e.response.data === 'string' ? JSON.parse(e.response.data) : e.response.data;
          errorMsg = parsed.error?.message || parsed.errorMsg || JSON.stringify(parsed);
        } catch (_) {}
      } else if (e.error?.message) {
        errorMsg = e.error.message;
      } else if (e.errorMsg) {
        errorMsg = e.errorMsg;
      }
      
      // Fallback extraction for custom OpenAI wrapper errors
      if (errorMsg.includes('errorMsg: connect proxy error')) {
        throw new Error(\`9Router Error: \${errorMsg}. Please check your 9router upstream proxy settings.\`);
      }
      
      throw new Error(errorMsg);
    }`;

if (provider.includes(target)) {
  provider = provider.replace(target, inject);
  fs.writeFileSync('src/providers/index.ts', provider);
  console.log('Providers patched');
} else {
  console.log('Target not found');
}
