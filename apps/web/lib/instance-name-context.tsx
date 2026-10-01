"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * What this instance calls itself, for a client component (completeness
 * review M-33).
 *
 * The root layout resolves the name on the server, where the one reader is,
 * and hands it down here. A client component such as the sign-in page cannot
 * ask the database, and passing the name through every page's props would
 * mean every page remembering to.
 *
 * The default is the software's own name, which is what a component rendered
 * outside the root layout should say. The literal is repeated here rather
 * than imported, because the constant lives in `packages/core`, which a
 * client bundle must not pull in.
 */
const InstanceNameContext = createContext("OpenOKR");

export function InstanceNameProvider({
  name,
  children,
}: {
  readonly name: string;
  readonly children: ReactNode;
}) {
  return (
    <InstanceNameContext.Provider value={name}>
      {children}
    </InstanceNameContext.Provider>
  );
}

export function useInstanceName(): string {
  return useContext(InstanceNameContext);
}
