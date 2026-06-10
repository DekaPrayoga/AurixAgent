# Vercel Deployment

Skill for deploying frontend and full-stack applications to Vercel.

## Tools

- `deploy_vercel` — Deploy a project to Vercel (preview or production).
- `deploy_status` — Check the current status of a Vercel deployment.
- `build_check` — Run a local production build to catch errors before deploying.

## Instructions

- Always run a build check locally before deploying to catch compilation and type errors early.
- Deploy to a preview environment first to validate changes before promoting to production.
- Verify environment variables are set in the Vercel project dashboard for each target environment.
- Review deployment logs when a deploy fails — most issues are build-time or config-related.
