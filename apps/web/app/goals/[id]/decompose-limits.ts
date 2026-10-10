/**
 * The most an initiative's description may hold when it is written in the
 * decompose panel: the cap its textarea had, now counted by the editor and
 * held by the panel's own server action (docs/design/guided-inputs.md §4.7).
 *
 * **Here, and not on `initiatives.create`**, by Akmal's decision of 9 October
 * 2026. Both importers write descriptions through that action, and a
 * FlowyTeam project summary has no length limit, so a cap there would refuse
 * a source row rather than import it. Imports and the API keep every word.
 *
 * Its own module because the panel and its server action both read it, and a
 * `"use server"` file may export nothing but its actions.
 */
export const DESCRIPTION_MAX_CHARACTERS = 1000;
