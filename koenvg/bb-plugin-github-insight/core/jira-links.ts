const JIRA_BROWSE = "https://engineering-collibra.atlassian.net/browse/";

/**
 * One pass over a line of markdown. The first alternatives match text that must stay as written
 * (inline code, links, autolinks and HTML tags, bare URLs); the last one is a Jira key.
 */
const TOKEN =
  /(`+)[\s\S]*?\1|!?\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])|<[^>\s]+>|https?:\/\/\S+|(?<![\w./-])((?:DEV|PUX)-\d+)(?!\w)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

function linkLine(line: string): string {
  return line.replace(TOKEN, (match, _ticks, key: string | undefined) =>
    key === undefined ? match : `[${key}](${JIRA_BROWSE}${key})`,
  );
}

/** Turns each bare `DEV-123` or `PUX-123` into a link to its Jira ticket. Code blocks stay as they are. */
export function linkJiraKeys(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence !== null) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        return line;
      }
      if (marker !== undefined) {
        fence = marker;
        return line;
      }
      return linkLine(line);
    })
    .join("\n");
}
