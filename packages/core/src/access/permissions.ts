/**
 * The workspace permission catalogue (TECHNICAL-PLAN §4.14).
 *
 * Distinct from `ACCESS_LEVELS`: a level is how much of one aggregate a
 * binding grants; a permission is a workspace-wide capability, held through a
 * role tag on the workspace's own access context, and checked by whichever
 * settings screen or action declares it. The registry entries these back
 * (rhythm and coaching settings, the AI settings screen) cite the strings
 * below rather than inventing their own.
 *
 * `can()`, the thing that actually resolves whether a member holds one of
 * these, is P2-T02.
 */
export const PERMISSIONS = {
  manageAi: "manage_ai",
  manageCoaching: "manage_coaching",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
