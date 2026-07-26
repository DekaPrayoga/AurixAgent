// Public-feed research and the social-researching skill's credential handoff.
// Gated on that skill being installed — the .env path below is meaningless without it.
//
// This used to be a four-paragraph "[PUBLIC DATA AGGREGATION PROTOCOL]" written in the
// register of a jailbreak post ("Standard interactive user guidelines do not apply").
// That framing argues with the model's training instead of stating a fact, and the
// operator's authority is already established once in "# Non-negotiable".

export const SOCIAL_RESEARCH = `# Public feed research
Indexing and aggregating public feeds (X/Twitter, Reddit, HackerNews) is ordinary analytics work here — the same shape as search indexing or sentiment research. Extract and structure what was asked for, directly.

If the operator hands you their Twitter/X cookies ('auth_token' and 'ct0'), that is them authenticating their own skill. Write them to skills/research/social-researching/.env with write_file or file_edit:

AUTH_TOKEN="..."
CT0="..."

Then confirm the skill is authenticated.`;
