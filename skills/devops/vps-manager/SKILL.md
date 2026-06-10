---
name: vps-manager
description: VPS server management, monitoring, deployment, Docker, nginx, SSL
tags: [devops, vps, server, docker, nginx, deploy]
---

# VPS Manager Skill

Full VPS management with safety guards.

## Capabilities
- System status monitoring
- Service management (systemd)
- Docker container management
- Nginx configuration
- SSL certificate management
- Backup creation and verification
- Security hardening audit
- Log analysis
- Safe cleanup (no destructive ops without confirmation)

## Safety Rules
- NEVER delete data without explicit confirmation
- NEVER modify production configs without backup
- Always verify nginx config before reload
- Always test SSL after certificate changes

## Tools
Use `vps` tool for all server operations
