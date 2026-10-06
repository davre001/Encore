import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app.dependencies import get_user_id
from app.routes import videos


class ChunkedUploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.patches = [
            patch.object(videos.storage, "UPLOAD_DIR", self.directory.name),
            patch.object(videos.storage, "ensure_dirs"),
            patch.object(videos, "_save_video_record", side_effect=self.capture),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.saved = None
        app = FastAPI()
        app.include_router(videos.router, prefix="/api/videos")
        app.dependency_overrides[get_user_id] = lambda: "user_test"
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def capture(self, *, src_path, filename, user_id):
        with open(src_path, "rb") as source:
            self.saved = source.read()
        return {"id": "vid_test", "name": filename, "duration": 1, "createdAt": 1}

    async def start(self, indexed=True):
        params = {"filename": "test.mp4"}
        if indexed:
            params.update(size=10, chunk_size=4)
        response = await self.client.post("/api/videos/chunked/start", params=params)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["parallelChunks"], indexed)
        return "/api/videos/chunked/" + response.json()["uploadId"]

    async def test_out_of_order_parallel_chunks_and_retry(self):
        base = await self.start()
        responses = await asyncio.gather(*[
            self.client.post(base + "/chunk", params={"index": index}, content=content)
            for index, content in [(2, b"ij"), (0, b"abcd"), (1, b"efgh"), (1, b"efgh")]
        ])
        self.assertTrue(all(item.status_code == 200 for item in responses))
        result = await self.client.post(base + "/finish", params={"filename": "test.mp4"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.saved, b"abcdefghij")
        self.assertEqual(len(os.listdir(self.directory.name)), 1)

    async def test_incomplete_upload_cannot_finish(self):
        base = await self.start()
        await self.client.post(base + "/chunk", params={"index": 0}, content=b"abcd")
        response = await self.client.post(base + "/finish")
        self.assertEqual(response.status_code, 409)
        self.assertIsNone(self.saved)
        for index, content in [(1, b"efgh"), (2, b"ij")]:
            await self.client.post(base + "/chunk", params={"index": index}, content=content)
        response = await self.client.post(base + "/finish", params={"filename": "test.mp4"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.saved, b"abcdefghij")

    async def test_invalid_chunk_rejected(self):
        base = await self.start()
        for index, content in [(3, b"abcd"), (0, b"x"), (-1, b"abcd")]:
            response = await self.client.post(base + "/chunk", params={"index": index}, content=content)
            self.assertEqual(response.status_code, 400)

    async def test_legacy_sequential_client_still_works(self):
        base = await self.start(indexed=False)
        for index, content in enumerate([b"abcd", b"efgh", b"ij"]):
            response = await self.client.post(base + "/chunk", params={"index": index}, content=content)
            self.assertEqual(response.status_code, 200)
        response = await self.client.post(base + "/finish", params={"filename": "test.mp4"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.saved, b"abcdefghij")


if __name__ == "__main__":
    unittest.main()
