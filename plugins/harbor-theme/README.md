# Harbor Theme

The default bb palette with a soft blue gradient on the desktop window frame:
the top bar, the left nav rail, and the thin right and bottom edges. The
sidebar list and the main content keep the normal white and gray, but the blue
frame makes bb easy to pick out among other windows in Mission Control.

bb has no design token for the frame, so the stylesheet targets the app shell
elements (`app-layout-root` and `app-nav-rail` test ids). A bb release that
renames them would drop the color back to gray.

```sh
bb plugin install ./plugins/harbor-theme
bb theme set plugin:harbor-theme:harbor
```

Or pick Harbor under Settings → Appearance.
