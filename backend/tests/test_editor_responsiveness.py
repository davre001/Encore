import asyncio
import threading
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app.dependencies import get_user_id
from app.routes import messages, videos


class EditorResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_analysis_poll_responds_while_chat_ai_is_busy(self):
        app = FastAPI()
        app.include_router(messages.router, prefix="/api/messages")
        app.include_router(videos.router, prefix="/api/videos")
        app.dependency_overrides[get_user_id] = lambda: "user_test"
        entered = threading.Event()
        release = threading.Event()

        def slow_reply(**kwargs):
            entered.set()
            release.wait(3)
            return "Ready."

        def saved_message(**kwargs):
            return {"id": "msg_test", "createdAt": 1, **kwargs}

        status = {
            "videoId": "vid_test", "stage": "complete", "message": "Found 1 standout moment.",
            "updatedAt": 1, "done": True,
        }
        with (
            patch.object(messages.minds, "save_chat_message", side_effect=saved_message),
            patch.object(messages.minds, "get_persistent_memories", return_value=[]),
            patch.object(messages, "_merged_history", return_value=[]),
            patch.object(messages, "_video_for_thread", return_value="vid_test"),
            patch.object(messages, "_latest_check", return_value=None),
            patch.object(messages, "_editor_context", return_value=""),
            patch.object(messages.gemini, "available", return_value=True),
            patch.object(messages.gemini, "chat_reply", side_effect=slow_reply),
            patch.object(messages.storage, "save_message"),
            patch.object(videos.storage, "get_video", return_value={"userId": "user_test"}),
            patch.object(videos.storage, "get_analysis_status", return_value=status),
            patch.object(videos.storage, "list_moments", return_value=[]),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                chat = asyncio.create_task(client.post(
                    "/api/messages", json={"threadId": "proj_test", "text": "hello"}
                ))
                try:
                    for _ in range(100):
                        if entered.is_set():
                            break
                        await asyncio.sleep(0.01)
                    self.assertTrue(entered.is_set())
                    self.assertFalse(chat.done(), "Chat must still be busy while status is checked")
                    response = await asyncio.wait_for(
                        client.get("/api/videos/vid_test/analysis"), timeout=0.5
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()["done"])
                finally:
                    release.set()
                    reply = await chat
                self.assertEqual(reply.status_code, 200)
                self.assertEqual(reply.json()["text"], "Ready.")


if __name__ == "__main__":
    unittest.main()
