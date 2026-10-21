# Reading a technical report with a long document title in a compact or split panel

This report uses the source values as written. A centered reading column and clear section spacing leave room for prose without changing BB's surrounding controls. `fulfilled` and `inconclusive` are ordinary text, not status badges.

## Reading the result

The selected workspace and its host supplied one immutable snapshot. Preview and Raw show the same content. [Go to the final section](#final-section) or read the local note[^1].

| Item | Observation |
| --- | --- |
| Source | The selected workspace and its host |
| Content | A table that stays within the reading column |
| Value | `inconclusive`, exactly as written |

> Keep technical reports readable. Do not infer dates, statuses, or extra metadata from their content.

- [x] Read-only task items
- [ ] No edits or automatic watching

## Code as written

The first JSON fence is compact. The second already has line breaks. Neither is parsed or reformatted by the highlighter.

```json
{"compact":true,"value":"<script>not active</script>"}
```

```json
{
  "query": "workspace Markdown",
  "locationQuery": "",
  "constraints": ["read-only", "explicit host"]
}
```

```js
// A comment stays readable in the active host theme.
const value = true;
```

### Wide content stays local

```text
This is one long source line that must scroll locally, rather than widen the panel: 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789
```

| Document | Host identity | Workspace | Encoding | Reader limit | Transport | View | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reports/workspace.md` | Selected host | Selected environment | UTF-8 | 1 MiB | SDK | Read-only | Unchanged |

## Image proportions

![Fixture diagram](https://fixture.invalid/diagram.png)

### Level three

Section headings keep their original levels.

#### Level four

A smaller heading still has room above and below it.

##### Level five

The outline includes deep headings without making the panel wider.

###### Level six with a deliberately long heading name that can wrap inside the outline

The visible text remains source text.

## Final section

Local heading and footnote navigation must still work after a theme or width change. **Strong text**, *emphasis*, ~~deleted text~~, and `inline code` remain ordinary Markdown.

[^1]: A reader-local note with a return link.
