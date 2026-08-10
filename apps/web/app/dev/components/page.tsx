import {
  Avatar,
  AvatarStack,
  Bar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Kbd,
  VerdictDot,
} from "@openokr/ui";
import { notFound } from "next/navigation";

/**
 * The core component preview page (UIUX-PLAN.md §5: "Each gets a preview
 * page covering light and dark and every state"). Dev-only: a design
 * system's own showcase is not something a production instance needs to
 * serve, and `notFound()` outside development keeps it from adding any
 * attack surface there.
 *
 * Toggle dark mode and density from the account menu once it exists; for
 * now, `?theme=dark` and `?density=compact` on this URL work too, since
 * they just set the same `data-*` attributes the theme provider does.
 */
export default function ComponentsPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-ink">Core components</h1>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Buttons</h2>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="ai">✨ AI</Button>
          <Button variant="ghost">Ghost</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Chips</h2>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center gap-2">
          <Chip>Neutral</Chip>
          <Chip tone="ok" dot>
            On track
          </Chip>
          <Chip tone="warn" dot>
            At risk
          </Chip>
          <Chip tone="bad" dot>
            Off track
          </Chip>
          <Chip tone="info" dot>
            Info
          </Chip>
          <Chip tone="brand">Brand</Chip>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Bars</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <Bar value={72} />
          <Bar value={90} tone="ok" />
          <Bar value={45} tone="warn" />
          <Bar value={12} tone="bad" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Verdict dots</h2>
        </CardHeader>
        <CardBody className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <VerdictDot state="pass" /> Pass
          </span>
          <span className="flex items-center gap-1.5">
            <VerdictDot state="warn" /> Warning
          </span>
          <span className="flex items-center gap-1.5">
            <VerdictDot state="fail" /> Fail
          </span>
          <span className="flex items-center gap-1.5">
            <VerdictDot state="todo" /> Not checked
          </span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Avatars</h2>
        </CardHeader>
        <CardBody className="flex items-center gap-4">
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Grace Hopper" />
          <Avatar name="Alan Turing" size="lg" />
          <AvatarStack>
            <Avatar name="Ada Lovelace" />
            <Avatar name="Grace Hopper" />
            <Avatar name="Alan Turing" />
          </AvatarStack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">Keys</h2>
        </CardHeader>
        <CardBody className="flex items-center gap-2">
          <Kbd>⌘K</Kbd>
          <Kbd>?</Kbd>
          <Kbd>Esc</Kbd>
        </CardBody>
      </Card>
    </div>
  );
}
