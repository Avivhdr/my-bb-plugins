import reviewThreads from "./fixtures/pr-25259-review-threads.json";

const ASSET_ID = "1bc7aa19-b5b1-40ea-95c8-ab8be878d7ba";
export const ATTACHMENT_URL = `https://github.com/user-attachments/assets/${ASSET_ID}`;
export const SIGNED_ATTACHMENT_URL = `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.png?jwt=x`;

export const ATTACHMENT_BODY = `![shot](${ATTACHMENT_URL})`;
export const ATTACHMENT_HTML = `<p><img src="${SIGNED_ATTACHMENT_URL}" alt="shot"></p>`;

export function reviewThreadsWithAttachment() {
  const page = structuredClone(reviewThreads);
  for (const thread of page.data.repository.pullRequest.reviewThreads.nodes)
    for (const comment of thread.comments.nodes) {
      comment.body = ATTACHMENT_BODY;
      comment.bodyHTML = ATTACHMENT_HTML;
    }
  return page;
}
