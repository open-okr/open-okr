/**
 * The Northwind year's people and spaces (P9-T22c-a, scenario README §2, §3).
 *
 * Fourteen people. Elena is whoever registered the workspace, as she is in
 * the story ("The registrant's seat, unnamed"), so the seed keeps their name
 * and gives them her title. The other thirteen are members with no account
 * behind them until `demo:prepare` gives them one, which is P9-T22c-e's.
 *
 * Dates are the scenario's. A person exists from the day they arrive and is
 * suspended on their last day, the way directory sync does it; a space exists
 * from the day it forms and is archived on the day it merges.
 */

export type YearPersonKey =
  | "elena"
  | "priya"
  | "daniel"
  | "tomas"
  | "mei"
  | "sara"
  | "jonas"
  | "amara"
  | "hugo"
  | "nadia"
  | "kofi"
  | "leo"
  | "yuki"
  | "ben";

export interface YearPerson {
  readonly key: YearPersonKey;
  readonly name: string;
  readonly title: string;
  readonly timezone: string;
  readonly managerKey?: YearPersonKey;
  /**
   * The scenario day they arrive: invited to the pilot (NW-P-02), synced
   * from the directory for the rollout (NW-P-05), or hired (NW-Q2-05).
   */
  readonly arrives: string;
  /** The scenario day they leave, when they do (NW-Q2-12). */
  readonly leaves?: string;
}

/** The pilot's invitations (NW-P-02). */
const PILOT = "2026-10-01";
/** Directory sync provisions the rest for the rollout (NW-P-05). */
const ROLLOUT = "2026-11-25";

export const YEAR_PEOPLE: readonly YearPerson[] = [
  {
    key: "elena",
    name: "",
    title: "Chief Executive",
    timezone: "Europe/London",
    arrives: "2026-09-28",
  },
  {
    key: "priya",
    name: "Priya Raman",
    title: "Chief Product Officer",
    timezone: "Europe/London",
    managerKey: "elena",
    arrives: "2026-09-28",
  },
  {
    key: "tomas",
    name: "Tomás Herrera",
    title: "Head of Customer Success",
    timezone: "Europe/Madrid",
    managerKey: "elena",
    arrives: PILOT,
  },
  {
    key: "mei",
    name: "Mei Lin",
    title: "Head of Engineering",
    timezone: "Asia/Singapore",
    managerKey: "priya",
    arrives: PILOT,
  },
  {
    key: "sara",
    name: "Sara Nasser",
    title: "Product Manager, Onboarding",
    timezone: "Europe/London",
    managerKey: "priya",
    arrives: PILOT,
  },
  {
    key: "amara",
    name: "Amara Diallo",
    title: "Data Analyst",
    timezone: "Africa/Dakar",
    managerKey: "elena",
    arrives: PILOT,
  },
  {
    key: "daniel",
    name: "Daniel Osei",
    title: "VP Sales",
    timezone: "America/New_York",
    managerKey: "elena",
    arrives: ROLLOUT,
  },
  {
    key: "jonas",
    name: "Jonas Weber",
    title: "Account Executive",
    timezone: "Europe/Berlin",
    managerKey: "daniel",
    arrives: ROLLOUT,
  },
  {
    key: "hugo",
    name: "Hugo Lindqvist",
    title: "Chief Financial Officer",
    timezone: "Europe/Stockholm",
    managerKey: "elena",
    arrives: ROLLOUT,
  },
  {
    key: "nadia",
    name: "Nadia Rahman",
    title: "Head of Marketing",
    timezone: "Europe/London",
    managerKey: "elena",
    arrives: ROLLOUT,
  },
  {
    key: "kofi",
    name: "Kofi Asante",
    title: "Support Lead",
    timezone: "Africa/Accra",
    managerKey: "elena",
    arrives: ROLLOUT,
  },
  {
    key: "leo",
    name: "Leo Martins",
    title: "Engineering Manager, Platform",
    timezone: "Europe/Lisbon",
    managerKey: "mei",
    arrives: ROLLOUT,
  },
  {
    key: "ben",
    name: "Ben Carter",
    title: "Account Executive",
    timezone: "America/Chicago",
    managerKey: "daniel",
    arrives: ROLLOUT,
    leaves: "2027-05-21",
  },
  {
    key: "yuki",
    name: "Yuki Tanaka",
    title: "Product Manager, Growth",
    timezone: "Europe/London",
    managerKey: "priya",
    arrives: "2027-04-12",
  },
];

export type YearSpaceKey =
  | "company"
  | "product"
  | "engineering"
  | "sales"
  | "customerSuccess"
  | "support"
  | "marketing"
  | "finance"
  | "growth";

export interface YearSpace {
  readonly key: YearSpaceKey;
  readonly name: string;
  readonly mission: string;
  readonly managerKey: YearPersonKey;
  readonly coordinatorKey: YearPersonKey;
  readonly memberKeys: readonly YearPersonKey[];
  /** The scenario day it forms. */
  readonly forms: string;
  /** The scenario day it merges into another and is archived (NW-Q3-07). */
  readonly merges?: string;
}

/**
 * The nine spaces. The company space is the workspace's own first space,
 * which provisioning created and the product reads as the company's (P9-T19a);
 * the seed gives it Priya as its coordinator rather than creating another.
 */
export const YEAR_SPACES: readonly YearSpace[] = [
  {
    key: "company",
    name: "",
    mission: "",
    managerKey: "elena",
    coordinatorKey: "priya",
    memberKeys: [],
    forms: "2026-09-28",
  },
  {
    key: "product",
    name: "Product",
    mission:
      "New accounts reach value in their first week, without us in the room.",
    managerKey: "priya",
    coordinatorKey: "sara",
    // Yuki joins on her first morning (NW-Q2-05): a member is added to a
    // space once both exist.
    memberKeys: ["sara", "amara", "yuki"],
    forms: PILOT,
  },
  {
    key: "customerSuccess",
    name: "Customer Success",
    mission: "No customer is surprised by their own renewal.",
    managerKey: "tomas",
    coordinatorKey: "tomas",
    memberKeys: [],
    forms: PILOT,
  },
  {
    key: "engineering",
    name: "Engineering",
    mission: "A platform customers never have to think about.",
    managerKey: "mei",
    coordinatorKey: "leo",
    memberKeys: ["leo"],
    forms: ROLLOUT,
  },
  {
    key: "sales",
    name: "Sales",
    mission: "Sell to accounts that can onboard themselves.",
    managerKey: "daniel",
    coordinatorKey: "jonas",
    memberKeys: ["jonas", "ben"],
    forms: ROLLOUT,
  },
  {
    key: "support",
    name: "Support",
    mission: "Answer once, in the product.",
    managerKey: "kofi",
    coordinatorKey: "kofi",
    memberKeys: [],
    forms: ROLLOUT,
    merges: "2027-07-26",
  },
  {
    key: "marketing",
    name: "Marketing",
    mission: "Bring in accounts that fit.",
    managerKey: "nadia",
    coordinatorKey: "nadia",
    memberKeys: [],
    forms: ROLLOUT,
  },
  {
    key: "finance",
    name: "Finance and Operations",
    mission: "Margins we can run the business on, and books the board trusts.",
    managerKey: "hugo",
    coordinatorKey: "hugo",
    memberKeys: [],
    forms: ROLLOUT,
  },
  {
    key: "growth",
    name: "Growth",
    mission: "Trials turn into customers without a sales call.",
    managerKey: "yuki",
    coordinatorKey: "yuki",
    memberKeys: ["amara"],
    forms: "2027-08-09",
  },
];
