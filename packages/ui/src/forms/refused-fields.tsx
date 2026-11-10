"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/**
 * A refused save's messages, handed to each field by its name
 * (docs/design/guided-inputs.md §4.2, plan 0.7.0 U1b).
 *
 * A form whose fields a server page draws, inside a client wrapper that holds
 * the action's state, cannot pass `error` to each field: the wrapper never
 * sees them. So the wrapper puts the refused fields here, and every kit field
 * inside reads its own message by `name`, as Base UI's `Form` does with its
 * `errors` map.
 *
 * **Nothing is lost.** Each field claims its name while it is mounted. A
 * refused field no mounted control claims, a hidden id or a nested path the
 * form does not draw, is said under the form instead, so a message the server
 * wrote always reaches the person.
 */

interface RefusedFieldsValue {
  readonly fields: Readonly<Record<string, string>>;
  readonly claim: (name: string) => () => void;
}

const RefusedFieldsContext = createContext<RefusedFieldsValue | null>(null);

export function RefusedFields({
  fields,
  children,
}: {
  /** Input path to message, as `refusedState` returns it. */
  readonly fields: Readonly<Record<string, string>> | undefined;
  readonly children: ReactNode;
}) {
  const [claimed, setClaimed] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const claim = useCallback((name: string) => {
    setClaimed((previous) => {
      const next = new Map(previous);
      next.set(name, (next.get(name) ?? 0) + 1);
      return next;
    });
    return () =>
      setClaimed((previous) => {
        const next = new Map(previous);
        const left = (next.get(name) ?? 1) - 1;
        if (left <= 0) {
          next.delete(name);
        } else {
          next.set(name, left);
        }
        return next;
      });
  }, []);
  const value = useMemo(
    () => ({ fields: fields ?? {}, claim }),
    [fields, claim],
  );
  const unclaimed = Object.entries(fields ?? {}).filter(
    ([name]) => !claimed.has(name),
  );
  return (
    <RefusedFieldsContext.Provider value={value}>
      {children}
      {unclaimed.length > 0 ? (
        <ul role="alert" className="text-xs font-medium text-bad">
          {unclaimed.map(([name, message]) => (
            <li key={name}>{message}</li>
          ))}
        </ul>
      ) : null}
    </RefusedFieldsContext.Provider>
  );
}

/**
 * This field's refusal from the nearest `RefusedFields`, if any. Claims the
 * name while the field is mounted, so the provider does not say it twice.
 */
export function useRefusedField(name: string | undefined): string | undefined {
  const context = useContext(RefusedFieldsContext);
  const claim = context?.claim;
  useLayoutEffect(() => {
    if (!claim || !name) {
      return undefined;
    }
    return claim(name);
  }, [claim, name]);
  return name ? context?.fields[name] : undefined;
}
