import { PendingActionDetail } from "@/components/PendingActionDetail";

export default function PendingActionDetailPage({ params }: { params: { id: string } }) {
  return <PendingActionDetail id={params.id} />;
}
