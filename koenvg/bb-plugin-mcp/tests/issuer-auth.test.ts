import { beforeAll, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticator } from "../auth.js";
import type { Config } from "../config.js";

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: object;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "issuer-test", alg: "RS256" }] };
});
const issuers = [
  "https://issuer.example.org/",
  "https://issuer.example.org",
  "https://issuer.example.org/realm/",
  "https://issuer.example.org/realm",
];
function policy(issuer: string): Config {
  return {
    issuer,
    publicOrigin: "https://mcp.example.org",
    port: 38991,
    authMode: "bearer-jwt",
    accessAudience: "",
    accessPermission: "read",
    accessOAuthIssuer: "",
    owner: "owner-1",
    remoteEnabled: true,
    controlEnabled: false,
  };
}
async function credential(issuer: string) {
  return new SignJWT({ scope: "bb.read" })
    .setProtectedHeader({ alg: "RS256", kid: "issuer-test" })
    .setIssuer(issuer)
    .setSubject("owner-1")
    .setAudience("https://mcp.example.org/mcp")
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(pair.privateKey);
}
function discovery(configured: string, discovered = configured) {
  const discoveryURL = configured.replace(/\/$/, "") + "/.well-known/openid-configuration";
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === discoveryURL)
      return Response.json({ issuer: discovered, jwks_uri: "https://issuer.example.org/keys" });
    if (url === "https://issuer.example.org/keys") return Response.json(jwks);
    throw new Error("Unexpected discovery or key URL: " + url);
  });
}
it.each(issuers)(
  "uses one discovery separator and retains exact issuer identity: %s",
  async (issuer) => {
    const fetcher = discovery(issuer);
    const config = policy(issuer);
    const authenticate = authenticator(fetcher);
    const identity = await authenticate(
      { authorization: "Bearer " + (await credential(issuer)) },
      config,
      config,
    );
    expect(identity).toMatchObject({ issuer, owner: "owner-1", permissions: ["read"] });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
      "https://issuer.example.org/keys",
    ]);
  },
);
it.each(issuers)(
  "rejects a discovery issuer differing only by trailing slash: %s",
  async (issuer) => {
    const mismatch = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer + "/";
    const fetcher = discovery(issuer, mismatch);
    const config = policy(issuer);
    await expect(
      authenticator(fetcher)(
        { authorization: "Bearer " + (await credential(issuer)) },
        config,
        config,
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
    );
  },
);
it.each(issuers)("rejects a JWT issuer differing only by trailing slash: %s", async (issuer) => {
  const mismatch = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer + "/";
  const config = policy(issuer);
  const fetcher = discovery(issuer);
  await expect(
    authenticator(fetcher)(
      { authorization: "Bearer " + (await credential(mismatch)) },
      config,
      config,
    ),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
