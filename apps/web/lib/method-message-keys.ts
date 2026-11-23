// Message keys for the method catalogue, in condition order.

interface MethodMessageKeys {
  readonly title: string;
  readonly conditions: readonly {
    readonly label: string;
    readonly prompt: string;
  }[];
}

export const METHOD_MESSAGE_KEYS: Readonly<Record<string, MethodMessageKeys>> =
  {
    "OBJ-1": {
      title: "method.rule.OBJ-1.title",
      conditions: [
        {
          label: "method.rule.OBJ-1.condition.1.label",
          prompt: "method.rule.OBJ-1.condition.1.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.2.label",
          prompt: "method.rule.OBJ-1.condition.2.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.3.label",
          prompt: "method.rule.OBJ-1.condition.3.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.4.label",
          prompt: "method.rule.OBJ-1.condition.4.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.5.label",
          prompt: "method.rule.OBJ-1.condition.5.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.6.label",
          prompt: "method.rule.OBJ-1.condition.6.prompt",
        },
        {
          label: "method.rule.OBJ-1.condition.7.label",
          prompt: "method.rule.OBJ-1.condition.7.prompt",
        },
      ],
    },
    "OBJ-2": {
      title: "method.rule.OBJ-2.title",
      conditions: [
        {
          label: "method.rule.OBJ-2.condition.1.label",
          prompt: "method.rule.OBJ-2.condition.1.prompt",
        },
        {
          label: "method.rule.OBJ-2.condition.2.label",
          prompt: "method.rule.OBJ-2.condition.2.prompt",
        },
        {
          label: "method.rule.OBJ-2.condition.3.label",
          prompt: "method.rule.OBJ-2.condition.3.prompt",
        },
      ],
    },
    "OBJ-3": {
      title: "method.rule.OBJ-3.title",
      conditions: [
        {
          label: "method.rule.OBJ-3.condition.1.label",
          prompt: "method.rule.OBJ-3.condition.1.prompt",
        },
        {
          label: "method.rule.OBJ-3.condition.2.label",
          prompt: "method.rule.OBJ-3.condition.2.prompt",
        },
      ],
    },
    "OBJ-4": {
      title: "method.rule.OBJ-4.title",
      conditions: [
        {
          label: "method.rule.OBJ-4.condition.1.label",
          prompt: "method.rule.OBJ-4.condition.1.prompt",
        },
        {
          label: "method.rule.OBJ-4.condition.2.label",
          prompt: "method.rule.OBJ-4.condition.2.prompt",
        },
        {
          label: "method.rule.OBJ-4.condition.3.label",
          prompt: "method.rule.OBJ-4.condition.3.prompt",
        },
        {
          label: "method.rule.OBJ-4.condition.4.label",
          prompt: "method.rule.OBJ-4.condition.4.prompt",
        },
      ],
    },
    "OBJ-5": {
      title: "method.rule.OBJ-5.title",
      conditions: [
        {
          label: "method.rule.OBJ-5.condition.1.label",
          prompt: "method.rule.OBJ-5.condition.1.prompt",
        },
        {
          label: "method.rule.OBJ-5.condition.2.label",
          prompt: "method.rule.OBJ-5.condition.2.prompt",
        },
        {
          label: "method.rule.OBJ-5.condition.3.label",
          prompt: "method.rule.OBJ-5.condition.3.prompt",
        },
      ],
    },
    "KR-1": {
      title: "method.rule.KR-1.title",
      conditions: [
        {
          label: "method.rule.KR-1.condition.1.label",
          prompt: "method.rule.KR-1.condition.1.prompt",
        },
        {
          label: "method.rule.KR-1.condition.2.label",
          prompt: "method.rule.KR-1.condition.2.prompt",
        },
        {
          label: "method.rule.KR-1.condition.3.label",
          prompt: "method.rule.KR-1.condition.3.prompt",
        },
        {
          label: "method.rule.KR-1.condition.4.label",
          prompt: "method.rule.KR-1.condition.4.prompt",
        },
      ],
    },
    "KR-2": {
      title: "method.rule.KR-2.title",
      conditions: [
        {
          label: "method.rule.KR-2.condition.1.label",
          prompt: "method.rule.KR-2.condition.1.prompt",
        },
        {
          label: "method.rule.KR-2.condition.2.label",
          prompt: "method.rule.KR-2.condition.2.prompt",
        },
        {
          label: "method.rule.KR-2.condition.3.label",
          prompt: "method.rule.KR-2.condition.3.prompt",
        },
        {
          label: "method.rule.KR-2.condition.4.label",
          prompt: "method.rule.KR-2.condition.4.prompt",
        },
        {
          label: "method.rule.KR-2.condition.5.label",
          prompt: "method.rule.KR-2.condition.5.prompt",
        },
        {
          label: "method.rule.KR-2.condition.6.label",
          prompt: "method.rule.KR-2.condition.6.prompt",
        },
      ],
    },
    "KR-3": {
      title: "method.rule.KR-3.title",
      conditions: [
        {
          label: "method.rule.KR-3.condition.1.label",
          prompt: "method.rule.KR-3.condition.1.prompt",
        },
        {
          label: "method.rule.KR-3.condition.2.label",
          prompt: "method.rule.KR-3.condition.2.prompt",
        },
        {
          label: "method.rule.KR-3.condition.3.label",
          prompt: "method.rule.KR-3.condition.3.prompt",
        },
        {
          label: "method.rule.KR-3.condition.4.label",
          prompt: "method.rule.KR-3.condition.4.prompt",
        },
      ],
    },
    "KR-4": {
      title: "method.rule.KR-4.title",
      conditions: [
        {
          label: "method.rule.KR-4.condition.1.label",
          prompt: "method.rule.KR-4.condition.1.prompt",
        },
        {
          label: "method.rule.KR-4.condition.2.label",
          prompt: "method.rule.KR-4.condition.2.prompt",
        },
        {
          label: "method.rule.KR-4.condition.3.label",
          prompt: "method.rule.KR-4.condition.3.prompt",
        },
        {
          label: "method.rule.KR-4.condition.4.label",
          prompt: "method.rule.KR-4.condition.4.prompt",
        },
      ],
    },
    "KR-5": {
      title: "method.rule.KR-5.title",
      conditions: [
        {
          label: "method.rule.KR-5.condition.1.label",
          prompt: "method.rule.KR-5.condition.1.prompt",
        },
        {
          label: "method.rule.KR-5.condition.2.label",
          prompt: "method.rule.KR-5.condition.2.prompt",
        },
        {
          label: "method.rule.KR-5.condition.3.label",
          prompt: "method.rule.KR-5.condition.3.prompt",
        },
        {
          label: "method.rule.KR-5.condition.4.label",
          prompt: "method.rule.KR-5.condition.4.prompt",
        },
      ],
    },
    "KR-6": {
      title: "method.rule.KR-6.title",
      conditions: [
        {
          label: "method.rule.KR-6.condition.1.label",
          prompt: "method.rule.KR-6.condition.1.prompt",
        },
        {
          label: "method.rule.KR-6.condition.2.label",
          prompt: "method.rule.KR-6.condition.2.prompt",
        },
        {
          label: "method.rule.KR-6.condition.3.label",
          prompt: "method.rule.KR-6.condition.3.prompt",
        },
        {
          label: "method.rule.KR-6.condition.4.label",
          prompt: "method.rule.KR-6.condition.4.prompt",
        },
        {
          label: "method.rule.KR-6.condition.5.label",
          prompt: "method.rule.KR-6.condition.5.prompt",
        },
        {
          label: "method.rule.KR-6.condition.6.label",
          prompt: "method.rule.KR-6.condition.6.prompt",
        },
      ],
    },
    "KR-7": {
      title: "method.rule.KR-7.title",
      conditions: [
        {
          label: "method.rule.KR-7.condition.1.label",
          prompt: "method.rule.KR-7.condition.1.prompt",
        },
        {
          label: "method.rule.KR-7.condition.2.label",
          prompt: "method.rule.KR-7.condition.2.prompt",
        },
        {
          label: "method.rule.KR-7.condition.3.label",
          prompt: "method.rule.KR-7.condition.3.prompt",
        },
        {
          label: "method.rule.KR-7.condition.4.label",
          prompt: "method.rule.KR-7.condition.4.prompt",
        },
        {
          label: "method.rule.KR-7.condition.5.label",
          prompt: "method.rule.KR-7.condition.5.prompt",
        },
      ],
    },
    "AL-1": {
      title: "method.rule.AL-1.title",
      conditions: [
        {
          label: "method.rule.AL-1.condition.1.label",
          prompt: "method.rule.AL-1.condition.1.prompt",
        },
        {
          label: "method.rule.AL-1.condition.2.label",
          prompt: "method.rule.AL-1.condition.2.prompt",
        },
        {
          label: "method.rule.AL-1.condition.3.label",
          prompt: "method.rule.AL-1.condition.3.prompt",
        },
      ],
    },
    "AL-2": {
      title: "method.rule.AL-2.title",
      conditions: [
        {
          label: "method.rule.AL-2.condition.1.label",
          prompt: "method.rule.AL-2.condition.1.prompt",
        },
      ],
    },
    "AL-3": {
      title: "method.rule.AL-3.title",
      conditions: [
        {
          label: "method.rule.AL-3.condition.1.label",
          prompt: "method.rule.AL-3.condition.1.prompt",
        },
        {
          label: "method.rule.AL-3.condition.2.label",
          prompt: "method.rule.AL-3.condition.2.prompt",
        },
      ],
    },
    "AL-4": {
      title: "method.rule.AL-4.title",
      conditions: [
        {
          label: "method.rule.AL-4.condition.1.label",
          prompt: "method.rule.AL-4.condition.1.prompt",
        },
        {
          label: "method.rule.AL-4.condition.2.label",
          prompt: "method.rule.AL-4.condition.2.prompt",
        },
      ],
    },
    "AL-5": {
      title: "method.rule.AL-5.title",
      conditions: [
        {
          label: "method.rule.AL-5.condition.1.label",
          prompt: "method.rule.AL-5.condition.1.prompt",
        },
        {
          label: "method.rule.AL-5.condition.2.label",
          prompt: "method.rule.AL-5.condition.2.prompt",
        },
      ],
    },
    "AL-6": {
      title: "method.rule.AL-6.title",
      conditions: [
        {
          label: "method.rule.AL-6.condition.1.label",
          prompt: "method.rule.AL-6.condition.1.prompt",
        },
        {
          label: "method.rule.AL-6.condition.2.label",
          prompt: "method.rule.AL-6.condition.2.prompt",
        },
      ],
    },
    "CY-1": {
      title: "method.rule.CY-1.title",
      conditions: [
        {
          label: "method.rule.CY-1.condition.1.label",
          prompt: "method.rule.CY-1.condition.1.prompt",
        },
        {
          label: "method.rule.CY-1.condition.2.label",
          prompt: "method.rule.CY-1.condition.2.prompt",
        },
      ],
    },
    "CY-2": {
      title: "method.rule.CY-2.title",
      conditions: [
        {
          label: "method.rule.CY-2.condition.1.label",
          prompt: "method.rule.CY-2.condition.1.prompt",
        },
        {
          label: "method.rule.CY-2.condition.2.label",
          prompt: "method.rule.CY-2.condition.2.prompt",
        },
      ],
    },
    "CY-3": {
      title: "method.rule.CY-3.title",
      conditions: [
        {
          label: "method.rule.CY-3.condition.1.label",
          prompt: "method.rule.CY-3.condition.1.prompt",
        },
        {
          label: "method.rule.CY-3.condition.2.label",
          prompt: "method.rule.CY-3.condition.2.prompt",
        },
        {
          label: "method.rule.CY-3.condition.3.label",
          prompt: "method.rule.CY-3.condition.3.prompt",
        },
      ],
    },
    "CY-4": {
      title: "method.rule.CY-4.title",
      conditions: [
        {
          label: "method.rule.CY-4.condition.1.label",
          prompt: "method.rule.CY-4.condition.1.prompt",
        },
        {
          label: "method.rule.CY-4.condition.2.label",
          prompt: "method.rule.CY-4.condition.2.prompt",
        },
        {
          label: "method.rule.CY-4.condition.3.label",
          prompt: "method.rule.CY-4.condition.3.prompt",
        },
      ],
    },
    "CY-5": {
      title: "method.rule.CY-5.title",
      conditions: [
        {
          label: "method.rule.CY-5.condition.1.label",
          prompt: "method.rule.CY-5.condition.1.prompt",
        },
        {
          label: "method.rule.CY-5.condition.2.label",
          prompt: "method.rule.CY-5.condition.2.prompt",
        },
      ],
    },
    "CY-6": {
      title: "method.rule.CY-6.title",
      conditions: [
        {
          label: "method.rule.CY-6.condition.1.label",
          prompt: "method.rule.CY-6.condition.1.prompt",
        },
        {
          label: "method.rule.CY-6.condition.2.label",
          prompt: "method.rule.CY-6.condition.2.prompt",
        },
      ],
    },
    "CY-7": {
      title: "method.rule.CY-7.title",
      conditions: [
        {
          label: "method.rule.CY-7.condition.1.label",
          prompt: "method.rule.CY-7.condition.1.prompt",
        },
        {
          label: "method.rule.CY-7.condition.2.label",
          prompt: "method.rule.CY-7.condition.2.prompt",
        },
      ],
    },
    "CY-8": {
      title: "method.rule.CY-8.title",
      conditions: [
        {
          label: "method.rule.CY-8.condition.1.label",
          prompt: "method.rule.CY-8.condition.1.prompt",
        },
        {
          label: "method.rule.CY-8.condition.2.label",
          prompt: "method.rule.CY-8.condition.2.prompt",
        },
      ],
    },
  };
