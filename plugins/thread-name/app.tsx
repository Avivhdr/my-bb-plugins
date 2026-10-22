import { useEffect, useRef, useState } from "react";
import { definePluginApp, useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";

/** Names typed so far, per new-thread draft, so leaving the page keeps them. */
const names = new Map<string, string>();

function NameField() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const [name, setName] = useState(() => names.get(composer.key) ?? "");
  const projectId = composer.scope.kind === "new-thread" ? composer.scope.projectId : null;
  const project = useRef(projectId);
  useEffect(() => {
    project.current = projectId;
  }, [projectId]);

  useEffect(
    () =>
      composer.onSubmitted(() => {
        const title = names.get(composer.key)?.trim() ?? "";
        names.delete(composer.key);
        setName("");
        if (title === "" || project.current === null) return;
        rpc
          .call("name", { projectId: project.current, title })
          .catch(() => toast.error(`Could not name the thread "${title}".`));
      }),
    [composer, rpc],
  );

  const change = (value: string) => {
    setName(value);
    if (value === "") names.delete(composer.key);
    else names.set(composer.key, value);
  };

  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">Name</span>
      <input
        value={name}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          composer.focus();
        }}
        maxLength={200}
        placeholder="Optional. The sidebar shows this instead of the prompt."
        aria-label="Thread name"
        className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </label>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "thread-name",
    scopes: ["new-thread"],
    banners: [{ id: "name", component: NameField }],
  });
});
