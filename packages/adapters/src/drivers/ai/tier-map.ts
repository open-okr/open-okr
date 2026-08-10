/**
 * Default tier maps (AI-NATIVE-PLAN §3.4, P2-T13).
 *
 * "Every driver ships a seeded default tier map... A driver added without a
 * default tier map is incomplete." The routing layer that resolves a
 * feature's requested tier through a workspace's policy to an actual model
 * is P2-T15; this is only the seed each driver hands that layer, so
 * supplying a key is the only step before every tier already points
 * somewhere sensible. An admin overriding the map, and the model catalogue
 * itself, both arrive with P2-T15.
 *
 * `embed` is absent for a driver with no embedding model — Anthropic ships
 * none at all, and this is `Partial` rather than a full four-key record so
 * that absence is a type-checked fact, not a placeholder string.
 */
export type ModelTier = "fast" | "balanced" | "deep" | "embed";

export type TierModelMap = Partial<Record<ModelTier, string>>;
