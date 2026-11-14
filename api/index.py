import asyncio
import json
import os
import sys
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import (
    APIRouter,
    FastAPI,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from ml.dataset import analyze_csv
from ml.features import DEFINITIONS, REFERENCES, extract_features
from ml.model import TRAIN_LOCK, load_production, predict
from ml.scanner import scan_online, unavailable

APP_VERSION = "1.0.1"
router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"]
    backend: Literal["fastapi"]
    app_version: str
    model_status: Literal["available", "unavailable"]
    model_available: bool
    model_version: str | None
    report: dict | None = None


def allowed_origins():
    origins = []
    for value in os.getenv("ALLOWED_ORIGINS", "").split(","):
        origin = value.strip().rstrip("/")
        if not origin:
            continue
        try:
            parsed = urlsplit(origin)
            valid = (
                parsed.scheme in ("http", "https")
                and parsed.hostname
                and parsed.netloc
                and parsed.path == ""
                and not parsed.query
                and not parsed.fragment
                and parsed.username is None
                and parsed.password is None
                and "*" not in origin
                and not any(c.isspace() for c in origin)
                and (parsed.port is None or 1 <= parsed.port <= 65535)
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError(
                "ALLOWED_ORIGINS must contain explicit HTTP(S) origins without paths or credentials"
            )
        origins.append(origin)
    return origins


class Limits:
    """Bound body before multipart parsing; local rate limits are per instance.

    Configure Vercel Firewall limits as well for distributed abuse protection.
    Do not trust caller-supplied forwarding headers for client identification.
    """

    def __init__(self, application):
        self.app = application
        self.requests = OrderedDict()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        now = time.monotonic()
        client = scope.get("client") or ("unknown", 0)
        key = client[0]
        bucket = [(t, p) for t, p in self.requests.pop(key, []) if now - t < 60]
        path = scope["path"]
        costly = path in ("/api/train", "/api/experiment", "/api/evaluate")
        if len(bucket) >= 30 or (costly and sum(p for _, p in bucket) >= 3):
            return await self.error(
                send, 429, "Rate limit reached; retry in one minute"
            )
        self.requests[key] = bucket + [(now, int(costly))]
        if len(self.requests) > 4096:
            self.requests.popitem(last=False)
        chunks, size = [], 0
        if scope["method"] == "POST":
            try:
                async with asyncio.timeout(10):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        data = message.get("body", b"")
                        size += len(data)
                        if size > 2_100_000:
                            return await self.error(
                                send, 413, "Request exceeds 2 MB dataset limit"
                            )
                        chunks.append(data)
                        if not message.get("more_body"):
                            break
            except TimeoutError:
                return await self.error(send, 408, "Request upload timed out")
            body = b"".join(chunks)
            delivered = False
            original_receive = receive

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await original_receive()

            receive = replay
        await self.app(scope, receive, send)

    async def error(self, send, status, detail):
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"retry-after", b"60"),
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": json.dumps({"detail": detail}).encode(),
            }
        )


class URLRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=4096)


def extraction(value):
    try:
        return extract_features(value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/api/health", response_model=HealthResponse)
def health(response: Response):
    response.headers["Cache-Control"] = "no-store"
    bundle, metadata = load_production()
    return {
        "status": "ok",
        "backend": "fastapi",
        "app_version": APP_VERSION,
        "model_status": "available" if bundle is not None else "unavailable",
        "model_available": bundle is not None,
        "model_version": bundle["model_version"] if bundle else None,
        "report": metadata["report"] if metadata else None,
    }


@router.post("/api/features")
def features(body: URLRequest):
    return {
        **extraction(body.url),
        "definitions": DEFINITIONS,
        "reference_domains": list(REFERENCES),
    }


@router.post("/api/predict")
def prediction(body: URLRequest):
    extracted = extraction(body.url)
    bundle, _ = load_production()
    return {
        **extracted,
        **predict(extracted, bundle),
        "definitions": DEFINITIONS,
        "reference_domains": list(REFERENCES),
    }


@router.post("/api/scan")
async def scan(body: URLRequest, request: Request):
    started = time.monotonic()
    extracted = extraction(body.url)
    slots = request.app.state.scan_slots
    try:
        async with asyncio.timeout(0.2):
            await slots.acquire()
    except TimeoutError:
        online = unavailable("Scanner capacity reached; retry later", "scanner_busy")
    else:
        try:
            online = await scan_online(extracted["url"])
        finally:
            slots.release()
    bundle, _ = await run_in_threadpool(load_production)
    final = extraction(online["final_url"]) if online["final_url"] else None
    return {
        **extracted,
        **predict(extracted, bundle),
        "online": online,
        "input_url": body.url,
        "definitions": DEFINITIONS,
        "reference_domains": list(REFERENCES),
        "scan_duration_ms": round((time.monotonic() - started) * 1000),
        "final_destination": final,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prediction_target": "original normalized URL; online metadata is not a model input",
    }


@router.post("/api/dataset/analyze")
async def dataset(file: UploadFile = File(...)):
    try:
        _, summary, _ = await run_in_threadpool(
            analyze_csv, await file.read(), file.filename
        )
        return summary
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        await file.close()


@router.post("/api/train")
@router.post("/api/experiment")
@router.post("/api/evaluate")
async def train(file: UploadFile = File(...), seed: int = 42, n_estimators: int = 100):
    # Evaluation is deliberately stateless: rerun the specified reproducible
    # experiment, never accept user-provided metric values as evaluation evidence.
    if not 0 <= seed <= 2147483617 or not 20 <= n_estimators <= 150:
        raise HTTPException(
            422, "seed must be 0–2147483617; n_estimators must be 20–150"
        )
    if not TRAIN_LOCK.acquire(blocking=False):
        raise HTTPException(429, "An experiment is running on this instance; try later")
    try:
        raw = await file.read()
        worker_env = {
            **os.environ,
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
        }
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "ml.worker",
            (file.filename or "dataset.csv")[:120],
            str(seed),
            str(n_estimators),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=str(Path(__file__).resolve().parents[1]),
            env=worker_env,
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(raw), timeout=40)
        except (TimeoutError, asyncio.CancelledError) as exc:
            process.kill()
            await process.wait()
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise HTTPException(
                408,
                "Training exceeded 40 seconds. Use python -m ml.train_local locally.",
            ) from None
        try:
            result = json.loads(output)
        except ValueError:
            raise HTTPException(
                500,
                "Experiment worker failed; use local training to inspect the dataset",
            ) from None
        if process.returncode != 0 or "error" in result:
            raise HTTPException(
                422, result.get("error", "Training failed; use local training")
            )
        return result["report"]
    finally:
        TRAIN_LOCK.release()
        await file.close()


def create_app():
    application = FastAPI(title="UMMU URL GUARD", version=APP_VERSION)
    application.state.scan_slots = asyncio.Semaphore(4)
    application.include_router(router)
    application.add_middleware(Limits)
    # CORS is outermost so upload/rate-limit errors also reach allowed clients.
    origins = allowed_origins()
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
            allow_credentials=False,
        )
    return application


app = create_app()
