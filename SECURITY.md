# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/daniel-daga/daedalus-dialog-suite/security/advisories/new)
(the repository's Security tab → "Report a vulnerability").

Include what is affected, how to reproduce it and what an attacker gains. You
will get an answer within a week. Once a fix ships, the advisory is published
and you are credited unless you prefer not to be.

## Scope

Dandelion is a desktop app that opens local mod files and updates itself from
this repository's releases. Of particular interest:

- anything that lets a crafted `.d`, `.zen` or project file execute code or
  read or write outside the opened project,
- the update path (`update-meta.json`, the installer download and its SHA-256
  check),
- the Electron boundary (IPC validation, the content security policy).

The design behind these is in
[`docs/architecture/security-model.md`](docs/architecture/security-model.md).

## Supported versions

Only the latest build on the
[download page](https://daniel-daga.github.io/daedalus-dialog-suite/) is
supported. The installer is not code-signed yet.
