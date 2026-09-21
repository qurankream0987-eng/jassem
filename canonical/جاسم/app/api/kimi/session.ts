import * as jose from "jose";
import { env } from "../lib/env";
import type { SessionPayload } from "./types";

const JWT_ALG = "HS256";

function sessionSecret(): Uint8Array {
  const value = env.isProduction
    ? process.env.SESSION_SECRET
    : process.env.SESSION_SECRET || env.appSecret;
  if (!value) {
    throw new Error("SESSION_SECRET is required to sign or verify a JASIM session.");
  }
  return new TextEncoder().encode(value);
}

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(sessionSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const { payload } = await jose.jwtVerify(token, sessionSecret(), {
      algorithms: [JWT_ALG],
    });
    const { unionId, clientId, iat } = payload;
    if (!unionId || !clientId) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    // `iat` travels out because revocation needs it. The token carries no id of
    // its own, so when it was minted is the only handle a revocation has.
    return {
      unionId: String(unionId),
      clientId: String(clientId),
      ...(typeof iat === "number" ? { issuedAt: iat } : {}),
    };
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
