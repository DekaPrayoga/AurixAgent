#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys

os.environ.setdefault("OMP_NUM_THREADS", "2")

import cv2
import numpy as np

MAX_FILE_SIZE = 20 * 1024 * 1024
SCALES = (0.9, 0.95, 1.0, 1.05, 1.1)


def fail(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def read_image(path, mode):
    if not os.path.isfile(path):
        fail(f"image not found: {path}")
    if os.path.getsize(path) > MAX_FILE_SIZE:
        fail(f"image too large: {path}")
    data = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(data, mode)
    if image is None:
        fail(f"invalid image: {path}")
    return image


def piece_geometry(image):
    if image.ndim == 3 and image.shape[2] == 4:
        alpha = image[:, :, 3]
    else:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        border = np.concatenate((gray[0], gray[-1], gray[:, 0], gray[:, -1]))
        background = int(np.median(border))
        alpha = (np.abs(gray.astype(np.int16) - background) > 12).astype(np.uint8) * 255
    ys, xs = np.where(alpha > 30)
    if len(xs) < 20:
        fail("piece mask is empty")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "width": x1 - x0, "alpha": alpha}


def local_maxima(scores, minimum_x, suppress_radius, limit):
    flat = scores.reshape(-1)
    order = np.argsort(flat)[::-1]
    picked = []
    width = scores.shape[1]
    for raw_index in order:
        score = float(flat[raw_index])
        if not math.isfinite(score):
            continue
        y, x = divmod(int(raw_index), width)
        if x < minimum_x:
            continue
        if any(abs(x - existing[0]) < suppress_radius for existing in picked):
            continue
        picked.append((x, score, y))
        if len(picked) >= limit:
            break
    return picked


def detect(background_path, piece_path, max_candidates):
    cv2.setNumThreads(2)
    background = read_image(background_path, cv2.IMREAD_COLOR)
    piece = read_image(piece_path, cv2.IMREAD_UNCHANGED)
    geo = piece_geometry(piece)
    gray = cv2.cvtColor(background, cv2.COLOR_BGR2GRAY)
    gradient = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    candidates = []

    base_mask = (geo["alpha"][geo["y0"]:geo["y1"], geo["x0"]:geo["x1"]] > 30).astype(np.float32) * 255
    if base_mask.shape[0] < 3 or base_mask.shape[1] < 3:
        fail("piece template is too small")

    for scale in SCALES:
        width = max(3, int(round(base_mask.shape[1] * scale)))
        height = max(3, int(round(base_mask.shape[0] * scale)))
        if width >= background.shape[1] or height >= background.shape[0]:
            continue
        mask = cv2.resize(base_mask, (width, height), interpolation=cv2.INTER_LINEAR)
        template = np.abs(cv2.Sobel(mask, cv2.CV_32F, 1, 0, ksize=3))
        if float(template.max()) <= 0:
            continue
        y_center = (geo["y0"] + geo["y1"]) / 2
        band_top = max(0, int(round(y_center - height / 2)))
        band_bottom = min(background.shape[0], band_top + height)
        band_top = max(0, band_bottom - height)
        band = gradient[band_top:band_bottom, :]
        if band.shape[0] != height or band.shape[1] < width:
            continue
        scores = cv2.matchTemplate(band, template, cv2.TM_CCOEFF_NORMED)
        minimum_x = max(geo["x1"], int(round(geo["width"] * 1.2)))
        for x, confidence, _ in local_maxima(scores, minimum_x, max(6, width // 2), max_candidates * 3):
            candidates.append({"gapX": int(x), "confidence": confidence, "scale": scale})

    if not candidates:
        fail("no gap candidates found")
    candidates.sort(key=lambda item: item["confidence"], reverse=True)
    merged = []
    for candidate in candidates:
        if any(abs(candidate["gapX"] - item["gapX"]) < max(5, geo["width"] // 3) for item in merged):
            continue
        merged.append(candidate)
        if len(merged) >= max_candidates:
            break
    output = {
        "ok": True,
        "method": "opencv-sobel-multicandidate",
        "backgroundWidth": int(background.shape[1]),
        "backgroundHeight": int(background.shape[0]),
        "pieceX": geo["x0"],
        "pieceWidth": geo["width"],
        "candidates": [
            {
                "gapX": item["gapX"],
                "confidence": round(float(item["confidence"]), 6),
                "scale": item["scale"],
            }
            for item in merged
        ],
    }
    print(json.dumps(output, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--background", required=True)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--max-candidates", type=int, default=5)
    args = parser.parse_args()
    detect(args.background, args.piece, min(10, max(1, args.max_candidates)))


if __name__ == "__main__":
    main()
