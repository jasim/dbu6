# Upgrade notes

What a project's coding agent needs to know when moving to a version of dbu6.
`dbu6 upgrade` prints them: after installing the new version, it prints the
notes of every version after the one the project was on, up to the new one,
oldest first, before it migrates and runs `dbu6 check`.

## The convention

- One file per release that has something to say: `<version>.md`, named by
  the exact version (`1.4.0.md`, `2.0.0-beta.1.md`). A release with nothing
  to say has no file, and most releases have nothing to say: `dbu6 check`
  names what broke, and `user-config/`, parsers and reports carry forward
  without edits.
- Written for an agent, in the second person, with the fix first: what
  changed in the promised surface (`dbu6/server`, `dbu6/frontend`, the
  `user-config/` formats, the parser contract, the schema), what `check` will
  report, and what to do about it. Not a changelog; features and fixes that
  need nothing from the project are not mentioned.
- The file is added in the same commit as the change it describes, so it is
  in the tarball of the version it names. Only files named by an exact
  version are printed; this README is not.

This is the first version of the package, so there is no note yet.
