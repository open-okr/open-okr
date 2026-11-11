/**
 * Who the demonstration personas are (P8-T13a, P8-T13c), apart from the
 * command that gives them accounts.
 *
 * **Its own module, importing nothing but the cast**, because the auth hooks
 * and the people actions ask whether an account is a persona's
 * (docs/design/account-self-service.md D1), and `personas.ts` imports the
 * action registry, which imports the people actions: a cycle that left the
 * registry half built for whichever of them loaded first.
 */
import { INVENTED_CAST } from "./cast.ts";
import { YEAR_PEOPLE } from "./year/people.ts";

/** One persona a visitor may sign in as, for the sign-in page (P8-T13c). */
export interface DemoPersona {
  readonly name: string;
  readonly email: string;
  readonly title: string;
  /**
   * The scenario day they join the story, for the people the year adds. A
   * persona is not offered before it: there is no account to sign in to.
   */
  readonly arrives?: string;
}

/**
 * The five the Northwind year adds to the cast (P9-T22c-e-c): Hugo, Nadia,
 * Kofi, Leo and Yuki. Ben is not among them: he leaves in May and is
 * suspended, so an account could never sign in.
 */
export const YEAR_CAST: readonly DemoPersona[] = YEAR_PEOPLE.filter(
  (person) =>
    person.name !== "" &&
    person.leaves === undefined &&
    !INVENTED_CAST.some((member) => member.name === person.name),
).map((person) => ({
  name: person.name,
  email: `${person.key}@northwind.example`,
  title: person.title,
  arrives: person.arrives,
}));

/**
 * Who a visitor can be on a demo instance.
 *
 * The seven the one-quarter demo writes, then the five the Northwind year
 * adds, which is what `pnpm db:seed` builds since P9-T22c-e-c. In the cast's
 * own order so the list reads top-down through the organisation. The page
 * that shows this cannot ask the database who has an account, because it is
 * rendered before anybody is signed in.
 */
export const DEMO_PERSONAS: readonly DemoPersona[] = [
  ...INVENTED_CAST.map((person) => ({
    name: person.name,
    email: person.email,
    title: person.title,
  })),
  ...YEAR_CAST,
];

/**
 * Whether an account is one `pnpm demo:prepare` made (docs/design/
 * account-self-service.md D1).
 *
 * Its address is one of the personas', which can belong to nobody else:
 * `@northwind.example` is reserved by RFC 2606. The password is published, so
 * a visitor who changed the password, the name or how the account signs in
 * would break the demo for every other visitor until the nightly rebuild.
 * The avatar menu's Demo account chip asks the same question.
 */
export function isDemoAccount(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  const address = email.trim().toLowerCase();
  return DEMO_PERSONAS.some(
    (persona) => persona.email.toLowerCase() === address,
  );
}
