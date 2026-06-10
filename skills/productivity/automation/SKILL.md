# Workflow Automation

Build and manage automated workflows, scripts, and system-level automations.

## Tools

- `terminal` - Execute shell commands, scripts, and system operations
- `setup_notifier` - Configure notifications and alerts for workflow events

## Instructions

- Design all operations to be idempotent so workflows can be safely re-run without side effects
- Implement robust error handling with clear failure messages and recovery paths at every step
- Log all workflow actions and outcomes for debugging, auditing, and observability
- Use `setup_notifier` to alert on failures or completions so issues are caught immediately
