# Claude Code Engineering Agents — Usage Guide

This repository installs a senior/principal multi-agent engineering team for Claude Code.

## Core modes

### BUILD

```text
Use engineering-orchestrator in BUILD mode.

Build the following feature:

[DESCRIBE THE FEATURE]

Analyze the existing architecture first.
Select only the senior agents required.
Preserve existing project conventions.
Implement the feature completely.
Run all relevant tests.
Audit all modified areas with independent auditors.
Fix all CRITICAL and HIGH findings.
Re-audit before completion.
Do not consider the task complete until principal-engineering-auditor approves it.
```

### AUDIT

```text
Use engineering-orchestrator in AUDIT mode.

Audit this entire project.
Do not modify any files.

Use the appropriate independent auditors for architecture, backend, frontend, database, security, UI/UX, DevOps and QA.
Classify findings as CRITICAL, HIGH, MEDIUM or LOW.
At the end, have principal-engineering-auditor produce the final assessment.
```

### AUDIT_AND_FIX

```text
Use engineering-orchestrator in AUDIT_AND_FIX mode.

Audit the entire project first.
Create a prioritized remediation plan.
Assign fixes to the appropriate senior build agents.
Run tests.
Independently audit every modified area.
Fix remaining CRITICAL and HIGH issues.
Re-audit.
Require principal-engineering-auditor approval.
```

### FINAL REVIEW

```text
Use principal-engineering-auditor.

Perform the final production readiness review.
Review implementation changes, test results and auditor findings.
Return exactly one final status: APPROVED or NOT APPROVED.
Do not approve while any unresolved CRITICAL or HIGH issue exists.
```

## Direct specialist invocation

You can also call an individual agent directly, for example:

```text
Use backend-engineer to implement this Laravel API feature.
```

```text
Use security-auditor to independently review authentication, authorization and tenant isolation. Do not modify code.
```

```text
Use database-engineer to review the MySQL schema, migrations, indexes and transaction strategy.
```

## System rules

- Builders do not approve their own work.
- CRITICAL or HIGH findings block final approval.
- Database changes require database audit.
- Security-sensitive and tenant-boundary changes require security audit.
- Infrastructure/deployment changes require DevOps audit.
- User-facing changes require frontend/UI-UX audit when applicable.
- Meaningful behavioral changes require QA validation.
- Cross-tenant data leakage is CRITICAL.
- Non-trivial work requires the principal engineering auditor before release.

## Agent locations

Global installation:

```text
~/.claude/agents/
```

Project-only installation:

```text
<project>/.claude/agents/
```
