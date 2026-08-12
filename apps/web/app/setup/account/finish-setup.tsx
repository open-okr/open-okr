"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "../../(auth)/auth-card.tsx";
import { finishSetup } from "./actions";

/**
 * Recovering an interrupted wizard (P1-T09).
 *
 * Shown when an account exists but completion was never recorded. Only the
 * last step remains, so this is a button rather than a form.
 */
export function FinishSetup() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const finish = async () => {
    setError("");
    setPending(true);
    const result = await finishSetup({ instanceName: "" });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="primary"
        onClick={finish}
        disabled={pending}
        className="self-start"
      >
        {pending ? "Finishing…" : "Finish setup"}
      </Button>
      <FormError>{error}</FormError>
    </>
  );
}
