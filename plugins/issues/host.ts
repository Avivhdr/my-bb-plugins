// Host entry: reads the GitHub token the `gh` CLI already holds, so the board works
// for anyone signed in with `gh auth login` without pasting a second token into bb.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";

const execFileAsync = promisify(execFile);

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    ghAuthToken: async (_input, context) => {
      try {
        const { stdout } = await execFileAsync(
          "gh",
          ["auth", "token", "--hostname", "github.com"],
          { signal: context.signal, timeout: 10_000 },
        );
        const token = stdout.trim();
        return token
          ? { token, error: null }
          : { token: null, error: "gh returned an empty token" };
      } catch (error) {
        return { token: null, error: describeGhFailure(error) };
      }
    },
  },
});

function describeGhFailure(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return "the gh CLI is not installed";
  }
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error
      ? String(error.stderr).trim()
      : "";
  return stderr || (error instanceof Error ? error.message : String(error));
}
