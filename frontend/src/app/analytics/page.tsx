import RequireAuth from "@/components/RequireAuth";
import Analytics from "@/views/Analytics";

export default function AnalyticsPage() {
  return (
    <RequireAuth>
      <Analytics />
    </RequireAuth>
  );
}
