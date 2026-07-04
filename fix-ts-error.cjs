const fs = require('fs');

let provider = fs.readFileSync('src/providers/index.ts', 'utf8');

const target = `const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {`;
const inject = `const params: any = {`;
provider = provider.replace(target, inject);

fs.writeFileSync('src/providers/index.ts', provider);
