/**
 * The setup code the wizard end-to-end server runs under
 * (docs/design/setup-code.md, plan 0.9.0 G1).
 *
 * One module, because two readers need the same value: `playwright.config.ts`
 * hands it to the unclaimed instance as `OPENOKR_SETUP_CODE`, and
 * `first-run-wizard.spec.ts` types it into the wizard. Two copies of the
 * literal would agree only until somebody changed one. Only the wizard server
 * is unclaimed, so no other spec needs it: the application server is marked
 * configured before it starts.
 */
export const E2E_SETUP_CODE = "K7M2-9PQX-4TVD";
