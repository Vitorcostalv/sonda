import { Suspense } from "react";
import { CompareView } from "@/components/compare";
export default function Page() {
  return (
    <Suspense>
      <CompareView />
    </Suspense>
  );
}
