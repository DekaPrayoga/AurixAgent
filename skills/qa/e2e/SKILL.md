# End-to-End Testing

Validate complete user journeys through the application using browser automation and integration tests.

## Tools

- `terminal` — Run e2e test runners (Playwright, Cypress, Selenium).
- `browser` — Automate browser interactions and capture screenshots.
- `code_exec` — Execute helper scripts for test setup and data seeding.

## Instructions

- Model tests around real user journeys, not implementation details.
- Detect and quarantine flaky tests early — retry logic should flag, not mask, instability.
- Integrate e2e suites into CI so regressions are caught before merge.
- Use realistic but controlled test data; never test against production databases.
