import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { hostContract } from "./host-contract";

const MAX_MATCHES = 10;
const MAX_DIRECTORIES = 5000;
const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

async function findByName(rootPath: string, name: string): Promise<string[]> {
  const matches: string[] = [];
  const pending = [""];
  let visited = 0;
  while (pending.length && matches.length < MAX_MATCHES && visited++ < MAX_DIRECTORIES) {
    const relative = pending.shift()!;
    const entries = await readdir(join(rootPath, relative), { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isFile() && entry.name === name) matches.push(path);
      else if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      )
        pending.push(path);
    }
  }
  return matches.slice(0, MAX_MATCHES);
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async resolve_root({ rootPath }) {
      if (!isAbsolute(rootPath)) throw new Error("The source root must be absolute.");
      return { rootPath: await realpath(rootPath) };
    },
    async find_by_name({ rootPath, name }) {
      if (!isAbsolute(rootPath)) throw new Error("The source root must be absolute.");
      return { paths: await findByName(rootPath, name) };
    },
  },
});
