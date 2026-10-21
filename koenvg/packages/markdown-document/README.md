# Markdown document interface

This private build-time package provides the document presentation used by Tasks and Markdown Reader. It owns parsing, headings, Raw, bounded highlighting, outline and scoped CSS. Consumers own source loading, authorization, snapshot lifetime, controls and writes. Either plugin works without the other installed.

## Public interface

```tsx
import { useId, useMemo } from "react";
import {
  createDocumentModel,
  MarkdownDocument,
  denyDestinations,
} from "@bb-plugins/markdown-document";
import "@bb-plugins/markdown-document/style.css";

const namespace = useId();
const model = useMemo(() => createDocumentModel(snapshot.text, namespace), [snapshot, namespace]);
return <MarkdownDocument model={model} view={view} destinations={denyDestinations} />;
```

Create one model for an immutable loaded snapshot and use a mount-unique namespace. Reuse the model across Preview/Raw switches and line requests. The factory derives headings, fragments, destination requests and exact source lines from the supplied string. Model fields are read-only presentation data, never source authority.
The factory scopes model IDs even when namespace labels repeat. Canonical heading fragments follow BBP-55's normalized visible labels and collision suffixes. Legacy Reader fragments remain aliases. Generated footnotes do not capture an explicit heading with the same fragment.

`MarkdownDocument` accepts `model`, controlled `view`, optional `destinations`, `outline`, `lineRange`, `annotateSourceLines` and `navigation`. `view` is `preview` or `raw`. The root exports these public types and the source-neutral heading, request, grant and link-reference types. Internal subpaths are not exported.

Preview hides leading YAML frontmatter without changing heading source positions. It renders GFM, disabled task checkboxes and passive syntax tokens. Known fences up to 20 KiB receive highlighting. Unknown languages, larger fences, token-budget failures and tokenizer failures remain plain code. Raw preserves the complete source, including BOM, frontmatter, mixed line endings and whitespace. HTML and MDX do not execute.
Tokenizer output is limited to 16,384 passive nodes and depth 64. These existing BBP-56 safeguards remain unchanged in the shared implementation.

`outline` defaults to false. When enabled and local navigation is permitted, it uses document-local heading and footnote targets and adapts to the supplied container. `lineRange` has inclusive one-based `startLineNumber` and `endLineNumber` bounds. Valid integers are ordered and clamped. Raw reveals repeated request objects even when their values match. Invalid ranges do not highlight content.

Default Raw uses one text node, including newline-dense files up to the consumer's 1 MiB limit. A valid range request or explicit `annotateSourceLines` enables at most 132 contiguous source-line groups. `data-source-line` and `data-source-line-end` identify each group's inclusive bounds. Requested highlights split at both range edges, and the first requested line remains an exact focus target. The trailing empty source line keeps its own target. Reader opts in; Tasks does not. Both paths preserve the complete source without virtualization or truncation.

The bounded row-layout guarantee applies to LF and CRLF files. Lone CR remains unchanged in the source string but need not create a visual row inside a group. A range request can split that group into more visible rows. Clearing a range retains focus within Raw when its focused target is removed, without reclaiming focus from another control.

Unannotated Raw reads the stored string without a source-line index. The line array is frozen and cached only when annotation or a valid range needs it. Blank ASCII Markdown avoids a parser pass; non-ASCII paragraph whitespace still uses the parser.

An optional `navigation` supplies a container ref and `reveal(target)` callback. Markdown Reader uses its toolbar-aware panel reveal. Without that callback, the presenter scrolls only its own root when that root is a scroller, and focuses the target without scrolling ancestors. `.mr-prose` and `.mr-raw` identify selectable content. Reader derives Raw selection references from exact text offsets rather than element counts.

## Destination policies

- Missing policy or `denyDestinations` denies all destinations, including local fragments. Labels and image alt text remain readable.
- `localDestinations` enables only targets in the current model.
- A `delegated` policy resolves checked requests to rejected, fragment, bound-link or image grants. Consumers bind SDK links outside this package. Link/image grant mismatches remain inert.
- An `attachment` policy may explicitly enable `localFragments`, `openExternal` and `remoteImages`. It cannot supply a filesystem binding.
- A `bound-source` policy requires an explicit root, host, document path and source activation callback. The shared lexical check proposes confined paths only. The consumer must verify current source authority, physical confinement and opener preferences before activation.

The package rejects malformed encodings, active schemes, credentials, encoded separators/traversal and unsupported absolute paths before consumer dispatch. It bounds collected requests to 128, URLs to 4096 characters and images to 32. It never derives a filesystem root, host or attachment relationship.

Attachment remote images use the preserved BBP-55 loader: CORS with credentials omitted, no referrer, redirects rejected, raster MIME validation, 4 MiB per image, 16 MiB retained per document, four concurrent requests and 32 total requests. Raw, replacement, permission revocation and unmount cancel owned requests and release blob URLs. Denied or failed images retain readable labels.
Image grants distinguish `remote` from `source`. Remote grants must match the requested HTTP(S) URL and cannot target the current BB origin. They use anonymous CORS and no referrer, so cross-origin credentials are omitted. A remote host must permit CORS; otherwise readable alt/error text remains. Source-image URLs are explicit consumer-issued local capabilities, not document-provided BB endpoints. The reader validates its opaque image route and keeps host/root confinement outside this package.

Tasks explicitly enables document-local fragments, BB-preference external opening and bounded remote raster images, preserving merged BBP-55. Relative filesystem links remain inert because attachments have no binding. Markdown Reader supplies only currently verified delegated grants and falls back to local-only while loading or stale. Refresh and fallback revoke source-backed links and images without discarding readable stale text.

## Enlarge images

Click a loaded image, or focus its **Enlarge image** button and press Enter or Space, to open a viewport-sized preview. **Close**, Escape or a primary click on the backdrop closes only the image preview. The attachment or reader stays open. Loading, denied and failed images cannot open a preview.

Images keep their intrinsic size up to the available viewport width, without upscaling small images. Tall images scroll vertically inside the preview instead of shrinking to its height. The Close toolbar stays visible while scrolling.

Image-bearing Markdown links show their original content followed by a separate **Open linked destination** link. The image opens the preview; the separate link follows the original destination under the existing policy. Text-only links are unchanged.

The preview borrows the approved inline source and request mode. It does not resolve another grant, allocate a preview capability or fetch another remote blob. A delegated direct URL can cause another authorized image GET. Closing the preview does not release the inline image. Raw, model, policy-object or source replacement and unmount invalidate the preview. Even an equivalent policy-object replacement closes it without resetting the loader budget.

## Build and verify

Use Bun 1.4.3 and Node 24.15 or newer within Node 24:

```sh
bun install --frozen-lockfile
bun run build
bun run test --maxWorkers=1
bun run typecheck
```

The root and CSS exports intentionally resolve to source ESM/TSX and CSS. BB compiles them into each consumer bundle. This preserves clean plugin builds because BB has no shared-package pre-build hook. `bun run build` separately verifies emitted ESM, declarations and CSS under `dist`; it does not change package exports. React and React DOM are consumer-owned peers, not a bundled runtime.

For fresh independent consumer setup and production-bundle checks, run [the BBP-57 clean verifier](../../verification/BBP-57/clean-build.mjs) from the repository root. [The BBP-57 report](../../verification/BBP-57/report.md) separates fixture evidence, build evidence and required installed acceptance.
