import { Card, CardBody } from "@openokr/ui";
import Link from "next/link";

export default function MemberNotFound() {
  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <h1 className="text-base font-bold text-ink">Member not found</h1>
          <p className="text-sm text-ink-3">
            This person does not exist in this workspace, or you do not have
            access to see them.
          </p>
          <Link
            href="/people"
            className="text-sm font-semibold text-brand-text hover:underline"
          >
            Back to the directory
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
