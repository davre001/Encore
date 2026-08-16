import UploadPanel from "./components/UploadPanel.jsx";
import MessageThread from "./components/MessageThread.jsx";
import MomentList from "./components/MomentList.jsx";
import ClipList from "./components/ClipList.jsx";
import PostStatus from "./components/PostStatus.jsx";

export default function App() {
  return (
    <main>
      <UploadPanel />
      <MessageThread />
      <MomentList />
      <ClipList />
      <PostStatus />
    </main>
  );
}
