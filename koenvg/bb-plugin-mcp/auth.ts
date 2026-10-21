import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from "jose";
import { z } from "zod";
import type { IncomingHttpHeaders } from "node:http";
import type { Config, Connection } from "./config.js";

export type Identity = {
  mode: Config["authMode"];
  issuer: string;
  owner: string;
  audience: string;
  permissions: ("read" | "control")[];
  expiresAt: number;
};

const discoverySchema = z.object({ issuer: z.string(), jwks_uri: z.string().url() });

export function authenticator(fetcher: typeof fetch = fetch) {
  // Only the configured issuer supplies key locations. Keep one issuer cache.
  let cached:
    | { id: string; keys: ReturnType<typeof createRemoteJWKSet>; expires: number }
    | undefined;
  let loading: { id: string; promise: Promise<NonNullable<typeof cached>> } | undefined;
  const boundedFetch: typeof fetch = async (input, init) => {
    const response = await fetcher(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok || !response.body) throw new Error("AUTH_UNAVAILABLE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) throw new Error("AUTH_UNAVAILABLE");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  };
  async function keys(config: Config) {
    const { issuer, authMode } = config;
    const id = authMode + "\n" + issuer;
    if (cached?.id === id && cached.expires > Date.now()) return cached.keys;
    if (loading?.id !== id) {
      loading = {
        id,
        promise: (async () => {
          let url = new URL(issuer + "/cdn-cgi/access/certs");
          if (authMode === "bearer-jwt") {
            // Remove only the discovery separator; issuer identity stays exact.
            const response = await boundedFetch(
              issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
            );
            const discovery = discoverySchema.parse(await response.json());
            url = new URL(discovery.jwks_uri);
            if (
              discovery.issuer !== issuer ||
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.hash ||
              url.search
            )
              throw new Error();
          }
          return {
            id,
            keys: createRemoteJWKSet(url, {
              [customFetch]: boundedFetch,
              timeoutDuration: 3000,
              cacheMaxAge: 300000,
              cooldownDuration: 30000,
            }),
            expires: Date.now() + 300000,
          };
        })(),
      };
    }
    const pending = loading;
    try {
      cached = await pending.promise;
      return cached.keys;
    } finally {
      if (loading === pending) loading = undefined;
    }
  }
  return async (
    headers: IncomingHttpHeaders,
    config: Config,
    connection: Connection,
  ): Promise<Identity> => {
    const cloudflare = config.authMode === "cloudflare-access";
    const credential = cloudflare ? headers["cf-access-jwt-assertion"] : headers.authorization;
    if (
      typeof credential !== "string" ||
      credential.length > 8192 ||
      !(
        cloudflare ? /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ : /^Bearer [A-Za-z0-9_.-]+$/
      ).test(credential)
    )
      throw new Error();
    const token = cloudflare ? credential : credential.slice(7);
    if (cloudflare) {
      const header = decodeProtectedHeader(token);
      if (typeof header.kid !== "string" || !header.kid || header.kid.length > 256)
        throw new Error();
    }
    const audience = cloudflare ? config.accessAudience : connection.publicOrigin + "/mcp";
    const { payload } = await jwtVerify(token, await keys(config), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience,
      requiredClaims: ["exp", "sub", "iss", "aud"],
      clockTolerance: 0,
    });
    if (payload.sub !== config.owner) throw new Error();
    let control = false;
    if (cloudflare) {
      if (
        payload.type !== "app" ||
        !payload.sub ||
        (payload.iat !== undefined &&
          (!Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000))
      )
        throw new Error();
      control = config.accessPermission === "read-control";
    } else {
      if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes("bb.read"))
        throw new Error("INSUFFICIENT_SCOPE");
      control = payload.scope.split(" ").includes("bb.control");
    }
    return {
      mode: config.authMode,
      issuer: config.issuer,
      owner: payload.sub,
      audience,
      permissions: control ? ["read", "control"] : ["read"],
      expiresAt: payload.exp!,
    };
  };
}
