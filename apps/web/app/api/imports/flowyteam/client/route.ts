import { flowyteamClientMetadata } from "@openokr/core";
import { instanceOrigin } from "../../../../../lib/flowyteam";

/**
 * This instance's OAuth client metadata document
 * (docs/design/flowyteam-connect.md §4.4). A self-hosted instance with no
 * registered FlowyTeam client presents this address as its client id, and
 * FlowyTeam fetches it to learn the name and the one redirect address it may
 * send a code to. Public: FlowyTeam has no session here. It holds nothing
 * secret, only the instance's own address.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(
    JSON.stringify(flowyteamClientMetadata(instanceOrigin())),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
      },
    },
  );
}
