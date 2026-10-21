const personalProjectId = "proj_personal";

export function isRemoteProject(projectId: string | null | undefined): projectId is string {
  return !!projectId && projectId !== personalProjectId;
}
