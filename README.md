# my-bb-plugins

bb plugins, one directory each under `plugins/`.

| Plugin | What it does |
| --- | --- |
| [issues](plugins/issues) | A per-project Kanban board over GitHub Issues |

Install one from a checkout:

```sh
bb plugin install ./plugins/issues
```

Or from git once this repository is pushed:

```sh
bb plugin install git:<repo-url>@main --plugin issues
```
