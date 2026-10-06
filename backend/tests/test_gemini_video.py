import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx

from app.services import gemini


class VideoAnalysisTests(unittest.TestCase):
    def setUp(self):
        gemini.clear_last_error()
        self.url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"models/{gemini.GEMINI_MODEL_VIDEO}:generateContent"
        )
        self.file_record = {"uri": "https://example.com/video", "mimeType": "video/mp4"}
        self.moments = {
            "moments": [{"start": 4, "end": 15, "label": "The reveal", "reason": "Payoff", "score": 95}]
        }

    def response(self, status, payload):
        return httpx.Response(status, request=httpx.Request("POST", self.url), json=payload)

    def success(self):
        return self.response(
            200, {"candidates": [{"content": {"parts": [{"text": json.dumps(self.moments)}]}}]}
        )

    def generate(self):
        return gemini._generate_json_from_video_file(
            file_record=self.file_record, prompt="Find the best moments", schema={"type": "object"}
        )

    def test_video_pipeline_uses_generate_content_directly(self):
        with (
            patch.object(gemini.ffmpeg, "analysis_proxy", return_value="source.mp4"),
            patch.object(gemini, "_upload_video_file", return_value=self.file_record),
            patch.object(gemini, "_wait_file_active", return_value=self.file_record),
            patch.object(gemini.httpx, "post", return_value=self.success()) as post,
        ):
            result = gemini.propose_video_moments("source.mp4", [], 30)
        self.assertEqual(result[0]["score"], 95)
        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], self.url)
        part = post.call_args.kwargs["json"]["contents"][0]["parts"][0]
        self.assertEqual(part["file_data"]["file_uri"], self.file_record["uri"])
        self.assertEqual(part["media_processing"], "AGENTIC")

    def test_temporary_503_recovers_and_clears_error(self):
        with (
            patch.object(gemini.httpx, "post", side_effect=[
                self.response(503, {"error": {"message": "Service unavailable"}}), self.success()
            ]) as post,
            patch.object(gemini, "_sleep_before_retry") as backoff,
        ):
            result = self.generate()
        self.assertEqual(result, self.moments)
        self.assertEqual(post.call_count, 2)
        backoff.assert_called_once_with(0)
        self.assertIsNone(gemini.last_error())

    def test_persistent_503_stops_after_three_attempts(self):
        with (
            patch.object(gemini.httpx, "post", return_value=self.response(
                503, {"error": {"message": "Connection capacity exhausted"}}
            )) as post,
            patch.object(gemini, "_sleep_before_retry"),
        ):
            self.assertIsNone(self.generate())
        self.assertEqual(post.call_count, 3)
        self.assertEqual(gemini.last_error(), {"errorType": "api", "message": "API error"})

    def test_authentication_failure_is_not_retried(self):
        with patch.object(gemini.httpx, "post", return_value=self.response(
            403, {"error": {"message": "API key not allowed"}}
        )) as post:
            self.assertIsNone(self.generate())
        post.assert_called_once()

    def test_blank_timeouts_are_identified_by_exception_type(self):
        for error in (httpx.ConnectTimeout(""), httpx.ReadTimeout("")):
            self.assertEqual(gemini._classify_error(error)["errorType"], "timeout")

    def test_ai_network_error_does_not_blame_browser_connection(self):
        self.assertEqual(
            gemini._classify_error(httpx.ConnectError("DNS failed")),
            {"errorType": "network", "message": "AI connection error"},
        )

    def test_video_worker_error_is_isolated_from_chat_error(self):
        entered = threading.Event()
        release = threading.Event()

        def worker():
            gemini._set_error(httpx.ConnectError("DNS failed"), "test")
            entered.set()
            release.wait(5)
            return gemini.last_error()

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(worker)
            try:
                self.assertTrue(entered.wait(5))
                gemini._set_error(RuntimeError("429 too many requests"), "test")
            finally:
                release.set()
            self.assertEqual(future.result()["errorType"], "network")
        self.assertEqual(gemini.last_error()["errorType"], "quota")


if __name__ == "__main__":
    unittest.main()
