import RequireAuth from "@/components/RequireAuth";
import Settings from "@/views/Settings";

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}
