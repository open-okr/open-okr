/**
 * Stand-ins for a chosen value in an address template, which a client
 * control fills in when somebody chooses (P9-T07a-b).
 *
 * **In a module of their own, not beside the controls that read them.** Both
 * controls are client components, and a constant exported from one reaches
 * the server page as a client reference rather than as the string. The page
 * then built its template around a stringified function: choosing a champion
 * wrote that function into the address the first time it ran, and the cycle
 * picker's template, built the same way since P8-G12, had carried it all
 * along.
 */
export const CYCLE_PLACEHOLDER = "__cycle__";
export const FILTER_PLACEHOLDER = "__value__";
