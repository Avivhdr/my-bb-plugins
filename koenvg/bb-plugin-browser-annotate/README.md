# Browser Annotate

Mark areas in a BB Browser tab and write a comment for each one. Each comment becomes a pill in the chat composer. When you send the message, the agent gets a cropped screenshot of each marked area, with a numbered black and white box, plus your comment.

This plugin replaces BB's bundled **agent-annotations** plugin.

Build: `bun install --frozen-lockfile && bb plugin build`. Install locally: `bb plugin install .`.

## Turn off the bundled plugin

Both plugins add an Annotate control to the Browser toolbar. Turn off the bundled one:

```sh
bb plugin disable agent-annotations
```

To go back:

```sh
bb plugin disable browser-annotate
bb plugin enable agent-annotations
```

No data moves between the two plugins.

## Use

1. Open a page in a Browser tab of a thread.
2. Click the Annotate control beside the address bar.
3. Point at the page. The element under the cursor is outlined.
   - Click to select that element.
   - Drag to select a free region.
4. Write a comment.
   - **Enter** saves. **Shift+Enter** adds a new line. **Esc** cancels.
5. Repeat for more areas. Press **Esc** or click the control again to stop.
6. Send the message.

| Action                          | Result                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Save a comment                  | A numbered pin shows on the page. A pill such as `1 · button` or `2 · region` is added to the composer. |
| Click a pin                     | Edit the comment, or delete the annotation. The pill label does not change.                             |
| Delete a pill from the composer | The pin hides at once. The annotation is deleted 3 seconds later, unless the pill comes back.           |
| Go to another page and back     | The pins of that page are drawn again. A different query is a different page. The `#hash` is ignored.   |
| Send the message                | The sent annotations and their pins are deleted. A failed send keeps them.                              |

## What the agent gets

For each pill:

- A JPEG of the marked area plus padding: 10% of the viewport on each side, at least 120 CSS px. If that covers more than 60% of the viewport, the full viewport is sent.
- The page URL, the viewport size, the annotation number, and your comment.
- A note that the box and number are an overlay and not part of the page.

The plugin sends no selectors, HTML, CSS, or source locations.

The screenshot is taken when you save the comment, not when you send. Edits to the comment before the send reach the agent.

## Limits

- Desktop app only. Web and remote clients do not show the control.
- Content inside iframes cannot be annotated.
- A pin marks a place on the page, not an element. If the layout changes, the pin stays where it was.
- The plugin uses experimental BB Plugin SDK surfaces (Browser toolbar, page scripts, tab capture, mention images). A BB update can break them.
- Pins follow the scroll of the page window. In an app that scrolls an inner panel, pins do not move with that panel.
- Images are stored in the plugin's data directory. The image of a deleted, unsent annotation is deleted at once. The image of a sent annotation is kept for 1 hour, because BB can read it after the send.

## Checks

```sh
bun run test
bun run typecheck
bb plugin build
```
