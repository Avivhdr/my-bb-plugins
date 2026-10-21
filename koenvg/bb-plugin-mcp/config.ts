import { z } from "zod";

export const settingsDefinition = {
  publicOrigin: {
    type: "string",
    label: "Public HTTPS origin",
    default: "",
    description: "Existing tunnel hostname, without a path. Reload after a change.",
  },
  port: {
    type: "number",
    label: "Loopback port",
    default: 38991,
    description: "Reload after a change. Never use BB's main port.",
  },
  authMode: {
    type: "string",
    label: "Authentication mode",
    default: "bearer-jwt",
    description: "bearer-jwt or cloudflare-access. No credential fallback between modes.",
  },
  accessAudience: {
    type: "string",
    label: "Cloudflare application AUD",
    default: "",
    description: "Exact dedicated Access application audience. Never use a shared app AUD.",
  },
  accessPermission: {
    type: "string",
    label: "Cloudflare local app permission",
    default: "read",
    description:
      "read or read-control. All owner/app sessions share this local permission, not OAuth scopes.",
  },
  accessOAuthIssuer: {
    type: "string",
    label: "Cloudflare OAuth discovery issuer",
    default: "",
    description:
      "Exact Managed OAuth server issuer from verified discovery, not the assertion issuer.",
  },
  issuer: {
    type: "string",
    label: "Assertion signing issuer",
    default: "",
    description:
      "Bearer mode: exact OpenID Connect issuer, including any trailing slash. Cloudflare mode: exact HTTPS Access team origin.",
  },
  owner: {
    type: "string",
    label: "Owner subject",
    default: "",
    description: "Exact signed sub claim. Removing it denies access immediately.",
  },
  remoteEnabled: {
    type: "boolean",
    label: "Enable remote reads",
    default: false,
    description: "Disable closes the listener. Reload to enable it again.",
  },
  controlEnabled: {
    type: "boolean",
    label: "Enable remote control",
    default: false,
    description:
      "Require control permission as well as this switch. Agents can change files and incur costs.",
  },
} as const;

export const configSchema = z
  .strictObject({
    publicOrigin: z.string().max(2048),
    port: z
      .number()
      .int()
      .min(1024)
      .max(65535)
      .refine((p) => p !== 38886),
    issuer: z.string().max(2048),
    authMode: z.enum(["bearer-jwt", "cloudflare-access"]).default("bearer-jwt"),
    accessAudience: z.string().max(256).default(""),
    accessPermission: z.enum(["read", "read-control"]).default("read"),
    accessOAuthIssuer: z.string().max(2048).default(""),
    owner: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim() === value),
    remoteEnabled: z.boolean(),
    controlEnabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const field of ["publicOrigin", "issuer"] as const) {
      try {
        const url = new URL(value[field]);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !url.hostname.includes(".") ||
          url.hostname === "localhost" ||
          (field === "publicOrigin" && value[field] !== url.origin) ||
          (field === "issuer" && value[field] !== url.href && value[field] !== url.origin)
        )
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Use a canonical public HTTPS URL.",
        });
      }
    }
    if (value.authMode === "cloudflare-access") {
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(value.accessAudience))
        ctx.addIssue({
          code: "custom",
          path: ["accessAudience"],
          message: "Use the exact application AUD.",
        });
      try {
        const issuer = new URL(value.issuer);
        const oauth = new URL(value.accessOAuthIssuer);
        if (
          value.issuer !== issuer.origin ||
          oauth.protocol !== "https:" ||
          oauth.username ||
          oauth.password ||
          oauth.search ||
          oauth.hash ||
          !oauth.hostname.includes(".") ||
          (value.accessOAuthIssuer !== oauth.href && value.accessOAuthIssuer !== oauth.origin)
        )
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["accessOAuthIssuer"],
          message: "Use verified public HTTPS issuers; the signing issuer must be a team origin.",
        });
      }
    }
  });

export type Config = z.infer<typeof configSchema>;
export type Connection = Pick<Config, "publicOrigin" | "port">;
export function readConfig(raw: unknown): Config | null {
  if (
    raw !== null &&
    typeof raw === "object" &&
    (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null)
  ) {
    const settings = { ...raw };
    Reflect.deleteProperty(settings, "projects");
    raw = settings;
  }
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
