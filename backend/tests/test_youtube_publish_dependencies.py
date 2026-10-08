import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routes import posts
from app.services import youtube


class YouTubeDependencyTests(unittest.TestCase):
    def test_standard_install_has_all_upload_dependencies(self):
        for name in ("Request", "Credentials", "build", "MediaFileUpload"):
            self.assertIsNotNone(getattr(youtube, name), f"Missing YouTube dependency: {name}")


class YouTubePublishFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_unavailable_publishing_logs_reason_without_marking_posted(self):
        detail = "YouTube upload dependencies are not installed."
        with (
            patch.object(posts.storage, "get_clip", return_value={"id": "clip_test", "userId": "user_test"}),
            patch.object(posts.youtube, "connected", return_value=True),
            patch.object(posts, "_upload_path_for_clip", return_value="test.mp4"),
            patch.object(posts.youtube, "publish", side_effect=RuntimeError(detail)),
            patch.object(posts.storage, "update_clip") as update,
            self.assertLogs("uvicorn.error.encore.posts", level="ERROR") as logs,
        ):
            with self.assertRaises(HTTPException) as caught:
                await posts.publish_clip("clip_test", "user_test")
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(caught.exception.detail, detail)
            self.assertIn(detail, logs.output[0])
            update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
