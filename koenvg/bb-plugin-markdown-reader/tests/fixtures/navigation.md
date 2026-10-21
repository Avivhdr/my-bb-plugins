---
title: Actual source metadata, not a generated label
---

# Navigation fixture

[Second Japanese heading](#%E6%97%A5%E6%9C%AC%E8%AA%9E-code-link-1). [File stays inert](next.md). ![Image stays inert](diagram.png).

## **日本語** `code` [link](next.md)

The first heading has inline formatting. The outline uses its visible text. The second heading has the same visible text and a distinct conventional fragment.

### Actual source and wrapped rows

Raw preserves frontmatter, Unicode, CRLF, trailing spaces, and final newlines. A wrapped row is not a new source line.

```text
  WRAPPED_SOURCE_LINE 日本語 é 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789  
```

## A section before the repeated heading

This paragraph makes local navigation visible in a short reader panel. The toolbar remains at the top while the document scrolls inside its own panel.

One reader must not find another reader's heading IDs. Both readers can show the same source and still have independent focus and scroll positions.

The user can hide the outline. A wide document then returns to the centered prose column. A compact document removes the inline disclosure.

The document has no active file links or images. A known heading fragment stays within this reader. Missing or malformed fragments do nothing.

### A lower-level section

The source uses ordinary headings, not a report-specific structure. The outline does not add dates, results, or document metadata.

Repeated source-line requests are separate navigation intents. Their numeric values can be the same. The source read and loaded model stay in place.

A line range selects Raw. The user can then return to Preview. Only a new request selects Raw again.

### More reading space

This is still the same file. Heading navigation does not call file-opening APIs, make network requests, or write the document.

A constrained panel uses its own measured width. A large desktop window does not make a narrow reader use an aside.

The source-line range is inclusive and one-based. Reversed bounds are put in order, and bounds outside the source are clamped to existing lines.

Malformed bounds do not highlight arbitrary lines. An empty file has no source text to highlight. Final newlines remain part of the exact Raw text.

## 日本語 code link

This is the second repeated heading. Navigation to the suffix fragment must focus this heading, not the earlier one or another reader's heading.

### End of the navigation fixture

LAST_SOURCE_LINE keeps its trailing spaces.  
