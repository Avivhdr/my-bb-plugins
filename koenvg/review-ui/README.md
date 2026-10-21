# review-ui

Review UI parts that more than one plugin in this repo uses: the diff with a gutter **+** and inline cards, the inline comment form, the pending comment card, the "Viewed" checkbox and collapse button, the diff stat, the hunk line helper, and `pinToTop`, which keeps an element at the top of a scroll area while content above it loads.

`ReviewImageDiff` presents independent before/after raster sides through injected async callbacks. It owns visibility, loading/error/retry state and Blob URL cleanup. Plugin loaders own revisions, credentials and byte policy. SVG stays on the text review route.

`ReviewVideoDiff` uses the same injected side-loader shape. It requires an explicit click per side, uses native playback controls without autoplay, and owns cancellation, decode fallback, pause-on-removal and Blob URL cleanup. Plugin host readers enforce the 8 MiB limit before returning bytes.
Rules:

- Only `ui/` code and type-only imports may use this folder. bb rejects a server source import outside the plugin directory when it reloads the plugin (`bb plugin build` does not check this). Server code that two plugins need goes in a copy in each plugin, like `core/patch-identity.ts`.
- Source files import only `react` and `@pierre/diffs`. bb shims both at runtime, so the plugin bundle needs no copy. Tests can also import `vitest` and `@testing-library/react`.
- Do not import `@get-bb/plugin-sdk`. Pass SDK values (code theme, icons) in through props.
- Props and callbacks only. No RPC calls and no plugin state.

A plugin that uses this folder needs:

- `"../review-ui"` in `tsconfig.json` `include`, and `paths` entries that map `react`, `react/*`, `@pierre/diffs`, `@pierre/diffs/react`, `vitest`, and `@testing-library/react` to its own `node_modules`. See `bb-plugin-changes/tsconfig.json`.
- In `vitest.config.ts`: the same packages in `resolve.dedupe`, `server.fs.allow: [".."]`, and `"../review-ui/**/*.test.{ts,tsx}"` in `test.include`.
