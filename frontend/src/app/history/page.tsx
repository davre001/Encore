import RequireAuth from "@/components/RequireAuth";
import History from "@/views/History";

export default function HistoryPage() {
  return (
    <RequireAuth>
      <History />
    </RequireAuth>
  );
}
