import unittest
from unittest.mock import patch

from app.routes import videos


class AnalysisRecoveryTests(unittest.TestCase):
    def test_provider_network_failure_keeps_job_alive_and_reuses_transcript(self):
        clock = [0]
        with (
            patch.object(videos.time, "monotonic", side_effect=lambda: clock[0]),
            patch.object(videos.time, "sleep", side_effect=lambda _: clock.__setitem__(0, clock[0] + 65)),
            patch.object(videos.transcribe, "transcribe_words", return_value=[]) as transcript,
            patch.object(videos.analyze, "find_moments", side_effect=[[], [], [], [{"id": "mom_test"}]]) as analyze,
            patch.object(videos.gemini, "last_error", side_effect=lambda: {"errorType": "network", "message": "AI connection error"} if analyze.call_count < 4 else None),
            patch.object(videos.storage, "save_analysis_status") as status,
            patch.object(videos.storage, "save_moments"),
        ):
            videos._propose_moments("vid_recovery_test", "source.mp4", 60)
        transcript.assert_called_once()
        self.assertEqual(analyze.call_count, 4)
        updates = [call.args[1] for call in status.call_args_list]
        self.assertIn("This is taking longer than usual.", [row["message"] for row in updates])
        self.assertIn("Connection error, check your network.", [row["message"] for row in updates])
        self.assertEqual(updates[-1]["stage"], "complete")
        self.assertTrue(updates[-1]["done"])
        self.assertFalse(any(row["stage"] == "error" for row in updates))


if __name__ == "__main__":
    unittest.main()
