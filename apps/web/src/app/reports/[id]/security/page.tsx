import { Suspense } from "react";
import { Report } from "@/components/report";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <Report id={id} securityOnly />
    </Suspense>
  );
}
