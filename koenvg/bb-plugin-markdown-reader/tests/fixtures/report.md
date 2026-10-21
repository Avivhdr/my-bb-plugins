# Reading a workspace document

This report contains ordinary Markdown. Values such as `fulfilled` and `inconclusive` stay as written. The reader does not add a date, result badge, or other metadata.

## What happened

The document was read from the selected workspace. Preview and Raw use the same text. The layout puts more space above a section heading than below it.

| Item | Observation |
| --- | --- |
| Source | The selected workspace and its host |
| Result | `inconclusive`, exactly as written |
| Content | A quiet table with local scrolling |

## What the visitor asked for

> Keep the document easy to read in a split panel. Do not change its values or turn report text into special controls.

- [x] Read-only task items
- [ ] Safe destination activation comes later

A [sibling document](next.md) stays inert in this first reader. An image keeps its alt text without making a network request: ![A local diagram](diagram.png).

## What the agent searched

The code below keeps its spaces and line breaks. There is no language inference or JSON formatting.

```json
{
  "query": "workspace Markdown",
  "locationQuery": "",
  "constraints": ["read-only", "explicit host"]
}
```

### A wide code line

```text
This is one long source line that must scroll inside the code block rather than widen the reading panel: 0123456789 0123456789 0123456789 0123456789 0123456789
```

### A wide table

| Document | Host identity | Workspace identity | Encoding | Limit | Reader behavior |
| --- | --- | --- | --- | --- | --- |
| `reports/workspace.md` | Selected host | Selected environment | UTF-8 | 1 MiB | Read-only preview |

## Why

A centered reading column leaves room around the document without copying BB's tabs. **Strong text**, *emphasis*, ~~deleted text~~, and `inline code` remain ordinary Markdown.
