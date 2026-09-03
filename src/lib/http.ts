import { NextResponse } from "next/server";

/**
 * Log the real error server-side, return a safe generic message to the client.
 *
 * Never send `String(error)` / `error.message` to the browser from an admin
 * route: those can carry table names, SQL, stack frames, provider internals or
 * secrets. The detail stays in the server logs (which the operator controls).
 */
export function safeErrorResponse(
  context: string,
  error: unknown,
  status = 500,
  clientMessage = "Something went wrong. Please try again.",
): NextResponse {
  console.error(`[${context}]`, error);
  return NextResponse.json({ error: clientMessage }, { status });
}
