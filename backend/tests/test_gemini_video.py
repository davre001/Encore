import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import patch

import httpx

from app.services import gemini
from app.models.schemas import AnalysisStatus


class VideoAnalysisTests(unittest.TestCase):
    def setUp(self):
        gemini.clear_last_error()
        self.url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"models/{gemini.GEMINI_MODEL_VIDEO}:streamGenerateContent?alt=sse"
        )
        self.file_record = {"uri": "https://example.com/video", "mimeType": "video/mp4"}
        self.moments = {
            "moments": [{"start": 4, "end": 15, "label": "The reveal", "reason": "Payoff", "score": 95}]
        }

    def response(self, status, payload):
        return httpx.Response(status, request=httpx.Request("POST", self.url), json=payload)

    def success(self):
        text = json.dumps(self.moments)
        chunks = [text[:20], text[20:]]
        events = [
            {"candidates": [{"content": {"parts": [{"thought": True, "text": "Hidden reasoning"}]}}]},
            *[{"candidates": [{"content": {"parts": [{"text": chunk}]}}]} for chunk in chunks],
        ]
        return httpx.Response(
            200, request=httpx.Request("POST", self.url),
            content="".join(f"data: {json.dumps(event)}\n\n" for event in events),
            headers={"Content-Type": "text/event-stream"},
        )

    @contextmanager
    def stream(self, response):
        try:
            yield response
        finally:
            response.close()

    def generate(self):
        return gemini._generate_json_from_video_file(
            file_record=self.file_record, prompt="Find the best moments", schema={"type": "object"}
        )

    def test_video_pipeline_uses_generate_content_directly(self):
        with (
            patch.object(gemini.ffmpeg, "analysis_proxy", return_value="source.mp4"),
            patch.object(gemini, "_upload_video_file", return_value=self.file_record),
            patch.object(gemini, "_wait_file_active", return_value=self.file_record),
            patch.object(gemini.httpx, "stream", side_effect=lambda *a, **kw: self.stream(self.success())) as post,
        ):
            result = gemini.propose_video_moments("source.mp4", [], 30)
        self.assertEqual(result[0]["score"], 95)
        post.assert_called_once()
        self.assertEqual(post.call_args.args, ("POST", self.url))
        part = post.call_args.kwargs["json"]["contents"][0]["parts"][0]
        self.assertEqual(part["file_data"]["file_uri"], self.file_record["uri"])
        self.assertEqual(part["media_processing"], "STATIC")

    def test_temporary_503_recovers_and_clears_error(self):
        with (
            patch.object(gemini.httpx, "stream", side_effect=[
                self.stream(self.response(503, {"error": {"message": "Service unavailable"}})),
                self.stream(self.success())
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
            patch.object(gemini.httpx, "stream", side_effect=lambda *a, **kw: self.stream(self.response(
                503, {"error": {"message": "Connection capacity exhausted"}}
            ))) as post,
            patch.object(gemini, "_sleep_before_retry"),
        ):
            self.assertIsNone(self.generate())
        self.assertEqual(post.call_count, 3)
        self.assertEqual(gemini.last_error(), {"errorType": "api", "message": "API error"})

    def test_authentication_failure_is_not_retried(self):
        with patch.object(gemini.httpx, "stream", side_effect=lambda *a, **kw: self.stream(self.response(
            403, {"error": {"message": "API key not allowed"}}
        ))) as post:
            self.assertIsNone(self.generate())
        post.assert_called_once()

    def test_long_video_retains_agentic_review(self):
        with (
            patch.object(gemini.ffmpeg, "analysis_proxy", return_value="source.mp4"),
            patch.object(gemini, "_upload_video_file", return_value=self.file_record),
            patch.object(gemini, "_wait_file_active", return_value=self.file_record),
            patch.object(gemini.httpx, "stream", side_effect=lambda *a, **kw: self.stream(self.success())) as stream,
        ):
            gemini.propose_video_moments("source.mp4", [], 600)
        part = stream.call_args.kwargs["json"]["contents"][0]["parts"][0]
        self.assertEqual(part["media_processing"], "AGENTIC")

    def test_pipeline_reports_each_review_phase(self):
        updates = []
        with (
            patch.object(gemini.ffmpeg, "analysis_proxy", return_value="source.mp4"),
            patch.object(gemini, "_upload_video_file", return_value=self.file_record),
            patch.object(gemini, "_wait_file_active", return_value=self.file_record),
            patch.object(gemini.httpx, "stream", side_effect=lambda *a, **kw: self.stream(self.success())),
        ):
            result = gemini.propose_video_moments("source.mp4", [], 43, lambda text, p: updates.append(p))
        self.assertTrue(result)
        self.assertEqual(updates[:4], [48, 54, 60, 68])

    def test_status_api_preserves_review_progress(self):
        status = AnalysisStatus.model_validate({
            "videoId": "vid_test", "stage": "watching", "message": "Sending the video for analysis.",
            "updatedAt": 1, "progress": 54,
        })
        self.assertEqual(status.model_dump(by_alias=True)["progress"], 54)

    def test_exhausted_review_deadline_finishes_with_timeout(self):
        with (
            patch.object(gemini.time, "monotonic", side_effect=[0.0, 181.0]),
            patch.object(gemini.httpx, "stream") as stream,
        ):
            self.assertIsNone(self.generate())
        stream.assert_not_called()
        self.assertEqual(gemini.last_error()["errorType"], "timeout")

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
