---
name: release
description: Prepare or publish an explicitly authorized Semantic Versioning release of @tknf/stimulus-ui. Use for version bumps, release commits, annotated tags, and the tag-triggered npm release workflow.
---

# Release `@tknf/stimulus-ui`

The primary session owns release preparation and publication. Follow the
`tknf/oven` release procedure, using this repository's validation commands.
Preparing a release does not authorize staging, committing, pushing, or tagging.
Require explicit authorization for those operations and the exact version before
publication. Use a read-only reviewer only when required by `AGENTS.md`.

## Choose the version

- `major`: incompatible public API, default, behavior, or runtime support change.
- `minor`: backward-compatible public API or component addition, including a deprecation.
- `patch`: backward-compatible bug or security fix.
- Documentation-only and repository-only changes do not bump the package version.

Ask the user when more than one SemVer interpretation is reasonable. Verify that
the proposed version and tag are not already published. A failed registry lookup
is not evidence that a version is available.

## Prepare

1. Read `AGENTS.md`, `package.json`, and `.github/workflows/release.yml`. Start
   from a clean release branch based on current `origin/main`; preserve unrelated
   changes and never include them in the release.
2. Review the changes being released. If a changelog exists, finalize its
   `Unreleased` entries for the chosen version; do not create a changelog solely
   to run this workflow.
3. Run `vp pm version X.Y.Z -- --no-git-tag-version`. Inspect the manifest and
   package-manager changes. This prepares the version without creating a tag.
4. Run `vp run check`, `vp run check:contracts`,
   `vp run check:workflow-safety`, `vp run check:release-readiness`,
   `vp run test:release-readiness`, `vp run test:log`, `vp run build`,
   `vp run check:package`, `vp run check:api-docs`, and `vp run test:api-docs`.
   Reuse successful checks only when their inputs are unchanged. Record the
   Chromium, Firefox, and WebKit results and any compatibility observations.
   A failed check or unverified blocking manual check prevents publication.
5. Inspect package name, version, files, exports, and the release diff. Confirm
   that the repository has the `NPM_TOKEN` secret by name only; never read or copy
   credentials. Stage explicit paths only when authorized.

## Publish

1. Confirm authorization for `X.Y.Z` and that the reviewed diff still matches the
   verified content. Commit using the Japanese commit conventions in `AGENTS.md`.
2. Integrate the release commit into `main` through the normal authorized PR
   workflow. Confirm that the commit is reachable from current `origin/main`
   before tagging; do not infer permission to merge from permission to prepare.
3. Create the annotated tag `vX.Y.Z` on that exact commit. Verify remote state,
   then push the tag without force. The tag triggers
   `.github/workflows/release.yml`, which publishes with `NPM_TOKEN` and provenance.
4. Verify both the GitHub Actions result and the npm version before reporting
   success. If the workflow fails, inspect its failed step and registry state
   before considering another attempt; do not fall back to a manual publish.

Never move or reuse a tag, run a duplicate manual publish, expose registry
credentials, or publish a prerelease until the workflow supports its intended npm
dist-tag. Missing credentials or an unapproved operation are blockers to report,
not permission to select a different authentication or publication workflow.
