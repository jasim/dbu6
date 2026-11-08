# %%SAPPORTA:SLUG%%

[dbu6](https://dbu6.com/docs/) based personal finance system.

## Start

To start dbu6, run this command in this folder:

```sh
npx dbu6 start
```

The app runs at <http://localhost:2345>.

## Update your books

To update your books with your coding agent, open the agent in this folder and
ask it to do your books. You can also upload statements and review the entries
on the app's screens, without an agent.

## Back up `data/`

Your ledger is `data/sqlite.db`. Git ignores the `data/` folder, so a copy of
this repository on a remote does not include your books. Keep a copy of `data/`
off this machine. For backup steps, see
[Install dbu6](https://dbu6.com/docs/install/).

## Upgrade

To upgrade dbu6, back up `data/` and run these commands:

```sh
npx dbu6 upgrade
npx dbu6 check
```

## More

The documentation is at <https://dbu6.com/docs/>. `AGENTS.md` has instructions
for coding agents.
