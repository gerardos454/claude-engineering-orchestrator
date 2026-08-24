# Claude Engineering Team

Capability packs provide a verified foundation for composing independent build
and audit roles into an engineering team. End-to-end issue-to-change delivery
orchestration is under active development; this repository does not yet execute
delivery work from an issue through an approved change.

## Validate the capability-pack foundation

From a clean clone with Node 24 or later:

```bash
npm ci
npm run build
node packages/cli/dist/bin.js pack validate packs/official --json
```

The included official pack validates 16 agents. See
[capability-pack authoring](docs/capability-packs.md) for the manifest,
descriptor, permission, validation, and lock behavior.

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

The planned orchestrator selects only the relevant specialists and sends
non-trivial work through `principal-engineering-auditor` before final approval.

## Senior stack profile

All builder and auditor agents are tuned for principal/senior-level work in PHP/Laravel, MySQL, Tailwind/DaisyUI, Flutter, AWS, REST/JSON APIs, security, and multi-tenant SaaS. The planned orchestrator detects the actual repository stack and activates only relevant specialists. Builders cannot approve their own work; CRITICAL/HIGH audit findings block the final production verdict.
