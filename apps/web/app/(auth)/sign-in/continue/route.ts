import { NextResponse } from "next/server";
import { pathAfterSignIn } from "../deletion-actions";

/**
 * Where SSO and social sign-ins return. Applies a language picked on the
 * sign-in page, then goes where any other sign-in goes.
 */
export async function GET(request: Request) {
  const path = await pathAfterSignIn();
  return NextResponse.redirect(new URL(path, request.url));
}
