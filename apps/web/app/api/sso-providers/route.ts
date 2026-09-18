import { listSSOProviders } from "@openokr/core";
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/auth";

/**
 * Lists configured SSO providers for the sign-in page (P8-T07).
 *
 * Unauthenticated: the sign-in page needs to show SSO buttons before the
 * user has a session. Returns only the provider id and display name, not
 * credentials.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const providers = await listSSOProviders(getPool());
    return NextResponse.json({ providers });
  } catch {
    return NextResponse.json({ providers: [] });
  }
}
