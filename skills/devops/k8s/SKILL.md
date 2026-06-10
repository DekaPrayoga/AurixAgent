# Kubernetes Orchestration

Deploy and manage applications on Kubernetes clusters with proper isolation and resource management.

## Tools

- `terminal` — Execute kubectl commands and manage cluster resources.
- `docker_manage` — Build and push container images to registries.

## Instructions

- Use namespace isolation to separate environments (dev, staging, prod).
- Always set resource requests and limits to prevent resource starvation.
- Implement rolling updates with proper readiness and liveness probes.
- Use ConfigMaps and Secrets for configuration, never hardcode values in manifests.
