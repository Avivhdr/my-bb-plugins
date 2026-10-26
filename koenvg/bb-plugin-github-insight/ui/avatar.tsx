import { useState } from "react";

/**
 * A GitHub avatar, or the login's first letter when there is no URL or the image fails.
 * `labelled` names it by the login, for places that show the avatar instead of the name.
 */
export function Avatar({
  login,
  url,
  labelled = false,
}: {
  login: string;
  url: string | null;
  labelled?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const label = labelled ? { title: login } : {};
  if (url === null || failed) {
    return (
      <span
        {...label}
        {...(labelled ? { role: "img", "aria-label": login } : { "aria-hidden": true })}
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
      >
        {login.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      {...label}
      src={url}
      alt={labelled ? login : ""}
      className="size-5 shrink-0 rounded-full bg-muted ring-1 ring-border"
      onError={() => setFailed(true)}
    />
  );
}
