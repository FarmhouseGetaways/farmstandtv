#!/usr/bin/env python3
"""Rebuild the map's data files from Cory's Google My Map.

    python3 tools/kml-to-data.py

Writes data/stands.json, data/landmarks.json and data/roads.json, which
js/map.js fetches at runtime. Run it whenever the My Map changes and commit
the result - the site has no build step, so the JSON in the repo is what ships.

The My Map is the source of truth. It is edited by hand in Google My Maps and
exports as KML; this turns the three folders that matter into the shapes
map.js expects. Python is used rather than Node only because parsing XML needs
no dependencies here, and this repo has no npm.
"""

import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

MID = "1UYfvCLGpxkbZj_mduyWE9x5usdOd-ow"   # "Ramona Farm Stands - V6"
KML_URL = f"https://www.google.com/maps/d/kml?mid={MID}&forcekml=1"
NS = {"k": "http://www.opengis.net/kml/2.2"}
ROOT = Path(__file__).resolve().parent.parent

# The My Map has no icon field, so landmark glyphs are chosen here by name.
# GLYPH in js/map.js defines what is available: peak, park, water, museum,
# castle, wildlife, air, sign, place. Anything unlisted falls back to "place".
LANDMARK_KINDS = {
    "Barnett Ranch Preserve": "park",
    "Ramona Airport & Helicopter Museum": "air",
    "Mt. Woodson Castle": "castle",
    "Mount Woodson Summit - Potato Chip Rock": "peak",
    "Hawk Watch - Wildlife Institute": "wildlife",
    "Ramona Wildlife Center": "wildlife",
    "Guy B Woodward Museum": "museum",
    "Ramona Grasslands Preserve": "park",
    "San Diego Zoo Safari Park": "wildlife",
    "Luelf Pond County Preserve": "water",
    "Ramona Sign": "sign",
    "Dos Picos County Park": "park",
    "Mt. Gower County Preserve": "peak",
}

ROAD_COLOUR = "#FFD600"   # the amber Cory styled the routes in


def text(node, path):
    return (node.findtext(path, default="", namespaces=NS) or "").strip()


def extended(placemark):
    """The per-stand fields Google stores alongside the pin."""
    out = {}
    ed = placemark.find("k:ExtendedData", NS)
    if ed is not None:
        for data in ed.findall("k:Data", NS):
            out[data.get("name")] = text(data, "k:value")
    return out


def point(placemark):
    """Returns (lat, lng). KML orders coordinates lng,lat - not lat,lng."""
    coords = placemark.find(".//k:Point/k:coordinates", NS)
    if coords is None or not coords.text:
        return None, None
    lng, lat = coords.text.strip().split(",")[:2]
    return round(float(lat), 7), round(float(lng), 7)


def line(placemark):
    coords = placemark.find(".//k:LineString/k:coordinates", NS)
    if coords is None or not coords.text:
        return None
    pts = []
    for triple in coords.text.split():
        lng, lat = triple.split(",")[:2]
        pts.append([round(float(lat), 7), round(float(lng), 7)])
    return pts or None


def folders(doc):
    return {text(f, "k:name"): f for f in doc.findall("k:Folder", NS)}


def build_stands(folder):
    stands = []
    for pm in folder.findall("k:Placemark", NS):
        name = text(pm, "k:name")
        if not name:
            continue
        fields = extended(pm)
        lat, lng = point(pm)
        # The pin's own coordinates and the LAT/LONG fields agree, but the
        # fields are what Cory maintains, so they win when both are present.
        try:
            lat = round(float(fields["LAT"]), 7)
            lng = round(float(fields["LONG"]), 7)
        except (KeyError, ValueError):
            pass
        stand = {"name": name}
        if lat is not None:
            stand["lat"], stand["lng"] = lat, lng
        # "note" is where opening hours live on this map.
        for key, target in (("Address", "address"), ("note", "hours"),
                            ("Phone", "phone"), ("URL", "url")):
            value = fields.get(key, "").strip()
            if value:
                stand[target] = value
        stands.append(stand)
    stands.sort(key=lambda s: s["name"].lower())
    return stands


def build_landmarks(folder):
    marks = []
    for pm in folder.findall("k:Placemark", NS):
        name = text(pm, "k:name")
        lat, lng = point(pm)
        if not name or lat is None:
            continue
        marks.append({"name": name, "lat": lat, "lng": lng,
                      "kind": LANDMARK_KINDS.get(name, "place")})
    marks.sort(key=lambda m: m["name"].lower())
    return marks


def build_roads(folder):
    lines = []
    for pm in folder.findall("k:Placemark", NS):
        pts = line(pm)
        if pts:
            lines.append(pts)
    return lines


def write(rel, payload):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"  wrote {rel}")


def main():
    print(f"fetching {KML_URL}")
    with urllib.request.urlopen(KML_URL, timeout=60) as response:
        kml = response.read()
    doc = ET.fromstring(kml).find("k:Document", NS)
    found = folders(doc)

    for required in ("Ramona Farmstands", "Ramona Landmarks", "Road Layer"):
        if required not in found:
            raise SystemExit(
                f"The My Map has no {required!r} folder. Folders present: "
                f"{sorted(found)}. Someone renamed one - fix the name here "
                f"rather than in Google, so the printed map keeps its labels."
            )

    stands = build_stands(found["Ramona Farmstands"])
    landmarks = build_landmarks(found["Ramona Landmarks"])
    roads = build_roads(found["Road Layer"])

    missing = [s["name"] for s in stands if "lat" not in s]
    if missing:
        print(f"  note: {len(missing)} stand(s) have no coordinates and will "
              f"be listed but not pinned: {', '.join(missing)}")

    unknown = sorted({m["name"] for m in landmarks if m["kind"] == "place"})
    if unknown:
        print(f"  note: no glyph chosen for {', '.join(unknown)} - "
              f"add them to LANDMARK_KINDS")

    write("data/stands.json", {"stands": stands})
    write("data/landmarks.json", {"landmarks": landmarks})
    write("data/roads.json", {"color": ROAD_COLOUR, "lines": roads})
    print(f"\n{len(stands)} stands, {len(landmarks)} landmarks, "
          f"{len(roads)} road segments")


if __name__ == "__main__":
    main()
