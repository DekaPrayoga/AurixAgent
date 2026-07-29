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
        color = image[:, :, :3] if image.ndim == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        border = np.concatenate((color[0], color[-1], color[:, 0], color[:, -1]), axis=0)
        background = np.median(border, axis=0)
        distance = np.linalg.norm(color.astype(np.float32) - background.astype(np.float32), axis=2)
        alpha = (distance > 35).astype(np.uint8) * 255
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


def detect(background_path, piece_path, max_candidates, rendered_geometry=None):
    cv2.setNumThreads(2)
    background = read_image(background_path, cv2.IMREAD_COLOR)
    piece = read_image(piece_path, cv2.IMREAD_UNCHANGED)
    geo = piece_geometry(piece)
    gray = cv2.cvtColor(background, cv2.COLOR_BGR2GRAY)
    gradient_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = cv2.magnitude(gradient_x, gradient_y)
    candidates = []

    base_mask = (geo["alpha"][geo["y0"]:geo["y1"], geo["x0"]:geo["x1"]] > 30).astype(np.float32) * 255
    if base_mask.shape[0] < 3 or base_mask.shape[1] < 3:
        fail("piece template is too small")

    target_width = base_mask.shape[1]
    target_height = base_mask.shape[0]
    piece_top = geo["y0"]
    if rendered_geometry:
        rendered_width = rendered_geometry["background_width"]
        rendered_height = rendered_geometry["background_height"]
        if rendered_width <= 0 or rendered_height <= 0:
            fail("invalid rendered background dimensions")
        scale_x = background.shape[1] / rendered_width
        scale_y = background.shape[0] / rendered_height
        target_width = max(3, int(round(rendered_geometry["piece_width"] * scale_x)))
        target_height = max(3, int(round(rendered_geometry["piece_height"] * scale_y)))
        piece_top = int(round(rendered_geometry["piece_top"] * scale_y))
        base_mask = cv2.resize(base_mask, (target_width, target_height), interpolation=cv2.INTER_LINEAR)

    for scale in SCALES:
        width = max(3, int(round(target_width * scale)))
        height = max(3, int(round(target_height * scale)))
        if width >= background.shape[1] or height >= background.shape[0]:
            continue
        mask = cv2.resize(base_mask, (width, height), interpolation=cv2.INTER_LINEAR)
        template_x = cv2.Sobel(mask, cv2.CV_32F, 1, 0, ksize=3)
        template_y = cv2.Sobel(mask, cv2.CV_32F, 0, 1, ksize=3)
        template = cv2.magnitude(template_x, template_y)
        if float(template.max()) <= 0:
            continue
        y_center = piece_top + target_height / 2
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

    if rendered_geometry:
        expected_width = max(3, target_width)
        expected_height = max(3, target_height)
        top = max(0, min(background.shape[0] - 1, piece_top))
        bottom = max(top + 1, min(background.shape[0], top + expected_height))
        row_edge = gradient[top:bottom].mean(axis=0)
        threshold = max(float(np.percentile(row_edge, 88)), float(row_edge.mean() + row_edge.std()))
        active = np.where(row_edge >= threshold)[0]
        runs = []
        for x in active:
            if not runs or x > runs[-1][-1] + 2:
                runs.append([int(x)])
            else:
                runs[-1].append(int(x))
        for left_index, left_run in enumerate(runs):
            left = left_run[0]
            if left < max(geo["x1"], int(round(geo["width"] * 1.2))):
                continue
            for right_run in runs[left_index + 1:]:
                span = right_run[-1] - left
                if expected_width * 0.82 <= span <= expected_width * 1.18:
                    strength = float(row_edge[left_run].mean() + row_edge[right_run].mean())
                    confidence = min(1.0, strength / max(1.0, threshold * 2))
                    candidates.append({"gapX": int(left), "confidence": confidence, "scale": 1.0})
                    break

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
    parser.add_argument("--piece-top", type=float)
    parser.add_argument("--piece-width", type=float)
    parser.add_argument("--piece-height", type=float)
    parser.add_argument("--rendered-background-width", type=float)
    parser.add_argument("--rendered-background-height", type=float)
    args = parser.parse_args()
    geometry_values = (
        args.piece_top,
        args.piece_width,
        args.piece_height,
        args.rendered_background_width,
        args.rendered_background_height,
    )
    rendered_geometry = None
    if any(value is not None for value in geometry_values):
        if not all(value is not None and math.isfinite(value) for value in geometry_values):
            fail("incomplete rendered geometry")
        rendered_geometry = {
            "piece_top": args.piece_top,
            "piece_width": args.piece_width,
            "piece_height": args.piece_height,
            "background_width": args.rendered_background_width,
            "background_height": args.rendered_background_height,
        }
    detect(args.background, args.piece, min(10, max(1, args.max_candidates)), rendered_geometry)


if __name__ == "__main__":
    main()
