# AWS Management

Skill for deploying, managing, and optimizing resources on Amazon Web Services.

## Tools

- `aws_status` — Check the current status and health of AWS services and resources.
- `aws_deploy` — Deploy applications, functions, or containers to AWS services.
- `cloud_cost` — Analyze and report on current and projected cloud spending.

## Instructions

- Check cost implications before provisioning resources — use `cloud_cost` to monitor spend.
- Tag all resources consistently (e.g., `project`, `env`, `owner`) for tracking and cost allocation.
- Use IAM policies with least-privilege access; review and rotate credentials regularly.
- Prefer managed services (Lambda, ECS, RDS) over raw EC2 to reduce operational overhead.
