import { Suspense } from "react";
import { AuthPage } from "@/components/AuthPage";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}
