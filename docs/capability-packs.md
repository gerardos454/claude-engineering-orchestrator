# Capability pack authoring

Capability packs declare the specialist roles and review boundaries that the
engineering orchestrator can use. The pack foundation currently provides a
strict local validator and deterministic dependency resolution. End-to-end
delivery orchestration is under active development.

## Validate the included pack

Use Node 24 or later. From a clean clone, install dependencies, build the CLI,
then validate the included official pack:

```bash
npm ci
npm run build
node packages/cli/dist/bin.js pack validate packs/official
node packages/cli/dist/bin.js pack validate packs/official --json
```

The text command reports the pack identifier and agent count. The JSON command
returns the stable nested `pack` object on success:

```json
{
  "ok": true,
  "pack": {
    "id": "official.engineering-team",
    "version": "0.1.0",
    "agents": 16
  }
}
```

`--json` writes errors to standard error, so automation should inspect the
process exit status and standard error on failure.

## Layout and manifest

A pack root contains a `pack.yaml` manifest and the YAML descriptors listed by
that manifest. The included pack is a working layout:

```text
packs/official/
  pack.yaml
  agents/
    backend-engineer.yaml
    backend-auditor.yaml
    security-engineer.yaml
    security-auditor.yaml
    software-architect.yaml
    software-architect-auditor.yaml
    frontend-engineer.yaml
    frontend-auditor.yaml
    ui-ux-engineer.yaml
    ui-ux-auditor.yaml
    database-engineer.yaml
    database-auditor.yaml
    devops-engineer.yaml
    devops-auditor.yaml
    qa-engineer.yaml
    qa-auditor.yaml
```

This complete manifest shows every manifest field. `dependencies` is optional
in the schema; an empty map is used here because the official pack has no
dependencies. The paths resolve under `packs/official`.

```yaml
id: official.engineering-team
version: 0.1.0
license: MIT
core: ^0.1.0
capabilities:
  - orchestration
  - principal-review
  - architecture
  - backend
  - frontend
  - ui-ux
  - database
  - security
  - devops
  - qa
dependencies: {}
agents:
  - agents/software-architect.yaml
  - agents/software-architect-auditor.yaml
  - agents/backend-engineer.yaml
  - agents/backend-auditor.yaml
  - agents/frontend-engineer.yaml
  - agents/frontend-auditor.yaml
  - agents/ui-ux-engineer.yaml
  - agents/ui-ux-auditor.yaml
  - agents/database-engineer.yaml
  - agents/database-auditor.yaml
  - agents/security-engineer.yaml
  - agents/security-auditor.yaml
  - agents/devops-engineer.yaml
  - agents/devops-auditor.yaml
  - agents/qa-engineer.yaml
  - agents/qa-auditor.yaml
```

The pack ID and agent IDs must use lowercase letters, digits, dots, and
hyphens. Versions are three numeric components. Descriptor paths must be
relative YAML paths inside the pack root: no absolute paths, drive paths,
backslashes, or parent-directory traversal.

Registry map values follow the opposite rule. `resolvePacks` accepts a map
from pack ID to a registry location; each map value must be an absolute path
inside the configured registry root. The resolver first rejects a value that
lexically lies outside that root, resolves its canonical path, then rejects it
again if a symlink or other canonical resolution escapes the registry root.

## Agent descriptors, roles, and activation

Each listed descriptor must contain every field shown below. This is the
working `packs/official/agents/backend-engineer.yaml` descriptor.

```yaml
id: backend-engineer
role: builder
produces:
  - patch
  - backend-test-results
  - api-contract-evidence
reviewed_by:
  - backend-auditor
requires:
  tools: [Read, Grep, Glob, Edit, Write, Bash]
  capabilities: [backend, orchestration]
risk:
  forbidden: [self-approval, cross-tenant-data-access]
```

`role` is one of `builder`, `auditor`, or `advisor`. Builders produce changes
and evidence; auditors independently examine that evidence; advisors provide
guidance without being an approval authority. A pack's `capabilities` and an
agent's `requires.capabilities` are the activation signals used to match work
to relevant specialists. The current foundation validates their structure but
does not yet schedule agents or make activation decisions.

`requires.tools` and `requires.capabilities` are requested permissions, not a
runtime grant. The host that runs an agent must grant the actual tool access.
The pack validator checks that these fields are arrays of unique strings; it
does not inspect a host's permissions or elevate access. Keep requests narrow,
and list sensitive operations under `risk.forbidden`.

Review must be independent: a builder cannot approve itself. The validator
rejects a descriptor whose `reviewed_by` list contains its own `id`. Authors
should also assign a distinct auditor for every builder; the included official
pack pairs each specialist builder with its corresponding auditor, while its
auditors are reviewed by the principal engineering auditor in the orchestrator
policy.

## Validator behavior and diagnostics

`engineer pack validate` loads `pack.yaml`, validates the manifest and listed
descriptors against `schemas/pack.schema.json`, and canonicalizes filesystem
paths. A malformed manifest stops validation before descriptor loading.
Descriptors are processed in manifest order. An unreadable or malformed
descriptor stops loading at that point; schema-invalid descriptors can be
reported while processing continues. Semantic diagnostics such as
`SELF_REVIEW` and `DUPLICATE_AGENT` are collected only for descriptors that
were successfully read, parsed, and schema-validated before or during that
semantic phase. The command makes no model calls and needs no network access.

These are all current diagnostic and resolution codes:

| Code | Produced by | Meaning |
| --- | --- | --- |
| `SCHEMA_INVALID` | pack validator | Manifest or descriptor YAML cannot be read or does not satisfy the schema. |
| `SELF_REVIEW` | pack validator | An agent lists itself in `reviewed_by`. |
| `DUPLICATE_AGENT` | pack validator | Two descriptors have the same agent ID. |
| `PATH_ESCAPE` | pack validator and resolver | A manifest, descriptor, or registry path is absolute, traverses outside its root, or resolves outside it. |
| `MISSING_DEPENDENCY` | resolver | A dependency is absent from the registry or does not match its registry key. |
| `VERSION_MISMATCH` | resolver | Selected dependency roots or versions conflict, or a dependency is outside its requested range. |
| `CYCLE` | resolver | Pack dependencies form a cycle. |
| `USAGE` | CLI JSON error | The command shape is unsupported or incomplete. |

CLI exit codes are `0` for success, `2` for usage errors, `3` for pack
validation errors, and `4` when `engineer doctor` finds either an unsupported
Node environment or an unreadable working directory. Resolver codes are
returned by the core API, not by the current `pack validate` command. `doctor`
reports named checks rather than a separate diagnostic code.

## Dependencies and lock behavior

The core resolver accepts local pack roots and a local registry, resolves
dependencies before dependents, sorts dependency IDs for deterministic output,
and returns an in-memory lock:

```json
{
  "format": 1,
  "packs": [
    { "id": "official.engineering-team", "version": "0.1.0", "source": "local" }
  ]
}
```

This result is only a deterministic in-memory summary of each resolved pack's
ID, version, and `local` source. The current foundation does not write or read
a lockfile, does not content-address packs, and the summary is not sufficient
to reproduce an installation. The CLI does not yet resolve a registry.

## Contributor checks

Run these checks before submitting a pack or validator change:

```bash
npm ci
npm run typecheck
npm test
npm run build
node packages/cli/dist/bin.js pack validate packs/official --json
```
