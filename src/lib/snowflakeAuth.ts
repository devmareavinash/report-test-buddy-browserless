import { invokeFunction } from "@/lib/functions";

export type SfAuthMethod = "password" | "sso" | "token";

export function resolveSfAuthMethod(authenticator?: string | null, authMethod?: string | null): SfAuthMethod {
  if (authMethod === "token" || authMethod === "sso") return authMethod;
  const a = (authenticator || authMethod || "password").toLowerCase();
  if (a === "externalbrowser" || a === "sso") return "sso";
  if (a.startsWith("http")) return "sso";
  if (a === "token") return "token";
  return "password";
}

export function snowflakePayload(
  fields: {
    name: string;
    kind: string;
    account: string;
    host: string;
    database: string;
    schema: string;
    warehouse: string;
    role: string;
    username: string;
    password_secret_ref: string;
    token_secret_ref: string;
  },
  sfAuthMethod: SfAuthMethod,
  idpUrl: string,
) {
  const authenticator = sfAuthMethod === "sso"
    ? (idpUrl.trim() || "sso")
    : sfAuthMethod === "token"
    ? "token"
    : "password";
  return {
    name: fields.name,
    kind: fields.kind,
    account: fields.account || null,
    host: fields.host || null,
    database: fields.database || null,
    schema: fields.schema || null,
    warehouse: fields.warehouse || null,
    role: fields.role || null,
    username: fields.username || null,
    password_secret_ref: sfAuthMethod === "password" ? (fields.password_secret_ref || null) : null,
    token_secret_ref: sfAuthMethod === "token" ? (fields.token_secret_ref || null) : null,
    auth_method: sfAuthMethod,
    extra: { authenticator },
  };
}

export async function testWarehouseConnectivity(connector: Record<string, unknown>) {
  return invokeFunction("test-warehouse-connectivity", { connector });
}
