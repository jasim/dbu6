---
"@dbu6/app": minor
---

dbu6 no longer uses the Nuabase gateway: categorization and setup's chart of
accounts run only on the coding agent chosen in Settings, so what dbu6 sends an
LLM reaches that agent's own provider and nothing else. `LLM_ENGINE` and
`NUABASE_API_KEY` are no longer read; remove them from the server's
environment. A server with no coding agent, such as the Docker image, no
longer categorizes; its imports go through uncategorized, as they do whenever
no agent is installed.
