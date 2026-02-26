#!/usr/bin/env python3
import json
from collections import defaultdict
from pathlib import Path
from statistics import median

INPUT_PATH = Path("data/Index.geojson")
OUTPUT_PATH = Path("data/Index_5km.geojson")


def polygon_bbox(coords):
    ring = coords[0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def main():
    fc = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    features = fc["features"]

    bboxes = []
    widths = []
    heights = []

    for feature in features:
        minx, miny, maxx, maxy = polygon_bbox(feature["geometry"]["coordinates"])
        bboxes.append((minx, miny, maxx, maxy))
        widths.append(maxx - minx)
        heights.append(maxy - miny)

    cell_w = median(widths)
    cell_h = median(heights)

    origin_x = min(b[0] for b in bboxes)
    origin_y = min(b[1] for b in bboxes)

    grouped = defaultdict(list)

    for feature, bbox in zip(features, bboxes):
        minx, miny, _, _ = bbox
        col = int((minx - origin_x) / cell_w)
        row = int((miny - origin_y) / cell_h)

        parent_col = col // 2
        parent_row = row // 2
        grouped[(parent_col, parent_row)].append(feature)

    numeric_fields = set()
    for feature in features:
        for key, value in feature.get("properties", {}).items():
            if is_number(value):
                numeric_fields.add(key)

    new_features = []

    for (parent_col, parent_row), group in grouped.items():
        minx = origin_x + parent_col * (cell_w * 2)
        miny = origin_y + parent_row * (cell_h * 2)
        maxx = minx + (cell_w * 2)
        maxy = miny + (cell_h * 2)

        properties = {
            "zone_id": f"{parent_col}_{parent_row}",
            "source_cells": len(group),
        }

        for field in sorted(numeric_fields):
            values = [f["properties"].get(field) for f in group]
            values = [v for v in values if is_number(v)]
            if values:
                properties[field] = sum(values) / len(values)

        new_features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [minx, miny],
                            [minx, maxy],
                            [maxx, maxy],
                            [maxx, miny],
                            [minx, miny],
                        ]
                    ],
                },
            }
        )

    out_fc = {
        "type": "FeatureCollection",
        "name": "Index_5km",
        "features": new_features,
    }

    OUTPUT_PATH.write_text(
        json.dumps(out_fc, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Generated {len(new_features)} cells -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
