# Claude Engineering Team

A multi-agent Claude Code engineering system with independent build and audit roles.

## Install globally

macOS/Linux/WSL:

```bash
bash install.sh --global
```

Windows PowerShell:

```powershell
./install.ps1 -Global
```

## Install into one project

From this folder:

```bash
bash install.sh --project /path/to/repo
```

PowerShell:

```powershell
./install.ps1 -ProjectPath C:\path\to\repo
```

Global agents go to `~/.claude/agents/`. Project agents go to `<repo>/.claude/agents/`.

## Use

Examples:

- `Use engineering-orchestrator to build the invoicing module, test it, audit it, and do not approve it until independent reviewers pass it.`
- `Use engineering-orchestrator in AUDIT mode. Audit this project only; do not modify files.`
- `Use engineering-orchestrator in AUDIT_AND_FIX mode for authentication and tenant isolation.`

The orchestrator selects only the relevant specialists and sends non-trivial work through `principal-engineering-auditor` before final approval.

## Senior stack profile

All builder and auditor agents are tuned for principal/senior-level work in PHP/Laravel, MySQL, Tailwind/DaisyUI, Flutter, AWS, REST/JSON APIs, security, and multi-tenant SaaS. The orchestrator detects the actual repository stack and activates only relevant specialists. Builders cannot approve their own work; CRITICAL/HIGH audit findings block the final production verdict.
