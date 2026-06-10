# Google Cloud Platform

Skill for managing and deploying services on Google Cloud Platform (GCP).

## Tools

- `gcloud_status` — Check the current status and health of GCP services and projects.
- `gcloud_deploy` — Deploy applications, functions, or containers to GCP services.

## Instructions

- Always verify billing is enabled and review cost estimates before provisioning new resources.
- Apply least-privilege IAM roles — grant only the permissions a service account actually needs.
- Use regional resources over multi-regional when possible to reduce cost and latency.
- Enable required APIs explicitly before referencing them in deployment configuration.
