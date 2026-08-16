import os

from dotenv import load_dotenv

load_dotenv()

MINDS_BUILDER_API_KEY = os.getenv("MINDS_BUILDER_API_KEY", "")
MINDS_ID = os.getenv("MINDS_ID", "")
YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN", "")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "../uploads")
DATA_DIR = os.getenv("DATA_DIR", "../data")
