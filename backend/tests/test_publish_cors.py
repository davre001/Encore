import unittest

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS


class PublishCorsTests(unittest.IsolatedAsyncioTestCase):
    async def preflight(self, origin):
        app = FastAPI()
        app.add_middleware(
            CORSMiddleware, allow_origins=CORS_ORIGINS,
            allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test",
        ) as client:
            return await client.options("/api/posts/clip_test", headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization",
            })

    async def test_deployed_frontend_can_publish_with_bearer_token(self):
        origin = "https://encore-dun-eight.vercel.app"
        response = await self.preflight(origin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertIn("authorization", response.headers["access-control-allow-headers"])

    async def test_untrusted_site_is_rejected(self):
        response = await self.preflight("https://untrusted.example")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
