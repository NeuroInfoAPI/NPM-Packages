# Scripts

Run from the repository root with dependencies installed. Requires pnpm, Node/npm,
Bun and Windows PowerShell.

## Releases

### Publishing (GitHub Actions)

Set versions, commit and push, then open **Actions -> Publish npm packages -> Run
workflow** ([publish.yml](../.github/workflows/publish.yml)). Select the branch and
packages. The workflow builds,
typechecks, packs and publishes all selected packages in parallel via npm Trusted
Publishing (OIDC): no npm token and no 2FA prompt, provenance is added automatically.

- Core is always included, since the other packages pin its exact version.
- Identical, already published versions are skipped; changed contents need a version bump.
- Stable releases use `latest`, prereleases their identifier (`beta`, `rc`, etc.) or
  `next` for numeric identifiers.
- Uploads run in parallel without waiting for Core to become readable, so dependents
  may briefly reference a Core version npm is still processing. On failure, rerun.

One-time setup for each of the four npm packages (npmjs.com -> package -> Settings ->
Trusted Publisher -> GitHub Actions): owner `NeuroInfoAPI`, repository `NPM-Packages`,
workflow `publish.yml`, no environment, **Allow npm publish** checked
(dist-tag not needed). The workflow must be on the default branch to
be runnable. Afterwards, "Require two-factor authentication and disallow tokens" can be
enabled in the package settings.

### Deprecating

```powershell
pnpm run deprecatePackage               # Choose package, versions and message
```

Trusted Publishing only covers `npm publish`, so deprecating stays local: it starts an
interactive `npm login` (browser + passkey) into a temporary npmrc, runs
`npm deprecate` (confirm with the passkey again via npm's link) and revokes the
session via `npm logout` afterwards. Targets are `core`, `native`, `node`, `bun`, or
`legacy` (`neuroinfoapi-client`). `-DryRun` makes no registry changes.

## Maintenance

```powershell
pnpm run clean -- -WhatIf              # Preview dist/node_modules removals
pnpm run clean                        # Remove them throughout the repository
pnpm run setVersions                  # Show versions and prompt for a new one
pnpm run setVersions -- -Version 2.7.0 # Set all package versions and Core references
pnpm run update                       # Upgrade external dependencies, including majors
```

After cleaning, run `pnpm install` and `npm run build`.

`setVersions` and `update` synchronize Core references and refresh the lockfile;
both support `-DryRun`. Run build/typecheck after dependency updates.
