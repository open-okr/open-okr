/**
 * The single sign-on buttons the sign-in page may draw (completeness review
 * H-03).
 *
 * Unauthenticated by necessity: nobody on the sign-in page has signed in. It
 * used to answer with every enabled connection on the instance, workspace id,
 * email domains and enforce flag included, which on the managed cloud listed
 * every customer and their identity provider to anyone who asked.
 * `publicSSOProviders` now decides what a visitor may see: on the cloud,
 * only the providers for the domain of the address they typed, and anywhere,
 * only a provider's id, name and protocol.
 */
import { isCloudEnabled, publicSSOProviders } from "@openokr/core";
import { type NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Bounded before it reaches anything: an address is never this long, and a
  // parameter nobody bounds is a parameter somebody fills.
  const email = (request.nextUrl.searchParams.get("email") ?? "").slice(0, 320);
  try {
    const pool = getPool();
    const providers = await publicSSOProviders(pool, {
      cloud: await isCloudEnabled(pool),
      ...(email ? { email } : {}),
    });
    return NextResponse.json({ providers });
  } catch {
    return NextResponse.json({ providers: [] });
  }
}
