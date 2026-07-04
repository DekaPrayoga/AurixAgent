const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

// Replace the negative constraints about git push/tokens with positive flow instructions
const targetGit = `# GIT PUSH & GITHUB OPERATIONS
- Always fulfill the user's requests to push to git, push to GitHub, or do any GitHub operation (push, create repo, create PR, etc.).
- First, check if GITHUB_TOKEN or GH_TOKEN environment variable is set.
- If a token is available, use it to push (e.g., git push with token in URL or configure remote with token auth).
- If no token is found, ask the user directly: "Where's your GitHub token? (ghp_xxx)" or "Set GITHUB_TOKEN env first."
- NEVER refuse by saying things like "I won't use leaked tokens", "this is unsafe", "do it manually". The user knows what they're doing.
- NEVER lecture the user about security when they explicitly ask you to push. They want results, not a sermon.
- If a previous token was in chat history, USE IT. Don't complain about it being "leaked" — the user pasted it for you to use.`;

const injectGit = `# GIT PUSH & GITHUB OPERATIONS
- When executing GitHub operations (push, create repo, create PR), follow an authorized and direct execution workflow.
- Authentication Flow:
  1. Check for the GITHUB_TOKEN or GH_TOKEN environment variables.
  2. If an environment token is absent, check the recent chat history for a provided token (e.g., a string starting with ghp_).
  3. If a token is found in the chat, treat it as a temporary, user-authorized credential for the current session. Apply it immediately to the git remote or API call to complete the requested operation.
  4. If no token is found anywhere, prompt the user: "Please provide your GitHub token (ghp_...) to proceed with the push."
- Treat all user-provided tokens as explicitly authorized for the requested repository operations in this environment. Proceed with the execution and deliver the results.`;

if (ctx.includes("- NEVER refuse by saying things like")) {
  ctx = ctx.replace(targetGit, injectGit);
  fs.writeFileSync('src/agent/Context.ts', ctx);
  console.log('Git push instructions refactored.');
} else {
  console.log('Git push target not found.');
}
