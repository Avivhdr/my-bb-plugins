const PENDING = Symbol.for("github-insight.pr-panel-navigation.v1");
const EVENT = "github-insight.pr-panel-navigation.v1";
type Request = { threadId: string; token: symbol; expiresAt: number; opening?: boolean };
type Client = Window & { [PENDING]?: Request };

/** Remember the destination before navigating so a late receiver can handle it. */
export function requestPrPanel(
  threadId: string,
  navigate: () => void,
  target: Window = window,
): void {
  const client = target as Client;
  client[PENDING] = { threadId, token: Symbol(), expiresAt: Date.now() + 30_000 };
  navigate();
  const event = target.document.createEvent("Event");
  event.initEvent(EVENT, false, false);
  target.dispatchEvent(event);
}

/** Cancel badge intent when the user chooses ordinary navigation instead. */
export function cancelPrPanelRequest(target: Window = window): void {
  delete (target as Client)[PENDING];
}

/** Register in the destination plugin; only an accepted open consumes the request. */
export function receivePrPanel(
  threadId: string,
  open: () => boolean,
  target: Window = window,
): () => void {
  const client = target as Client;
  const receive = () => {
    const request = client[PENDING];
    if (request && request.expiresAt <= Date.now()) {
      delete client[PENDING];
      return;
    }
    if (!request || request.threadId !== threadId || request.opening) return;
    request.opening = true;
    try {
      if (open() && client[PENDING]?.token === request.token) delete client[PENDING];
    } catch (error) {
      console.warn("github-insight: unable to open the requested PR panel", error);
    } finally {
      request.opening = false;
    }
  };
  target.addEventListener(EVENT, receive);
  receive();
  return () => target.removeEventListener(EVENT, receive);
}
