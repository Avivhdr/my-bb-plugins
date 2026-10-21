import { createContext, useContext } from "react";

export interface FilesJump {
  commentIds: readonly string[];
}

export interface FilesJumpRequest extends FilesJump {
  onHandled(): void;
}

const ShowFilesContext = createContext<(jump: FilesJump) => void>(() => {});

export const ShowFilesProvider = ShowFilesContext.Provider;

export function useShowFiles(): (jump: FilesJump) => void {
  return useContext(ShowFilesContext);
}
