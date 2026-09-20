/**
 * The starting templates a new workspace can choose (P8-T12).
 *
 * **A template is a first quarter, not a demo.** The demo builder seeds a
 * whole cast with months of history, for somebody deciding whether to use the
 * product. A template seeds the smallest real thing a team can actually work
 * from and then edit: a few objectives that pass the quality checks, the
 * measures under them, and a session in the calendar.
 *
 * **Data, not code.** Each template is a list of what to create, and one
 * applier walks it through the ordinary actions. That keeps the templates
 * readable by somebody who wants to argue with the objectives rather than with
 * the loop, and it means a template cannot write a row the product would not
 * have written.
 *
 * **Every objective and key result here passes the quality canon**, because a
 * template that shipped a task-shaped key result would teach the wrong thing
 * on somebody's first day and the Coach would flag the product's own example.
 */

/** Which template somebody picked. `none` is the default and starts empty. */
export const STARTING_TEMPLATE_KEYS = [
  "none",
  "starter",
  "company-onboarding",
  "product-team",
] as const;

export type StartingTemplateKey = (typeof STARTING_TEMPLATE_KEYS)[number];

interface StartingTemplateKeyResult {
  readonly title: string;
  readonly unit?: string;
  readonly direction: "increase" | "reduce";
  readonly indicatorType: "lagging" | "leading";
  readonly baselineValue: number;
  readonly targetValue: number;
  /** Links this key result to the KPI the template creates, when it has one. */
  readonly linkToKpi?: boolean;
}

interface StartingTemplateObjective {
  readonly title: string;
  readonly level: "company" | "department" | "team";
  readonly keyResults: readonly StartingTemplateKeyResult[];
}

interface StartingTemplateKpi {
  readonly category: string;
  readonly tree: string;
  readonly name: string;
  readonly unit: string;
  readonly direction: "increase" | "decrease";
  readonly target: number;
  readonly current: number;
}

export interface StartingTemplate {
  readonly key: Exclude<StartingTemplateKey, "none">;
  readonly name: string;
  /** One line, shown beside the name when somebody is choosing. */
  readonly summary: string;
  /** Who this is the right answer for. */
  readonly forWhom: string;
  /** A space of its own, or the workspace's first space. */
  readonly space?: string;
  readonly objectives: readonly StartingTemplateObjective[];
  readonly kpi?: StartingTemplateKpi;
  /** Whether to schedule the first weekly session. */
  readonly scheduleWeekly: boolean;
}

/**
 * The starter cycle.
 *
 * One company objective, three key results pairing a lagging proof with two
 * leading signals, a KPI wired underneath, and the first weekly session in the
 * calendar. This is the one the acceptance criterion tests, and it is
 * deliberately the smallest template: somebody who picks it should be able to
 * read the whole thing in a minute and recognise their own quarter in it.
 */
const STARTER: StartingTemplate = {
  key: "starter",
  name: "OKR starter cycle",
  summary: "One objective, its measures, a KPI, and this week's session",
  forWhom: "A team running OKRs for the first time",
  objectives: [
    {
      title: "Make onboarding the reason new customers stay",
      level: "company",
      keyResults: [
        {
          title: "Raise 30-day retention from 62% to 75%",
          unit: "%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 62,
          targetValue: 75,
          linkToKpi: true,
        },
        {
          title: "Raise activation within the first week from 41% to 60%",
          unit: "%",
          direction: "increase",
          indicatorType: "leading",
          baselineValue: 41,
          targetValue: 60,
        },
        {
          title: "Cut time to first value from 9 days to 2 days",
          unit: "days",
          direction: "reduce",
          indicatorType: "leading",
          baselineValue: 9,
          targetValue: 2,
        },
      ],
    },
  ],
  kpi: {
    category: "Customer",
    tree: "Retention",
    name: "30-day retention",
    unit: "%",
    direction: "increase",
    target: 75,
    current: 62,
  },
  scheduleWeekly: true,
};

/**
 * A company's first quarter.
 *
 * Three objectives, which is the cap for a unit and well under the cap of five
 * for a company. The shape is deliberate: one about customers, one about the
 * product, one about how the company works. A first set that is all product is
 * the commonest way a company's OKRs become a roadmap with a new name.
 */
const COMPANY_ONBOARDING: StartingTemplate = {
  key: "company-onboarding",
  name: "Company onboarding",
  summary: "Three company objectives across customers, product and operations",
  forWhom: "A company setting its first quarter",
  objectives: [
    {
      title: "Make onboarding the reason new customers stay",
      level: "company",
      keyResults: [
        {
          title: "Raise 30-day retention from 62% to 75%",
          unit: "%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 62,
          targetValue: 75,
        },
        {
          title: "Raise activation within the first week from 41% to 60%",
          unit: "%",
          direction: "increase",
          indicatorType: "leading",
          baselineValue: 41,
          targetValue: 60,
        },
      ],
    },
    {
      title: "Become the product our customers recommend without being asked",
      level: "company",
      keyResults: [
        {
          title: "Raise NPS from 32 to 50",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 32,
          targetValue: 50,
        },
        {
          title: "Cut median first-response time from 9 hours to 2 hours",
          unit: "hours",
          direction: "reduce",
          indicatorType: "leading",
          baselineValue: 9,
          targetValue: 2,
        },
      ],
    },
    {
      title: "Make decisions faster than the market changes",
      level: "company",
      keyResults: [
        {
          title: "Cut median decision lead time from 21 days to 7 days",
          unit: "days",
          direction: "reduce",
          indicatorType: "lagging",
          baselineValue: 21,
          targetValue: 7,
        },
        {
          title: "Raise weekly check-in completion from 55% to 90%",
          unit: "%",
          direction: "increase",
          indicatorType: "leading",
          baselineValue: 55,
          targetValue: 90,
        },
      ],
    },
  ],
  scheduleWeekly: true,
};

/**
 * A product team's space.
 *
 * Its own space, two team objectives, and a KPI tree of its own. A product
 * team is the commonest first team to run OKRs properly, and the commonest to
 * write a backlog and call it an objective, so both objectives here are
 * outcomes with the delivery left as a means.
 */
const PRODUCT_TEAM: StartingTemplate = {
  key: "product-team",
  name: "Product team space",
  summary: "A space, two team objectives, and a KPI tree of its own",
  forWhom: "A product team starting inside a wider workspace",
  space: "Product",
  objectives: [
    {
      title: "Make the core workflow something people finish without help",
      level: "team",
      keyResults: [
        {
          title:
            "Raise task completion without support contact from 68% to 85%",
          unit: "%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 68,
          targetValue: 85,
          linkToKpi: true,
        },
        {
          title: "Cut steps in the core workflow from 11 to 6",
          unit: "steps",
          direction: "reduce",
          indicatorType: "leading",
          baselineValue: 11,
          targetValue: 6,
        },
      ],
    },
    {
      title: "Ship changes we can defend with evidence",
      level: "team",
      keyResults: [
        {
          title:
            "Raise changes shipped behind a measured hypothesis from 20% to 70%",
          unit: "%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 20,
          targetValue: 70,
        },
        {
          title:
            "Cut time from idea to first measurement from 28 days to 10 days",
          unit: "days",
          direction: "reduce",
          indicatorType: "leading",
          baselineValue: 28,
          targetValue: 10,
        },
      ],
    },
  ],
  kpi: {
    category: "Product",
    tree: "Usability",
    name: "Task completion without support",
    unit: "%",
    direction: "increase",
    target: 85,
    current: 68,
  },
  scheduleWeekly: true,
};

export const STARTING_TEMPLATES: readonly StartingTemplate[] = [
  STARTER,
  COMPANY_ONBOARDING,
  PRODUCT_TEAM,
];

export function startingTemplateFor(
  key: StartingTemplateKey,
): StartingTemplate | undefined {
  return STARTING_TEMPLATES.find((template) => template.key === key);
}
