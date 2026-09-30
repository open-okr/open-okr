/**
 * The configuration a local agent reads to reach this instance (completeness
 * review M-12).
 *
 * The `mcpServers` shape with a URL and a header is what most agent runtimes
 * read from a file, whatever else each adds, so one example serves the page
 * and the moment a token is minted. The token goes in a header rather than the
 * URL, because a URL ends up in logs and a header does not.
 */
export function agentConfiguration(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openokr: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
