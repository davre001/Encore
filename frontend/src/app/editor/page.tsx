import RequireAuth from "@/components/RequireAuth";
import Editor from "@/views/Editor";

export default function EditorPage() {
  return (
    <RequireAuth>
      <Editor />
    </RequireAuth>
  );
}
