# @dbu6/app

## 0.3.0

### Minor Changes

- 8142471: dbu6 no longer uses the Nuabase gateway: categorization and setup's chart of
  accounts run only on the coding agent chosen in Settings, so what dbu6 sends an
  LLM reaches that agent's own provider and nothing else. `LLM_ENGINE` and
  `NUABASE_API_KEY` are no longer read; remove them from the server's
  environment. A server with no coding agent, such as the Docker image, no
  longer categorizes; its imports go through uncategorized, as they do whenever
  no agent is installed.

## 0.2.1

### Patch Changes

- Expect the changelog among the files package.json ships by path

## 0.2.0

### Minor Changes

- 4456140: A project's settings file is `.env.development`, the name Sapporta uses, so
  every `sapporta` command finds the app's port without being told. `.env` is no
  longer read: every command stops until it is renamed by hand. `.env.agent`
  holds only the agent's token, which dbu6's `sapporta` adds to the CLI's
  environment, and the agent prompts name the app's own address.
