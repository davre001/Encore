import RequireAuth from "@/components/RequireAuth";
import Home from "@/views/Home";

export default function HomePage() {
  return (
    <RequireAuth>
      <Home />
    </RequireAuth>
  );
}
