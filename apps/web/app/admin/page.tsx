import { redirect } from "next/navigation";

/** `/admin` has no card of its own; the general card is the first one. */
export default function AdminIndexPage() {
  redirect("/admin/general");
}
