# Pinned Prompt

Keeps your message pinned at the top of the chat while you read a long reply, the way Claude and Grok do. Click the bar to jump back to the full message.

The bar shows your newest message above the view, so at the bottom of a chat it's your last message. Scroll up past that message and the bar switches to the one before it. It hides while any of your messages is on screen.

## How it works

bb renders only the rows near the viewport, each absolutely positioned, so CSS `position: sticky` can't pin a message. This plugin draws its own bar instead:

- `server.ts` reads the thread's timeline (the latest 100 turns) and returns every row id, plus each prompt with its text and turn ids.
- `app.tsx` registers an app overlay. It finds each open chat, measures the rendered rows, and works out which prompt the top row belongs to (`model.ts`). Rows the page merges, like work summaries, are matched by the turn id in their row id.
- Clicking the bar scrolls toward the prompt by estimate until bb renders it, then lines it up 12px below the top (`dom.ts`).

Each split pane gets its own bar.

## Limits

- `dom.ts` relies on bb's chat markup (`data-timeline-row-list`, `data-timeline-row-id`), which isn't part of the plugin SDK. A bb release can change it. When that happens the bar stops showing and nothing else breaks.
- For turns older than the latest 100, the bar only shows a prompt the page has rendered.

## Develop

```sh
npm install
npm test
npm run typecheck
bb plugin build && bb plugin reload pinned-prompt
```
