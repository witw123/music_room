import { redirect } from "next/navigation";
import type { Route } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SearchPage() {
  redirect("/app/discover?search=1" as Route);
}
