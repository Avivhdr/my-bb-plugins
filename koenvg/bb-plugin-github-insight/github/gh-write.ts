import { GhFailureError, ghFailureText } from "./gh-failure";

export type Written<T> = { ok: true; value: T } | { ok: false; message: string };

export async function write<T>(run: () => Promise<T>): Promise<Written<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof GhFailureError)
      return { ok: false, message: ghFailureText(error.failure) };
    if (error instanceof Error) return { ok: false, message: error.message };
    throw error;
  }
}
