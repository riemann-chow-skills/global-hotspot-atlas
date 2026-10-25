#!/usr/bin/env python3
"""
开发期工具：把 world-atlas 的 land-110m TopoJSON 栅格化为「陆地掩膜」位图。

产物 assets/landmask.b64 是纯物理陆地/海洋的二值掩膜 —— 不含任何国界、
行政区划、主权标注。渲染层只把它当作"哪里是陆地"的采样器，
因此不涉及地图边界表达与审图合规问题。

运行（仅在需要重新生成掩膜时）：
    python3 tools/build-landmask.py

依赖：仅标准库 + 一次网络请求（可用 --input 指定本地 json 跳过下载）。
"""

import argparse
import base64
import json
import os
import sys
import urllib.request

SOURCE = "https://unpkg.com/world-atlas@2/land-110m.json"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "landmask.b64")

# 0.5 度网格：720 x 360，约 55km 采样精度，对点阵地球足够
WIDTH = 720
HEIGHT = 360


def load_topology(path=None):
    if path:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def decode_arcs(topo):
    """TopoJSON 量化弧段 -> 经纬度折线"""
    scale = topo["transform"]["scale"]
    translate = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        pts = []
        x = y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        arcs.append(pts)
    return arcs


def ring_coords(arc_indices, arcs):
    """把弧段索引拼成一个闭环的坐标序列（负索引表示反向）"""
    out = []
    for idx in arc_indices:
        if idx < 0:
            pts = list(reversed(arcs[~idx]))
        else:
            pts = arcs[idx]
        if out and pts:
            out.extend(pts[1:])
        else:
            out.extend(pts)
    return out


def collect_polygons(topo, arcs):
    """返回多边形列表，每个多边形是若干环（第一个外环 + 若干内环）"""
    polys = []
    for geom in topo["objects"]["land"]["geometries"]:
        gtype = geom["type"]
        if gtype == "Polygon":
            polys.append([ring_coords(r, arcs) for r in geom["arcs"]])
        elif gtype == "MultiPolygon":
            for poly in geom["arcs"]:
                polys.append([ring_coords(r, arcs) for r in poly])
    return polys


def rasterize(polys):
    """扫描线 + 奇偶规则填充，返回 (WIDTH*HEIGHT) 的字节位图"""
    dlat = 180.0 / HEIGHT
    dlng = 360.0 / WIDTH
    bits = bytearray((WIDTH * HEIGHT + 7) // 8)

    for row in range(HEIGHT):
        lat = 90.0 - (row + 0.5) * dlat
        # 收集该纬度线上所有交点
        xs = []
        for rings in polys:
            for ring in rings:
                n = len(ring)
                for i in range(n - 1):
                    x1, y1 = ring[i]
                    x2, y2 = ring[i + 1]
                    if (y1 > lat) != (y2 > lat):
                        t = (lat - y1) / (y2 - y1)
                        xs.append(x1 + t * (x2 - x1))
        if not xs:
            continue
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            x_start = xs[i]
            x_end = xs[i + 1]
            c0 = int((x_start + 180.0) / dlng)
            c1 = int((x_end + 180.0) / dlng)
            if c0 < 0:
                c0 = 0
            if c1 > WIDTH - 1:
                c1 = WIDTH - 1
            for col in range(c0, c1 + 1):
                p = row * WIDTH + col
                bits[p >> 3] |= 1 << (p & 7)
    return bits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="本地 land-110m.json 路径")
    args = ap.parse_args()

    topo = load_topology(args.input)
    arcs = decode_arcs(topo)
    polys = collect_polygons(topo, arcs)
    rings_total = sum(len(p) for p in polys)
    print(f"解析完成：{len(polys)} 个多边形 / {rings_total} 个环 / {len(arcs)} 条弧段")

    bits = rasterize(polys)
    land = sum(bin(b).count("1") for b in bits)
    total = WIDTH * HEIGHT
    print(f"栅格化完成：{WIDTH}x{HEIGHT}，陆地占比 {land / total:.1%}")

    b64 = base64.b64encode(bytes(bits)).decode("ascii")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(b64)
    print(f"已写入 {os.path.relpath(OUT, os.path.join(HERE, '..'))} ({len(b64)} 字符)")


if __name__ == "__main__":
    sys.exit(main())
