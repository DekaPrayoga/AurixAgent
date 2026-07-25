# CI/CD Pipeline Management

Configure and maintain continuous integration and deployment pipelines for reliable software delivery.

## Tools

- `setup_ci` — Configure CI/CD workflows for GitHub Actions and other providers.
- `github_pr` with `action: create` — Create pull requests with proper descriptions and labels.
- `deploy_vercel` — Deploy frontend applications to Vercel.

## Instructions

- Optimize for fast feedback — run linting and unit tests before expensive integration suites.
- Cache dependencies and build artifacts between runs to cut pipeline duration.
- Use fail-fast strategies: cancel redundant workflow runs and stop on first critical failure.
- Pin action versions and avoid mutable tags in production pipelines.
