# Changesets

A file in this folder records one change that the next release of
`@dbu6/app` must carry, and how far that change moves the version: `patch`,
`minor` or `major`. Write one with `pnpm changeset`, which asks for the bump
and a one-line summary, and commit it with the change it describes.

`pnpm release:version` (`changeset version`) consumes every file here: it
raises `version` in `package.json` by the highest bump among them and adds
their summaries to `CHANGELOG.md`. `@dbu6/create` is not listed in any
changeset, because `scripts/pack.mjs` gives it the app's version when it
packs. DEVELOPMENT.md, "Releasing", describes the whole release.

The changesets tool itself is documented at
https://github.com/changesets/changesets.
