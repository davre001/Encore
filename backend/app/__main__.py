"""Run the API directly:  python -m app

Binds config.HOST:config.PORT (default 127.0.0.1:5000). Equivalent to
`uvicorn app.main:app --host 127.0.0.1 --port 5000`; the uvicorn CLI is still
available if you want --reload/--workers.
"""

import uvicorn

from .config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=HOST, port=PORT)
