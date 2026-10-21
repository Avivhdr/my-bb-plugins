# Markdown Reader

A live Markdown file opener for workspace, absolute-host, and thread-storage files. BB supplies the source identity, chooses the opener, and owns the file tab. The plugin reads through the public SDK and shows read-only Preview and exact Raw views.

## Registered behavior

- One file opener for `md` and `markdown`.
- Two validated RPC methods: `read_document` reads text; `resolve_destinations` resolves safe links and obtains confined image-preview leases.
- No chat, diff, Git-snapshot, or source-code renderer replacement.
- No theme, content script, settings, CLI command, watcher, or preference mutation.

## Module boundaries

`source.ts` exposes `SourceReader.read`, `SourceReader.destinations`, and a narrow `SourceAdapter`. It owns target validation, all three source identities, host/root confinement, text limits, and snapshots with hash and document-directory data. `server.ts` connects the adapter to the public SDK and registers both wire schemas.

`destinations.ts` resolves destination policy against that loaded source. `destination-types.ts` defines the wire results. `destination-view.tsx` owns source-bound batch resolution, image expiry/cleanup, native FileLink and UrlLink rendering, and readable failures. Unsafe lexical destinations stay inert. Native file links retain BB's ordinary permissions, not an extra plugin symlink guarantee.

`reader.tsx` accepts a target, one read operation, BB's bound Original component, and optional line-range props. It owns load state, explicit refresh, view choice, outline visibility, filename/path identity, and failed/unsupported fallback. Retained snapshots are unverified during refresh and stale on failure. Only a source identity change remounts it. Superseded reads, fallback, and unmount discard late results. Line-only props do not read or replace the document model.

`document.tsx` builds one model with react-markdown's synchronous parser/renderer. A rehype transform records headings and namespaced targets on that exact rendered tree. GitHub-style fragments map to local targets. `outline.tsx` observes reader width and owns the aside/disclosure. `source-lines.ts` retains exact source-line slices; `raw.tsx` highlights and reveals requested real lines. `navigation.ts` scrolls/focuses only this reader. `code.ts` applies the single 20 KiB explicit-language policy on this same tree. It accepts only passive text/span tokens and verifies complete rendered text before using them. Unknown or failed highlighting stays plain.

`app.tsx` registers the live-file opener. `app.css` uses reader-scoped host tokens and container width. Tests use these public source and rendered-reader interfaces, not private path or parser helpers.

## Operating constraints

UTF-8 text up to 1 MiB is supported across all three sources. Unsupported content offers BB preview. The SDK may transfer an oversized file to the server before rejection; the reader never receives it. Absolute-host reads are confined to the containing directory. Workspace and storage reads use their resolved source root. Supported fenced languages use a small bundled highlighter at or below 20 KiB. Unknown, unlabelled, oversized, or failed code stays plain. Code never reformats source. Raw HTML is inactive. No source writes or automatic watching occur. See [README.md](README.md) for selection, installation, checks, and deferred behavior.
