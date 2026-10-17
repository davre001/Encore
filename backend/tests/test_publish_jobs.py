import asyncio
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import httpx
from fastapi import FastAPI

from app import storage
from app.dependencies import get_user_id
from app.routes import posts
from app.services import youtube


class PublishJobTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_rejoin_does_not_duplicate_publish_and_status_is_responsive(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(storage, "DATA_DIR", directory),
            patch.object(storage, "UPLOAD_DIR", directory),
            patch.object(posts, "_upload_path_for_clip", return_value="test.mp4"),
            patch.object(posts.youtube, "connected", return_value=True),
            patch.object(posts, "_upsert_post_analytics"),
            patch.object(posts, "_update_project_from_post"),
        ):
            storage.save_clip({"id": "clip_job_test", "videoId": "vid_test", "userId": "user_test"})
            app = FastAPI()
            app.include_router(posts.router, prefix="/api/posts")
            app.dependency_overrides[get_user_id] = lambda: "user_test"
            entered = threading.Event()
            release = threading.Event()

            def upload(*args, **kwargs):
                entered.set()
                release.wait(5)
                kwargs["on_progress"]("uploading", "Uploading.", 50)
                return {"postId": "yt_test", "postUrl": "https://youtube.com/shorts/yt_test"}

            with patch.object(posts.youtube, "publish", side_effect=upload) as publisher:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    base = "/api/posts/clip_job_test/job"
                    response = await client.post(base)
                    self.assertEqual(response.status_code, 202)
                    for _ in range(100):
                        if entered.is_set():
                            break
                        await asyncio.sleep(0.01)
                    self.assertTrue(entered.is_set())
                    try:
                        response = await asyncio.wait_for(client.get(base), timeout=0.5)
                        self.assertFalse(response.json()["done"])
                        await client.post(base)  # Reconnect after losing the original response.
                        self.assertEqual(publisher.call_count, 1)
                    finally:
                        release.set()
                    for _ in range(100):
                        result = (await client.get(base)).json()
                        if result["done"]:
                            break
                        await asyncio.sleep(0.01)
                    self.assertEqual(result["postId"], "yt_test")
                    await client.post(base)
                    legacy = await client.post("/api/posts/clip_job_test")
                    self.assertEqual(legacy.json()["postId"], "yt_test")
                    self.assertEqual(publisher.call_count, 1)
                    app.dependency_overrides[get_user_id] = lambda: "someone_else"
                    self.assertEqual((await client.get(base)).status_code, 404)
                    app.dependency_overrides[get_user_id] = lambda: "user_test"
                    storage.save_clip({"id": "clip_cancel_test", "videoId": "vid_test", "userId": "user_test"})
                    entered.clear()
                    release.clear()
                    cancel_base = "/api/posts/clip_cancel_test/job"
                    await client.post(cancel_base)
                    for _ in range(100):
                        if entered.is_set():
                            break
                        await asyncio.sleep(0.01)
                    try:
                        cancelled = await client.post(cancel_base + "/cancel")
                        self.assertTrue(cancelled.json()["cancelRequested"])
                    finally:
                        release.set()
                    for _ in range(100):
                        result = (await client.get(cancel_base)).json()
                        if result["done"]:
                            break
                        await asyncio.sleep(0.01)
                    self.assertEqual(result["message"], "Stopped by user.")
                    self.assertTrue(result["cancelRequested"])
                    self.assertFalse(storage.get_clip("clip_cancel_test").get("posted", False))


class ResumableYouTubeTests(unittest.TestCase):
    def test_network_failure_reuses_same_google_upload_request(self):
        request = MagicMock()
        progress = MagicMock()
        progress.progress.return_value = 0.5
        request.next_chunk.side_effect = [(progress, None), OSError("Network unreachable"), (None, {"id": "yt_test"})]
        service = MagicMock()
        service.videos.return_value.insert.return_value = request
        updates = []
        with (
            patch.object(youtube, "_refresh_token_for_user", return_value="test-token"),
            patch.object(youtube, "YOUTUBE_CLIENT_ID", "test-client"),
            patch.object(youtube, "YOUTUBE_CLIENT_SECRET", "test-secret"),
            patch.object(youtube.os.path, "exists", return_value=True),
            patch.object(youtube, "MediaFileUpload") as media,
            patch.object(youtube, "_service", return_value=service),
            patch.object(youtube.time, "sleep"),
        ):
            result = youtube.publish({"title": "Test cut"}, "test.mp4", "user_test", lambda *args: updates.append(args))
        self.assertEqual(result["postId"], "yt_test")
        service.videos.return_value.insert.assert_called_once()
        self.assertEqual(request.next_chunk.call_count, 3)
        self.assertEqual(media.call_args.kwargs["chunksize"], 2 * 1024 * 1024)
        self.assertTrue(any(row[0] == "reconnecting" for row in updates))


if __name__ == "__main__":
    unittest.main()
