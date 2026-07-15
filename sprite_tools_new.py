# sprite_tools.py
# Shared-palette sprite processor for Adafruit_ImageLoad-compatible BMPs

from __future__ import annotations
import os
import sys
import argparse
from typing import Optional
from PIL import Image
import numpy as np

# Sentinel background color (magenta)
BMP_BACKGROUND_SENTINEL = (255, 0, 255)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _detect_background(img_rgba: np.ndarray) -> tuple[int, int, int, int]:
    corners = [
        tuple(img_rgba[0, 0]),
        tuple(img_rgba[0, -1]),
        tuple(img_rgba[-1, 0]),
        tuple(img_rgba[-1, -1]),
    ]
    from collections import Counter
    return Counter(corners).most_common(1)[0][0]


def _bg_mask(img_rgba: np.ndarray, bg: tuple[int, int, int, int], tolerance: int = 10):
    diff = np.abs(img_rgba.astype(int) - np.array(bg, dtype=int))
    color_match = np.max(diff[..., :3], axis=-1) <= tolerance
    alpha_zero = img_rgba[..., 3] == 0
    return color_match | alpha_zero


def _load_rgba(image_path: str):
    img = Image.open(image_path).convert("RGBA")
    return img, np.array(img)


def _fill_holes(fore: np.ndarray) -> np.ndarray:
    from collections import deque
    h, w = fore.shape
    bg = ~fore
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    # Seed flood fill from edges
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))

    while queue:
        cy, cx = queue.popleft()
        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                queue.append((ny, nx))

    return fore | (bg & ~visited)


# ─────────────────────────────────────────────────────────────────────────────
# Segment sprites
# ─────────────────────────────────────────────────────────────────────────────

def segment_sprites(image_path: str,
                    bg_color: Optional[tuple[int,int,int]] = None,
                    padding: int = 1,
                    tolerance: int = 10,
                    min_size: int = 4):

    img, arr = _load_rgba(image_path)
    h, w = arr.shape[:2]

    if bg_color is not None:
        bg_rgba = (*bg_color, 255)
    else:
        bg_rgba = _detect_background(arr)

    bg = _bg_mask(arr, bg_rgba, tolerance)
    fore = _fill_holes(~bg)

    labels = np.zeros((h, w), dtype=int)
    label = 0
    from collections import deque

    for y in range(h):
        for x in range(w):
            if fore[y, x] and labels[y, x] == 0:
                label += 1
                queue = deque([(y, x)])
                labels[y, x] = label
                while queue:
                    cy, cx = queue.popleft()
                    for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w:
                            if fore[ny, nx] and labels[ny, nx] == 0:
                                labels[ny, nx] = label
                                queue.append((ny, nx))

    sprites = []
    for lbl in range(1, label + 1):
        ys, xs = np.where(labels == lbl)
        if len(ys) < min_size:
            continue
        y0 = max(int(ys.min()) - padding, 0)
        y1 = min(int(ys.max()) + padding + 1, h)
        x0 = max(int(xs.min()) - padding, 0)
        x1 = min(int(xs.max()) + padding + 1, w)
        sprites.append(img.crop((x0, y0, x1, y1)))

    sprites.sort(key=lambda im: (im.getbbox() or (0,0,0,0)))
    return sprites


# ─────────────────────────────────────────────────────────────────────────────
# Convert sprite to RGB matrix
# ─────────────────────────────────────────────────────────────────────────────

def sprite_to_rgb_matrix(image_path: str,
                         width: int,
                         height: int,
                         bg_color: Optional[tuple[int,int,int]] = None,
                         tolerance: int = 10):

    img, arr = _load_rgba(image_path)
    h, w = arr.shape[:2]

    if bg_color is not None:
        bg_rgba = (*bg_color, 255)
    else:
        bg_rgba = _detect_background(arr)

    bg = _bg_mask(arr, bg_rgba, tolerance)
    fore = _fill_holes(~bg)

    ys, xs = np.where(fore)
    if len(ys) == 0:
        return [[None] * width for _ in range(height)]

    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    cropped = img.crop((x0, y0, x1, y1))

    resized = cropped.resize((width, height), Image.NEAREST)
    resized_arr = np.array(resized.convert("RGBA"))

    bg_small = _bg_mask(resized_arr, bg_rgba, tolerance)
    filled_small = _fill_holes(~bg_small)
    interior_bg = filled_small & bg_small

    matrix = []
    for r in range(height):
        row = []
        for c in range(width):
            if bg_small[r, c]:
                if interior_bg[r, c]:
                    row.append((255, 255, 255))
                else:
                    row.append(None)
            else:
                R, G, B, _ = resized_arr[r, c]
                row.append((int(R), int(G), int(B)))
        matrix.append(row)

    return matrix


# ─────────────────────────────────────────────────────────────────────────────
# Shared palette builder
# ─────────────────────────────────────────────────────────────────────────────

def build_shared_palette(matrices, labels=None, max_colors=255):
    """
    Build a shared palette using histogram weighting.
    Most frequent colors are prioritized before quantization.
    """
    from collections import Counter
    import numpy as np
    from PIL import Image

    if labels is None:
        labels = [f"matrix[{i}]" for i in range(len(matrices))]

    # Histogram of all colors across all matrices
    hist = Counter()

    for matrix, label in zip(matrices, labels):
        file_new = 0
        for row in matrix:
            for px in row:
                if px is not None:
                    hist[px] += 1
                    file_new += 1
        print(f"  [PALETTE] {label}: {file_new} pixel(s) scanned "
              f"(running total: {sum(hist.values())})")

    # Sort colors by frequency (most used first)
    sorted_colors = [c for c, _ in hist.most_common()]

    print(f"  [PALETTE] total unique colors: {len(sorted_colors)}")

    # If <= 255, no quantization needed
    if len(sorted_colors) <= max_colors:
        palette_rgb = [BMP_BACKGROUND_SENTINEL] + sorted_colors
    else:
        print(f"  [PALETTE QUANTISE] reducing {len(sorted_colors)} → {max_colors}")

        # Build a swatch of the most common colors
        swatch_colors = sorted_colors[:4096]  # limit for speed
        swatch = Image.new("RGB", (len(swatch_colors), 1))
        swatch.putdata(swatch_colors)

        quantized = swatch.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT)
        raw_pal = quantized.getpalette()

        palette_rgb = [BMP_BACKGROUND_SENTINEL]
        for i in range(max_colors):
            r, g, b = raw_pal[i*3], raw_pal[i*3+1], raw_pal[i*3+2]
            palette_rgb.append((r, g, b))

    # Pad to 256 entries
    while len(palette_rgb) < 256:
        palette_rgb.append((0, 0, 0))

    # Build lookup
    color_to_idx = {c: i for i, c in enumerate(palette_rgb)}

    print(f"  [PALETTE SUMMARY] {len(palette_rgb)-1} sprite colors + sentinel")

    return palette_rgb, color_to_idx


# ─────────────────────────────────────────────────────────────────────────────
# Save BMP (shared-palette compatible)
# ─────────────────────────────────────────────────────────────────────────────
def save_matrix_as_bmp(matrix, out_path, w, h,
                       shared_palette=None, shared_color_to_idx=None):
    """
    Save BMP using nearest-color matching for any pixel not in the palette.
    Ensures no transparency fallback unless the pixel was originally None.
    """
    import struct
    import numpy as np
    import os

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    palette_rgb = shared_palette
    color_to_idx = shared_color_to_idx

    # Precompute palette array for fast distance checks
    pal_arr = np.array(palette_rgb, dtype=np.int16)

    def nearest_color(px):
        """Return palette index of nearest color to px."""
        diffs = pal_arr[:, :3] - np.array(px, dtype=np.int16)
        dist2 = np.sum(diffs * diffs, axis=1)
        return int(np.argmin(dist2))

    # Build index array
    idx_arr = np.zeros((h, w), dtype=np.uint8)

    for ri, row in enumerate(matrix):
        for ci, px in enumerate(row):
            if px is None:
                idx_arr[ri, ci] = 0  # sentinel
            else:
                if px in color_to_idx:
                    idx_arr[ri, ci] = color_to_idx[px]
                else:
                    idx_arr[ri, ci] = nearest_color(px)

    # Serialize palette
    pal_bytes = bytearray()
    for (r, g, b) in palette_rgb:
        pal_bytes += bytes([b, g, r, 0x00])

    # Serialize pixels (bottom-up)
    row_stride = (w + 3) & ~3
    pixel_bytes = bytearray()
    for ri in range(h - 1, -1, -1):
        row_data = bytes(idx_arr[ri])
        pixel_bytes += row_data + bytes(row_stride - w)

    pix_offset = 14 + 40 + len(pal_bytes)
    file_size = pix_offset + len(pixel_bytes)

    file_header = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, pix_offset)
    dib_header = struct.pack(
        "<IiiHHIIiiII",
        40, w, -h, 1, 8, 0,
        len(pixel_bytes),
        2835, 2835,
        256, 0
    )

    with open(out_path, "wb") as f:
        f.write(file_header)
        f.write(dib_header)
        f.write(pal_bytes)
        f.write(pixel_bytes)

    print(f"  [BMP OK] {out_path}")

# ─────────────────────────────────────────────────────────────────────────────
# Batch runner
# ─────────────────────────────────────────────────────────────────────────────

def run_batch_file_m(batch_file, out_dir):
    jobs = []
    matrices = []
    labels = []

    with open(batch_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            src, out_rel, w, h = line.split()
            w, h = int(w), int(h)
            out_path = os.path.join(out_dir, out_rel)
            jobs.append((src, out_path, w, h))

    print("\n── Phase 1: generating matrices ───────────────────────────────")
    for src, out_path, w, h in jobs:
        print(f"  processing {src} → {out_path} (max {w}x{h})")
        matrix = sprite_to_rgb_matrix(src, w, h)
        matrices.append(matrix)
        labels.append(os.path.basename(src))

    print("\n── Phase 2: building shared palette ───────────────────────────")
    palette_rgb, color_to_idx = build_shared_palette(matrices, labels)

    print("\n── Phase 3: writing BMPs ──────────────────────────────────────")
    for (src, out_path, w, h), matrix in zip(jobs, matrices):
        try:
            save_matrix_as_bmp(matrix, out_path, w, h,
                               shared_palette=palette_rgb,
                               shared_color_to_idx=color_to_idx)
        except Exception as e:
            print(f"  [BATCH ERROR] failed to write {out_path}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", help="Batch job file")
    parser.add_argument("out_dir", nargs="?", default=".")
    args = parser.parse_args()

    if args.batch:
        run_batch_file_m(args.batch, args.out_dir)
