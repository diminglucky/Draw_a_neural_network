import { createHash } from "node:crypto";
import argon2 from "argon2";
import { jwtVerify, SignJWT } from "jose";

export interface AccessTokenClaims {
  sub: string;
  deviceId: string;
  sessionId: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2.verify(encodedHash, password);
  } catch {
    return false;
  }
}

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, "iat" | "exp">,
  secret: string,
  options: { ttlSeconds?: number } = {},
): Promise<string> {
  const ttlSeconds = options.ttlSeconds ?? 900;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  const result = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
  return result.payload as unknown as AccessTokenClaims;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
