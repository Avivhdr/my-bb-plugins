// bb-plugin-issues frontend: the Issues page in the left sidebar.
//
// The page lives at /plugins/issues/board/<projectId>. A plugin page has no project
// of its own, so the route carries it; without one the page falls back to the project
// in view, then the last one used here, then the first project.
import { useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  experimental_copyToClipboard,
  experimental_usePluginId,
  useBbContext,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "./contract";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IssuesView, type IssuesHost } from "./ui/IssuesView";

const PANEL_PATH = "board";

interface ProjectOption {
  id: string;
  name: string;
}

function useProjects(): ProjectOption[] | null {
  const sdk = useSdk();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    sdk.projects.list().then(
      (list) => {
        if (!cancelled) setProjects(list.map((project) => ({ id: project.id, name: project.name })));
      },
      () => {
        if (!cancelled) setProjects([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);
  return projects;
}

function readRemembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function IssuesPage({ subPath }: { subPath: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const context = useBbContext();
  const pluginId = experimental_usePluginId();
  const projects = useProjects();
  const rememberKey = `${pluginId}:lastProjectId`;

  const requested = decodeURIComponent(subPath.split("/")[0] ?? "") || null;

  const projectId = useMemo(() => {
    if (!projects) return null;
    const known = (id: string | null): id is string => !!id && projects.some((p) => p.id === id);
    for (const candidate of [requested, context.projectId, readRemembered(rememberKey), projects[0]?.id ?? null]) {
      if (known(candidate)) return candidate;
    }
    return null;
  }, [projects, requested, context.projectId, rememberKey]);

  // Keep the URL and the remembered project in step with what the page shows, so a
  // reload or a shared link lands on the same board.
  useEffect(() => {
    if (!projectId) return;
    try {
      window.localStorage.setItem(rememberKey, projectId);
    } catch {
      // Private mode or a full quota: the fallback order still finds a project.
    }
    if (projectId !== requested) {
      navigate.toPluginPanel(PANEL_PATH, { subPath: encodeURIComponent(projectId), replace: true });
    }
  }, [projectId, requested, rememberKey, navigate]);

  const host: IssuesHost = useMemo(
    () => ({
      openUrl: (url) => {
        if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
      },
      openThread: (threadId) => navigate.toThread(threadId),
      draftThread: (pid, prompt) => navigate.toCompose({ projectId: pid, initialPrompt: prompt, focusPrompt: true }),
      copyText: (text) => experimental_copyToClipboard({ text }),
    }),
    [navigate],
  );

  const picker =
    projects && projects.length > 0 ? (
      <Select
        value={projectId ?? undefined}
        onValueChange={(next) => navigate.toPluginPanel(PANEL_PATH, { subPath: encodeURIComponent(next) })}
      >
        <SelectTrigger aria-label="Project" className="h-8 w-48 text-sm">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  if (projects !== null && projects.length === 0) {
    return (
      <div role="status" className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Add a project to bb to see its GitHub issues here.
      </div>
    );
  }

  return <IssuesView rpc={rpc} host={host} projectId={projectId} projectPicker={picker} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "issues",
    title: "Issues",
    icon: "Columns2",
    path: PANEL_PATH,
    component: IssuesPage,
  });
});
