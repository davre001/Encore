import RequireAuth from "@/components/RequireAuth";
import Profile from "@/views/Profile";

export default function ProfilePage() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}
