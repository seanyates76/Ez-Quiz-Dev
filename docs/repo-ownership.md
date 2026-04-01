# Repository Ownership Map

This document defines the intended relationship between **Ez-Quiz-Dev** and **Ez-Quiz-App**.

The goal is simple:
- one repo leads
- one repo presents
- drift stays intentional
- duplicated maintenance stays rare

## Repo roles

### Ez-Quiz-Dev
**Role:** development source repo

This is the canonical working repository.
It owns:
- implementation work
- architecture changes
- dependency updates
- tests and CI for development
- internal documentation
- maintainer workflow and branch strategy
- mirror/export logic

### Ez-Quiz-App
**Role:** production mirror

This is the public-facing production repository.
It exists to:
- present the project publicly
- support production-facing security signals
- receive filtered updates from the development repo
- hold repo-specific public settings and protections

It should not become a second independent source repo.

## Ownership rules by category

## 1. Application code
**Owner:** Ez-Quiz-Dev
**Flows downstream:** Yes

Includes:
- `public/`
- `netlify/functions/`
- runtime config used by the app
- bug fixes and feature work

Rule:
> Product behavior is defined upstream in the development repo and mirrored into the production repo.

## 2. Dependencies and lockfile baseline
**Owner:** Ez-Quiz-Dev
**Flows downstream:** Yes

Includes:
- `package.json`
- `package-lock.json`

Rule:
> Dependency modernization happens upstream. The production mirror should not maintain a separate dependency story unless there is a very specific production-only reason.

## 3. Internal docs and working notes
**Owner:** Ez-Quiz-Dev
**Flows downstream:** No

Includes:
- maintainer notes
- branch salvage notes
- `docs/dev-notes/`
- internal process docs
- local scripts and working artifacts

Rule:
> Internal context belongs in the development repo only.

## 4. Public-facing project docs
**Owner:** Ez-Quiz-Dev by default
**Flows downstream:** Usually yes

Includes:
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `LICENSE.txt`
- `CHANGELOG.md`

Rule:
> Project-level docs should usually be authored upstream and mirrored down.

Current explicit exception:
- `README.md` is intentionally allowed to diverge in `Ez-Quiz-App` so the production mirror can speak with a public/product-facing voice instead of repeating development-repo framing.

Exception:
If the production repo needs a small public-only difference, keep that difference explicit and minimal.

## 5. GitHub workflows
**Owner:** split by workflow class
**Flows downstream:** selective, not automatic by default

This is the blurriest category and must stay intentional.

### 5A. Dev-only workflows
**Owner:** Ez-Quiz-Dev only
**Do not flow downstream**

Examples:
- mirror publishing workflows
- private-repo maintenance workflows
- internal branch/process automation
- workflows tied to dev-only review or branch strategy

### 5B. Shared security/quality workflows
**Owner:** preferred source = Ez-Quiz-Dev
**May exist in both repos**

Examples:
- CodeQL
- OpenSSF Scorecard
- other quality/security automation that should exist publicly and privately

Rule:
> The workflow design should originate upstream when practical, but public-repo copies may exist if mirror filtering excludes `.github/workflows/`.

Long-term preference:
- maintain a small, intentional set of shared workflow templates upstream
- either sync them selectively later or manually keep them aligned with clear ownership

### 5C. Production-only workflows
**Owner:** Ez-Quiz-App

Examples:
- public-repo-only deployment or scanning workflows
- workflows that only make sense because the repo is public

Rule:
> If a workflow exists only because the production mirror is public, it can live there.

## 6. Repo settings and security toggles
**Owner:** per repo
**Does not sync**

Includes:
- visibility
- branch protection
- code scanning enablement
- secret scanning settings
- Actions secrets
- environment rules

Rule:
> Repository settings are inherently local to each repo and must be managed separately.

## 7. Branches, PRs, and issue tracking
### Ez-Quiz-Dev
Primary working backlog and implementation discussion should live here.

### Ez-Quiz-App
Should stay relatively clean.
Use it for:
- public-facing production PRs
- deploy-facing updates
- minimal repo-specific maintenance

Rule:
> Do not let the production mirror become a second active workshop unless there is a concrete reason.

## Mirror policy

The production repo is a **filtered mirror**, not a full clone.

That means it should intentionally exclude things like:
- internal notes
- local tooling churn
- dev-only scripts
- most internal test/process artifacts

If a category is valuable publicly, it should either:
1. flow cleanly through the mirror, or
2. be maintained in the production repo for a specific reason

Not both by accident.

## Practical operating model

### Default rule
If unsure, ask:
> Is this part of the product, or part of the workshop?

If it is part of the product:
- own it in **Ez-Quiz-Dev**
- mirror it to **Ez-Quiz-App** when appropriate

If it is part of the workshop:
- keep it in **Ez-Quiz-Dev** only

## Current intended split

### Upstream in Ez-Quiz-Dev
- source code
- dependency management
- architecture
- tests
- internal docs
- maintainer guidance
- mirror/export logic

### Downstream in Ez-Quiz-App
- public presentation
- production-facing security scanning
- repo-specific public settings
- minimal public-only workflow/config differences

## Anti-patterns to avoid

Avoid these:
- fixing the same dependency problem in both repos independently
- letting public-repo docs drift from upstream for no reason
- maintaining duplicate workflow logic with no defined owner
- using branches to store long-term documentation
- letting stale PRs accumulate in the production mirror

## Preferred long-term direction

The healthiest model is:
- **Ez-Quiz-Dev** remains the source repo
- **Ez-Quiz-App** remains the polished production mirror
- shared security workflows are either selectively synced later or explicitly maintained with a clear ownership note

If this document and reality diverge, update the document.
