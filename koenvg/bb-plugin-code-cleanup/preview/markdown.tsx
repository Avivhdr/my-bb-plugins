import ReactMarkdown from "react-markdown";

/** Fixture substitute only. Live Settings use the public host Markdown component. */
export function FixtureMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown skipHtml components={{ img: ({ alt }) => <span>[Image: {alt ?? ""}]</span> }}>
      {content}
    </ReactMarkdown>
  );
}
