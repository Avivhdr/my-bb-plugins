import type { PluginContentScriptRegistration } from "@get-bb/plugin-sdk/app";

// bb exposes no option to hide its PR strip, so these selectors target the
// host DOM of bb 0.44 and may need updating after a bb upgrade.
const STRIP = 'section[aria-label="Thread context before sending"]';
const PR_LINK = 'a[aria-label^="Pull request "]';
const MERGE_GROUP = ':has([aria-label="Choose pull request merge method"])';
const ACTION_GROUP = "[data-promptbox-hide-tiny]";

export const HIDE_HOST_PR_STRIP_CSS = `
${STRIP} > div > ${PR_LINK},
${STRIP} > div > ${MERGE_GROUP} {
  display: none !important;
}
${STRIP}:not(:has(> div > :not(${PR_LINK}):not(${ACTION_GROUP}))) {
  display: none !important;
}
`;

export const hideHostPrStrip: PluginContentScriptRegistration = {
  id: "hide-host-pr-strip",
  mount() {
    const style = document.createElement("style");
    style.textContent = HIDE_HOST_PR_STRIP_CSS;
    document.head.append(style);
    return () => style.remove();
  },
};
