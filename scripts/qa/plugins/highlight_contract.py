"""Define independent fixture ranges and expected native decoration styles."""

from __future__ import annotations

from typing import Any


THEMES = {
    "dark": ("Default Dark Modern", "vs-dark"),
    "light": ("Default Light Modern", "vs"),
    "high_contrast_dark": ("Default High Contrast", "hc-black"),
    "high_contrast_light": ("Default High Contrast Light", "hc-light"),
}
MODES = ["tag", "text", "tag-and-comment", "tag-and-subTag", "text-and-comment",
         "line", "whole-line", "capture-groups:1,3", "none"]
PROFILES = ["default_opt_in", "explicit_off", "scheme_on", "background", "rich", "theme", "disabled", "codicons"]
TAGS = ["TODO", "FIXME", "constructor", "__proto__", "toString"]
CODICON_GLYPHS = ["beaker", "flame", "bug", "add", "account"]


def case_settings(theme: str, mode: str, profile: str, marker: str) -> dict[str, Any]:
    """Return explicit workspace settings and deterministic source lines."""
    if mode not in MODES or profile not in PROFILES:
        raise ValueError(f"invalid highlight case: {mode}/{profile}")
    foreground = "#ffff66" if theme.endswith("dark") else "#154273"
    background = "#334455" if theme.endswith("dark") else "#ddeeff"
    default = {"type": mode, "foreground": foreground, "gutterIcon": False, "rulerLane": "right"}
    custom = {"urgent": {"foreground": "#ff99dd" if theme.endswith("dark") else "#551144",
                         "background": background}}
    prefix = "better-todo-tree."
    settings = {
        "workbench.colorTheme": THEMES[theme][0],
        prefix + "general.tags": TAGS,
        prefix + "general.tagGroups": {},
        prefix + "general.statusBar": "tags",
        prefix + "tree.scanMode": "current file",
        prefix + "tree.autoRefresh": True,
        prefix + "highlights.enabled": profile != "disabled",
        prefix + "highlights.highlightDelay": 0,
        prefix + "highlights.defaultHighlight": default,
        prefix + "highlights.customHighlight": custom,
        prefix + "highlights.foregroundColourScheme": ["#ffeecc", "#ddffff"],
        prefix + "highlights.backgroundColourScheme": ["#553322", "#224455"],
        prefix + "regex.regex": r"// ($TAGS)(\([^)]+\))?(.*)",
        prefix + "regex.subTagRegex": r"^\(([^)]+)\)",
        prefix + "regex.regexCaseSensitive": True,
    }
    if profile in ["explicit_off", "scheme_on"]:
        settings[prefix + "highlights.useColourScheme"] = profile == "scheme_on"
    if profile in ["background", "rich"]:
        default["background"] = background
    if profile == "rich":
        default.update(opacity=50, gutterIcon=True, rulerLane="full", fontStyle="italic",
                       fontWeight="bold", textDecoration="underline", borderRadius="4px")
    if profile == "theme":
        default.update(foreground="editor.foreground", background="editor.background")
    if profile == "scheme_on":
        custom["TODO"] = {"foreground": "#ff99aa"}
    if profile == "codicons":
        default["gutterIcon"] = True
        settings[prefix + "general.tagGroups"] = {"PrototypeMarker": ["__proto__"]}
        for tag, icon in zip(TAGS, ["beaker", "flame", "bug", "plus", "accounts-view-bar-icon"]):
            key = "PrototypeMarker" if tag == "__proto__" else tag
            custom[key] = {"icon": "$(" + icon + ")", "iconColour": foreground}
    lines = [f"const caseId = '{marker}';"]
    lines.extend("    // " + tag + ("(urgent)" if tag == "TODO" else "") + " item " + str(index + 1)
                 for index, tag in enumerate(TAGS))
    lines.extend(["const plain = 'unmarked';", ""])
    return {"settings": settings, "lines": lines, "foreground": foreground, "background": background}


def highlighted_columns(line: str, tag: str, mode: str, enabled: bool) -> list[int]:
    """Return zero-based decorated columns from the fixture contract."""
    if not enabled or mode == "none":
        return []
    start = line.index(tag)
    end = start + len(tag)
    if mode in ["line", "whole-line"]:
        return list(range(len(line)))
    if mode == "text":
        return list(range(start, len(line)))
    if mode == "text-and-comment":
        return list(range(line.index("//"), len(line)))
    if mode == "tag-and-comment":
        return list(range(line.index("//"), end))
    if mode == "capture-groups:1,3":
        tail = line.index(")") + 1 if tag == "TODO" else end
        return list(range(start, end)) + list(range(tail, len(line)))
    if mode == "tag-and-subTag" and tag == "TODO":
        return list(range(start, end)) + list(range(end + 1, line.index(")")))
    return list(range(start, end))


def evidence_contract(case: dict[str, Any], observed: dict[str, Any], theme: str,
                      mode: str, profile: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Compare fixture columns with DOM spans and rendered decoration colors."""
    enabled = profile != "disabled" and mode != "none"
    expected: dict[str, Any] = {"state": {"theme": THEMES[theme][1]}, "styles": {}, "layout": {}}
    actual: dict[str, Any] = {"state": {}, "styles": {}, "layout": {}}
    expected_overlay_count = 0
    actual["state"]["theme"] = next(value for value in ["vs-dark", "vs", "hc-black", "hc-light"]
                                     if value in observed["classes"].split())
    actual["visible_text"] = "\n".join(row["text"] for row in observed["lines"])
    expected["visible_text"] = [case["lines"][0], "const plain = 'unmarked';"]
    for index, line in enumerate(case["lines"]):
        key = f"line_{index + 1}"
        tag = TAGS[index - 1] if 1 <= index <= len(TAGS) else None
        columns = highlighted_columns(line, tag, mode, enabled) if tag else []
        expected["state"][key] = {"text": line, "columns": ",".join(map(str, columns))}
        row = observed["lines"][index] if index < len(observed["lines"]) else {"text": "", "spans": []}
        actual_columns = [column for span in row["spans"] if span["decorated"]
                          for column in range(span["start"], span["end"])]
        actual["state"][key] = {"text": row["text"], "columns": ",".join(map(str, actual_columns))}
        if not columns or tag is None:
            continue
        segments: list[list[int]] = []
        for column in columns:
            if not segments or column != segments[-1][-1] + 1:
                segments.append([])
            segments[-1].append(column)
        expected_overlay_count += len(segments)
        row_overlays = sorted((item for item in observed["overlays"]
                               if abs(item["rect"]["y"] - row["rect"]["y"]) < 1),
                              key=lambda item: item["rect"]["x"])
        first_span = row["spans"][0]
        glyph_width = first_span["rect"]["width"] / len(first_span["text"])
        for part, segment in enumerate(segments):
            geometry_key = key + f"_range_{part}"
            expected["layout"][geometry_key] = {
                "x": {"value": row["rect"]["x"] + segment[0] * glyph_width, "tolerance": 1},
                "width": {"value": row["rect"]["width"] if mode == "whole-line"
                          else len(segment) * glyph_width, "tolerance": 1},
                "height": row["rect"]["height"],
            }
            actual["layout"][geometry_key] = row_overlays[part]["rect"] if part < len(row_overlays) else {}
        start = line.index(tag)
        span = next((item for item in row["spans"] if item["start"] <= start < item["end"]), None)
        expected_style: dict[str, Any] = {"color": case["foreground"], "backgroundColor": "rgba(0, 0, 0, 0)"}
        if profile == "scheme_on":
            expected_style.update(color="#ff99aa" if tag == "TODO" else ["#ffeecc", "#ddffff"][(index-1) % 2],
                                  backgroundColor=["#553322", "#224455"][(index-1) % 2])
        elif profile == "background":
            expected_style["backgroundColor"] = case["background"]
        elif profile == "rich":
            rgb = [int(case["background"][position:position+2], 16) for position in (1, 3, 5)]
            expected_style.update(backgroundColor=f"rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, 0.5)",
                                  fontStyle="italic", fontWeight="700", textDecorationLine="underline")
        elif profile == "theme":
            expected_style.update(color=observed["themeForeground"],
                                  backgroundColor=observed["themeBackground"])
        overlay = next((item for item in row_overlays if span and
                        item["rect"]["x"] <= span["rect"]["x"] + 1 <
                        item["rect"]["x"] + item["rect"]["width"]), None)
        actual_style = dict(span["style"]) if span else {}
        actual_style["backgroundColor"] = overlay["style"]["backgroundColor"] if overlay else "rgba(0, 0, 0, 0)"
        expected["styles"][key] = expected_style
        actual["styles"][key] = actual_style
        if mode == "tag-and-subTag" and tag == "TODO":
            subtag = next(item for item in row["spans"] if item["text"] == "urgent")
            subtag_setting = case["settings"]["better-todo-tree.highlights.customHighlight"]["urgent"]
            expected["styles"][key + "_subtag"] = {
                "color": subtag_setting["foreground"],
                "backgroundColor": expected_style["backgroundColor"] if profile == "rich"
                                   else subtag_setting["background"],
            }
            actual["styles"][key + "_subtag"] = {
                "color": subtag["style"]["color"],
                "backgroundColor": row_overlays[1]["style"]["backgroundColor"],
            }
    expected["state"]["overlay_count"] = expected_overlay_count
    actual["state"]["overlay_count"] = len(observed["overlays"])
    expected["state"]["gutter_count"] = len(TAGS) if enabled and profile in ["rich", "codicons"] else 0
    actual["state"]["gutter_count"] = len(observed["gutter"])
    if actual["styles"]:
        expected["metrics"] = {"minimum_contrast": {"min": 4.5}}
        actual["metrics"] = {"minimum_contrast": min(
            contrast_ratio(style["color"], style["backgroundColor"], observed["themeBackground"])
            for style in actual["styles"].values())}
    return expected, actual


def css_rgba(value: str) -> list[float]:
    """Decode browser RGB values or theme hex values into normalized channels."""
    if value.startswith("#"):
        digits = value[1:]
        if len(digits) in (3, 4):
            digits = "".join(character * 2 for character in digits)
        return [int(digits[index:index + 2], 16) / 255 for index in (0, 2, 4)] + [
            int(digits[6:8], 16) / 255 if len(digits) == 8 else 1.0]
    if not value.startswith(("rgb(", "rgba(")):
        raise ValueError(f"unsupported computed color: {value}")
    values = [float(part) for part in value[value.index("(") + 1:-1].split(",")]
    return [channel / 255 for channel in values[:3]] + [values[3] if len(values) == 4 else 1.0]


def contrast_ratio(foreground: str, background: str, editor_background: str) -> float:
    """Return the WCAG contrast ratio after alpha compositing."""
    def composite(front: list[float], back: list[float]) -> list[float]:
        return [front[index] * front[3] + back[index] * (1 - front[3]) for index in range(3)] + [1.0]

    def luminance(color: list[float]) -> float:
        return sum(weight * (value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4)
                   for weight, value in zip((0.2126, 0.7152, 0.0722), color))

    back = composite(css_rgba(background), css_rgba(editor_background))
    front = composite(css_rgba(foreground), back)
    low, high = sorted((luminance(front), luminance(back)))
    return (high + 0.05) / (low + 0.05)
