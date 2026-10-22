# Archive Button

Adds a light red Archive button to the thread header, so you can archive the thread you're reading without finding it in the sidebar.

The button runs bb's own Archive action. You get the same confirmation when the thread has child threads, and the same Undo toast. On a phone-width window it shrinks to the icon.

## Develop

```sh
npm install
npm run typecheck
bb plugin build && bb plugin reload archive-button
```
