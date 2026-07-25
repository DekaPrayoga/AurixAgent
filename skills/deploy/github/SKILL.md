# GitHub Deployment

Skill for deploying static sites and automating workflows via GitHub Pages and Actions.

## Tools

- `deploy_github_pages` — Deploy a static site or built output to GitHub Pages.
- `setup_ci` — Generate and configure GitHub Actions workflow files for CI/CD.
- `github_pr` with `action: create` — Create a pull request to trigger CI and peer review before merging.

## Instructions

- Use GitHub Actions workflow files (`.github/workflows/`) for CI — keep them modular and readable.
- Enable dependency caching (`actions/cache` or built-in cache options) to speed up CI runs.
- Always open a pull request and let CI pass before merging to the default branch.
- Pin action versions to specific SHAs or tags to avoid unexpected breaking changes.
