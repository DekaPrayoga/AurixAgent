const credit = 140;

const prices = {
  // Input: $2.50 / 1M tokens
  // Cache Write: $2.50 / 1M tokens
  // Cache Hit (Read): $1.25 / 1M tokens
  // Output: $10.00 / 1M tokens
  input: 2.50,
  cacheWrite: 2.50,
  cacheHit: 1.25,
  output: 10.00
};

console.log("Tokens you can get with $140 for Gemini 1.5 Pro (often branded 2.5 Pro on custom endpoints):");
console.log(`- If ONLY Input: ${credit / prices.input} Million tokens`);
console.log(`- If ONLY Output: ${credit / prices.output} Million tokens`);
console.log(`- If ONLY Cache Read (Hit): ${credit / prices.cacheHit} Million tokens`);
console.log(`- Realistic Mix (70% Cache Hit, 25% Input, 5% Output):`);
console.log(`   (Cost per 1M mixed tokens = (0.7 * 1.25) + (0.25 * 2.50) + (0.05 * 10) = $${(0.7 * 1.25 + 0.25 * 2.5 + 0.05 * 10)})`);
console.log(`   Total mixed tokens: ${credit / (0.7 * 1.25 + 0.25 * 2.5 + 0.05 * 10)} Million tokens`);
