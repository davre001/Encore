import os
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from app.services import ffmpeg


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires ffmpeg and ffprobe")
class AnalysisProxyTests(unittest.TestCase):
    def test_review_copy_is_smaller_and_preserves_duration_and_shape(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(ffmpeg, "UPLOAD_DIR", directory):
            source = os.path.join(directory, "source.mp4")
            subprocess.run([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
                "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", source,
            ], check=True, timeout=30)
            # Padding keeps this tiny valid fixture above the review-size threshold.
            with open(source, "ab") as out:
                out.write(b"\0" * (13 * 1024 * 1024))
            proxy = ffmpeg.analysis_proxy(source)
            self.assertNotEqual(proxy, source)
            self.assertLess(os.path.getsize(proxy), os.path.getsize(source))
            self.assertAlmostEqual(ffmpeg.probe_duration(proxy), 2, delta=0.15)
            self.assertEqual(ffmpeg.probe_dimensions(proxy), (768, 432))
            with patch.object(ffmpeg.subprocess, "run", side_effect=AssertionError("Must reuse review copy")):
                self.assertEqual(ffmpeg.analysis_proxy(source), proxy)


if __name__ == "__main__":
    unittest.main()
