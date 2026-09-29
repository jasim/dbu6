---
"@dbu6/app": minor
---

A project's settings file is `.env.development`, the name Sapporta uses, so
every `sapporta` command finds the app's port without being told. `.env` is no
longer read: every command stops until it is renamed by hand. `.env.agent`
holds only the agent's token, which dbu6's `sapporta` adds to the CLI's
environment, and the agent prompts name the app's own address.
