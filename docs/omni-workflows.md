# Omni Workflow Capability Pack

This pack turns the four product cards into a concrete omni-agent capability surface. The goal is not to hide external integration risk behind vague promises. Each workflow has:

- a catalog entry
- a connector/configuration probe
- an approval-aware execution plan
- a replayable dry-run artifact

The runtime tools are:

- `omni_workflow_catalog`
- `omni_connector_probe`
- `omni_workflow_plan`
- `omni_workflow_dry_run`

## Capability Map

| Category | Capability | Workflow id | Default mode |
| --- | --- | --- | --- |
| Personal Efficiency Assistant | Telegram and Discord remote dialogue | `remote_dialogue` | connector-gated |
| Personal Efficiency Assistant | Apple notes and reminders management | `apple_notes_reminders` | connector-gated |
| Personal Efficiency Assistant | Automatic file and document organization | `file_document_organizer` | local write gated |
| Personal Efficiency Assistant | Scheduled daily digest | `daily_digest` | automation gated |
| Content Creation Assistant | PDF, Word, Excel, and PPT processing | `office_document_processing` | local write gated |
| Content Creation Assistant | AI-generated rich articles | `rich_article_generation` | local write gated |
| Content Creation Assistant | Multi-platform social publishing | `multi_platform_social_publish` | connector-gated |
| Content Creation Assistant | Automatic content calendar management | `content_calendar` | local write gated |
| Development Workflow | GitHub project automation | `github_project_management` | connector-gated |
| Development Workflow | Code review and documentation generation | `code_review_docs` | local write gated |
| Development Workflow | Browser automation testing | `browser_automation_testing` | approval gated |
| Development Workflow | Scheduled backup and monitoring | `backup_monitoring` | automation gated |
| Intelligent Automation | Scheduled data collection and monitoring | `data_collection_monitoring` | automation gated |
| Intelligent Automation | Automatic anomaly alerts | `anomaly_alerts` | connector-gated |
| Intelligent Automation | Cross-platform message sync and forwarding | `message_sync_forwarding` | connector-gated |
| Intelligent Automation | 24x7 unattended operation | `always_on_operations` | automation gated |

## Safety Model

`omni_workflow_dry_run` never calls external services, never writes workspace files, and never mutates user accounts. Live actions are represented as blocked handoff plans unless the operator invokes the specific downstream connector or native tool after approval.

External-write workflows require connector secrets such as `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `GITHUB_TOKEN`, `SOCIAL_PUBLISH_API_KEY`, or `ALERT_WEBHOOK_URL`. The connector probe reports only configured/missing status and does not expose secret values.

## Demo Commands

```powershell
npm run dev -- tools --query omni_workflow
npm run dev -- skills --cwd "." --query social
```

Inside an agent run, use:

```json
{ "workflowId": "multi_platform_social_publish", "mode": "live" }
```

with `omni_workflow_plan` to show the approval and connector gates, then use `omni_workflow_dry_run` to produce a replayable artifact for evaluation.
