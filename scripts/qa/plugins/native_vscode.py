"""Run Methodical QA against an isolated native VS Code installation."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import signal
import shutil
import socket
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from playwright.async_api import async_playwright

from methodical_qa.core.context import ExecutionContext
from methodical_qa.plugins import ActionBase, ActionError, hookimpl
from highlight_contract import CODICON_GLYPHS, TAGS, THEMES, case_settings, evidence_contract


def retain(ctx: ExecutionContext, name: str, data: bytes, kind: str, mime_type: str) -> Path:
    """Persist one flow artifact and its content digest."""
    path = ctx.run_output_dir / "evidence" / ctx.current_flow_id / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    ctx.add_artifact(kind=kind, name=name, path=str(path), mime_type=mime_type,
                     producer="native_vscode", content_addressed=True)
    return path


async def inspect_svg_assets(host: Any, assets: list[dict]) -> None:
    """Verify owned SVG files and await native image decoding before capture."""
    for asset in assets:
        path = Path(unquote(urlparse(asset["url"]).path)).resolve(strict=True)
        if not path.is_relative_to(host.runtime):
            raise ValueError(f"icon outside owned runtime: {path}")
        asset["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    await host.page.evaluate("""async assets => {
        await Promise.all(assets.map(async asset => {
            const image = new Image(); image.src = asset.url; await image.decode();
            if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty icon');
        }));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    }""", assets)


class NativeVscodeExecutor:
    """Own the native editor, display, profile and CDP connection."""

    name = "native_vscode"

    def __init__(self) -> None:
        self.processes: list[asyncio.subprocess.Process] = []
        self.logs: list[Any] = []
        self.driver: Any = None
        self.browser: Any = None
        self.page: Any = None

    def set_run_output_dir(self, output_dir: Path) -> None:
        """Bind all runtime writes to the evidence directory."""
        self.output_dir = output_dir.resolve()

    async def command(self, *args: str) -> str:
        """Execute an editor command and reject nonzero exit codes."""
        process = await asyncio.create_subprocess_exec(
            *args, env=self.env, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await process.communicate()
        text = stdout.decode("utf-8", errors="replace")
        if process.returncode != 0:
            raise RuntimeError(f"command exited {process.returncode}: {args!r}\n{text}")
        return text

    async def start(self, args: list[str], log_name: str, **kwargs: Any) -> Any:
        """Start one owned process group with retained diagnostics."""
        log = (self.output_dir / log_name).open("wb")
        self.logs.append(log)
        process = await asyncio.create_subprocess_exec(
            *args, env=self.env, start_new_session=True,
            stderr=log, stdout=kwargs.pop("stdout", log), **kwargs,
        )
        self.processes.append(process)
        return process

    async def window_id(self) -> str:
        """Resolve the owned X11 workbench window."""
        deadline = asyncio.get_running_loop().time() + 30
        while True:
            windows = await self.command("xwininfo", "-root", "-tree")
            matches = [line.split()[0] for line in windows.splitlines()
                       if '"Better Todo Tree Visual Acceptance"' in line]
            if len(matches) == 1:
                return matches[0]
            if asyncio.get_running_loop().time() >= deadline:
                raise RuntimeError(f"expected one native workbench window, observed {len(matches)}")
            await asyncio.sleep(0.1)

    async def screenshot(self) -> bytes:
        """Capture the configured native observation surface."""
        if self.observer == "cdp":
            return await self.page.screenshot()
        path = self.runtime / "capture.png"
        await self.command("import", "-window", await self.window_id(), str(path))
        return path.read_bytes()

    async def setup(self, executor_config: Any, qa_config: Any) -> None:
        """Install the VSIX and attach to the native workbench renderer."""
        if qa_config.execution.parallel:
            raise ValueError("native_vscode requires execution.parallel=false")
        options = executor_config.options
        self.settings_namespace = options.get("settings_namespace", "better-todo-tree")
        if self.settings_namespace not in ["better-todo-tree", "todo-tree"]:
            raise ValueError("settings_namespace must be better-todo-tree or todo-tree")
        self.observer = options.get("observer", "cdp")
        if self.observer not in ["cdp", "x11"]:
            raise ValueError("observer must be cdp or x11")
        self.code = str(Path(options["code"]).absolute())
        vsix = Path(options["vsix"]).resolve(strict=True)
        self.runtime = self.output_dir / "native"
        if self.owned_processes():
            await self.teardown()
            (self.output_dir / "cleanup.json").replace(self.output_dir / "orphan-cleanup.json")
        self.workspace = self.runtime / "workspace"
        profile = self.runtime / "profile"
        extensions = self.runtime / "extensions"
        temp = self.runtime / "tmp"
        for directory in [self.workspace / ".vscode", profile / "User", extensions, temp]:
            directory.mkdir(parents=True, exist_ok=True)
        self.env = dict(os.environ, TMPDIR=str(temp), XDG_CACHE_HOME=str(self.runtime / "cache"))
        self.env.pop("ELECTRON_RUN_AS_NODE", None)
        self.code_args = [self.code, "--user-data-dir", str(profile), "--extensions-dir", str(extensions),
                          "--shared-data-dir", str(self.runtime / "shared-data")]
        settings = {
            "security.workspace.trust.enabled": False,
            "telemetry.telemetryLevel": "off",
            "update.mode": "none",
            "extensions.autoCheckUpdates": False,
            "extensions.autoUpdate": False,
            "workbench.startupEditor": "none",
            "workbench.secondarySideBar.defaultVisibility": "hidden",
            "git.enabled": False,
            "editor.minimap.enabled": False,
            "editor.fontSize": 18,
            "editor.lineHeight": 28,
            "editor.renderWhitespace": "none",
            "editor.stickyScroll.enabled": False,
            "workbench.editor.enablePreview": False,
            "window.title": "Better Todo Tree Visual Acceptance",
        }
        if "profile_settings_fixture" in options:
            settings.update(json.loads(Path(options["profile_settings_fixture"]).read_text()))
        (profile / "User/settings.json").write_text(json.dumps(settings, indent=2))
        entry = options.get("entry", "highlight.js")
        if "workspace_fixture" in options:
            shutil.copytree(Path(options["workspace_fixture"]).resolve(strict=True), self.workspace,
                            dirs_exist_ok=True)
        else:
            (self.workspace / entry).write_text("// QA native editor\n// TODO acceptance\n")
            if options.get("await_initial_highlight", False):
                (self.workspace / ".vscode/settings.json").write_text(json.dumps({
                    self.settings_namespace + ".highlights.defaultHighlight": {
                        "type": "tag", "foreground": "#ffff66",
                    },
                }, indent=2))
        if "probe_extension" in options:
            shutil.copytree(Path(options["probe_extension"]).resolve(strict=True),
                            extensions / "qa.better-todo-tree-customer-probe-1.0.0")
            self.env["BETTER_TODO_TREE_QA_RESULT"] = str(self.output_dir / "customer.json")
            self.env["BETTER_TODO_TREE_QA_START"] = str(self.output_dir / "customer-start")
            self.env["BETTER_TODO_TREE_QA_PYTHON"] = str(Path(options["x11_python"]).resolve(strict=True))
            self.env["BETTER_TODO_TREE_QA_MODE"] = options.get("probe_mode", "customer")
            self.env["BETTER_TODO_TREE_QA_PROFILE"] = str(profile / "User/settings.json")
        try:
            install = await self.command(*self.code_args, "--install-extension", str(vsix), "--force")
            (self.output_dir / "install.log").write_text(install)
            display = await self.start(
                ["Xvfb", "-displayfd", "1", "-screen", "0", "1600x1000x24", "-nolisten", "tcp"],
                "xvfb.log", stdout=asyncio.subprocess.PIPE,
            )
            display_number = (await asyncio.wait_for(display.stdout.readline(), 15)).decode().strip()
            if not display_number.isdecimal():
                raise RuntimeError(f"invalid Xvfb display: {display_number!r}")
            self.env["DISPLAY"] = ":" + display_number
            with socket.socket() as port_reservation:
                port_reservation.bind(("127.0.0.1", 0))
                port = port_reservation.getsockname()[1]
            await self.start(
                self.code_args + ["--wait", "--new-window", "--disable-gpu",
                                  "--skip-welcome", "--skip-release-notes",
                                  "--remote-debugging-address=127.0.0.1",
                                  f"--remote-debugging-port={port}",
                                  str(self.workspace / options["workspace_file"])
                                  if "workspace_file" in options else str(self.workspace),
                                  str(self.workspace / entry)],
                "vscode.log",
            )
            deadline = asyncio.get_running_loop().time() + 60
            while True:
                try:
                    reader, writer = await asyncio.open_connection("127.0.0.1", port)
                except ConnectionRefusedError:
                    if asyncio.get_running_loop().time() >= deadline:
                        raise RuntimeError("native editor CDP listener did not start")
                    await asyncio.sleep(0.1)
                    continue
                writer.close()
                await writer.wait_closed()
                break
            if self.observer == "cdp":
                self.driver = await async_playwright().start()
                self.browser = await self.driver.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                while self.page is None:
                    pages = [page for context in self.browser.contexts for page in context.pages
                             if "workbench" in page.url]
                    if pages:
                        self.page = pages[0]
                        break
                    if asyncio.get_running_loop().time() >= deadline:
                        raise RuntimeError("native workbench renderer missing")
                    await asyncio.sleep(0.1)
                await self.page.locator(".monaco-editor .view-lines").first.wait_for(timeout=60000)
                if options.get("await_initial_highlight", False):
                    started = asyncio.get_running_loop().time()
                    await self.page.wait_for_function(
                        "() => Array.from(document.querySelectorAll('.view-line')).some(line => "
                        "line.textContent.replaceAll('\\u00a0', ' ').includes('TODO acceptance') && "
                        "line.querySelector('span[class*=TextEditorDecorationType]'))",
                        timeout=60000,
                    )
                    (self.output_dir / "initial-highlight-ready.json").write_text(json.dumps({
                        "fixture": "TODO acceptance",
                        "decorated": True,
                        "wait_ms": (asyncio.get_running_loop().time() - started) * 1000,
                    }, indent=2))
            else:
                await self.window_id()
            (self.output_dir / "host.json").write_text(json.dumps({
                "code": self.code, "version": await self.command(self.code, "--version"),
                "vsix": str(vsix), "vsix_sha256": hashlib.sha256(vsix.read_bytes()).hexdigest(),
                "observer": self.observer, "workbench_url": self.page.url if self.page else None,
            }, indent=2))
        except BaseException:
            await self.teardown()
            raise

    def owned_processes(self) -> dict[int, int]:
        """Resolve live process IDs and groups from the exact owned profile."""
        processes: dict[int, int] = {}
        profile = str(self.runtime / "profile").encode()
        temporary_directory = b"TMPDIR=" + str(self.runtime / "tmp").encode()
        for entry in Path("/proc").iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                arguments = (entry / "cmdline").read_bytes().split(b"\0")
                environment = (entry / "environ").read_bytes().split(b"\0")
                if temporary_directory in environment or any(
                    argument == profile or argument == b"--user-data-dir=" + profile
                    for argument in arguments
                ):
                    processes[int(entry.name)] = os.getpgid(int(entry.name))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
        return processes

    async def teardown(self) -> None:
        """Close the CDP driver and terminate only owned process groups."""
        errors: list[Exception] = []
        groups = {process.pid for process in self.processes} | set(self.owned_processes().values())
        if os.getpgrp() in groups:
            raise RuntimeError("native editor cleanup includes the QA runner process group")
        if self.driver is not None:
            try:
                await self.driver.stop()
            except Exception as error:
                errors.append(error)
            self.driver = None
        for group in groups:
            try:
                os.killpg(group, signal.SIGTERM)
            except ProcessLookupError:
                continue
        for process in reversed(self.processes):
            try:
                await asyncio.wait_for(process.wait(), 10)
            except TimeoutError:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        await asyncio.sleep(0.2)
        for group in groups:
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                continue
        deadline = asyncio.get_running_loop().time() + 5
        remaining = self.owned_processes()
        while remaining and asyncio.get_running_loop().time() < deadline:
            for pid in remaining:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    continue
            await asyncio.sleep(0.1)
            remaining = self.owned_processes()
        (self.output_dir / "cleanup.json").write_text(json.dumps({
            "process_groups": sorted(groups), "remaining_owned_processes": remaining}))
        if remaining:
            errors.append(RuntimeError(f"native editor processes remain: {sorted(remaining)}"))
        self.processes.clear()
        for log in self.logs:
            log.close()
        self.logs.clear()
        if errors:
            raise ExceptionGroup("native editor cleanup failures", errors)

    async def create_context(self, flow: Any, config: Any) -> ExecutionContext:
        """Bind one sequential flow to the installed editor."""
        ctx = ExecutionContext(parameters=flow.parameters, env=dict(config.env),
                               base_url=config.base_url, current_flow_id=flow.flow_id)
        ctx.set_resource("native_vscode", self)
        if self.page is not None:
            ctx.set_resource("playwright_page", self.page)
            ctx.set_resource("browser_page", self.page)
            ctx.set_resource("playwright_context", self.page.context)
            ctx.set_resource("browser_context", self.page.context)
        return ctx

    async def destroy_context(self, ctx: ExecutionContext) -> None:
        """Retain failure screenshots and release flow-local references."""
        if ctx.flow_error:
            screenshot = await self.screenshot()
            retain(ctx, "failure.png", screenshot, "screenshot", "image/png")
        ctx.resources.clear()


class NativeInspectAction(ActionBase):
    """Capture editor DOM and a screenshot from the installed extension."""

    action_type = "native_inspect"

    async def execute(self, ctx: ExecutionContext) -> dict[str, Any]:
        host = ctx.get_resource("native_vscode")
        if host is None:
            raise ActionError("native_vscode resource missing", self.id)
        await host.page.wait_for_function("document.body.innerText.includes('TODO')")
        await asyncio.sleep(2)
        screenshot = await host.page.screenshot()
        retain(ctx, "workbench.png", screenshot, "screenshot", "image/png")
        dom = await host.page.locator(".monaco-editor").first.inner_html()
        retain(ctx, "editor.html", dom.encode(), "document", "text/html")
        return {"text": await host.page.locator(".view-lines").first.inner_text()}


class NativeHighlightAction(ActionBase):
    """Apply one settings permutation and retain its rendered evidence."""

    action_type = "native_highlight"

    async def execute(self, ctx: ExecutionContext) -> dict[str, Any]:
        host = ctx.get_resource("native_vscode")
        theme, mode, profile = (ctx.parameters[key] for key in ("theme", "mode", "profile"))
        marker = f"{theme}/{mode}/{profile}"
        case = case_settings(theme, mode, profile, marker)
        settings = {
            key.replace("better-todo-tree.", host.settings_namespace + ".", 1): value
            for key, value in case["settings"].items()
        }
        settings_path = host.workspace / ".vscode/settings.json"
        staging = settings_path.with_suffix(".new")
        staging.write_text(json.dumps(settings, indent=2))
        staging.replace(settings_path)
        source_path = host.workspace / ("highlight-" + ctx.current_flow_id + ".js")
        source_path.write_text("\n".join(case["lines"]))
        await host.page.keyboard.press("Control+k")
        await host.page.keyboard.press("w")
        await host.command(*host.code_args, "--reuse-window", "--goto", str(source_path) + ":1:1")
        await host.page.wait_for_function(
            "args => document.querySelector('.view-lines')?.textContent.includes(args.marker) && "
            "document.querySelector('.monaco-workbench').classList.contains(args.theme)",
            arg={"marker": marker, "theme": THEMES[theme][1]}, timeout=20000,
        )
        observer = (Path(__file__).parents[1] / "observe-highlights.js").read_text()
        previous = None
        stable = 0
        deadline = asyncio.get_running_loop().time() + 15
        while stable < 3:
            observed = await host.page.evaluate(observer)
            signature = json.dumps(observed, sort_keys=True)
            stable = stable + 1 if signature == previous else 0
            previous = signature
            if asyncio.get_running_loop().time() >= deadline:
                raise ActionError("editor decorations did not settle", self.id)
            await asyncio.sleep(0.2)
        assets = [{"url": item["image"][5:-2], "kind": "gutter"}
                  for item in sorted(observed["gutter"], key=lambda item: item["rect"]["y"])]
        await inspect_svg_assets(host, assets)
        if profile == "codicons" and mode != "none":
            templates = json.loads((Path(__file__).parents[3] / "src/codiconGlyphs.json").read_text())
            if len(assets) != len(CODICON_GLYPHS):
                raise ActionError(f"codicon gutter count mismatch: {len(assets)}", self.id)
            for asset, tag, glyph in zip(assets, TAGS, CODICON_GLYPHS):
                expected = templates[glyph].replace("currentColor", case["foreground"])
                asset.update(tag=tag, glyph=glyph,
                             expected_sha256=hashlib.sha256(expected.encode()).hexdigest())
        retain(ctx, "icons.json", json.dumps(assets, indent=2).encode(), "data", "application/json")
        if any("expected_sha256" in asset and asset["sha256"] != asset["expected_sha256"] for asset in assets):
            raise ActionError("configured codicon SVG content mismatch", self.id)
        retain(ctx, "settings.json", json.dumps(settings, indent=2).encode(), "data", "application/json")
        retain(ctx, "observed.json", json.dumps(observed, indent=2).encode(), "data", "application/json")
        retain(ctx, "source.js", source_path.read_bytes(), "document", "text/javascript")
        retain(ctx, "workbench.png", await host.page.screenshot(), "screenshot", "image/png")
        rect = observed["editor"]
        rect["height"] = min(rect["height"], 320)
        retain(ctx, "highlights.png", await host.page.screenshot(clip=rect), "screenshot", "image/png")
        expected, actual = evidence_contract(case, observed, theme, mode, profile)
        retain(ctx, "contract.json", json.dumps({"expected": expected, "actual": actual}, indent=2).encode(),
               "data", "application/json")
        return {"expected": expected, "actual": actual}


class NativeCustomerAction(ActionBase):
    """Execute the contributed command surface in the installed editor."""

    action_type = "native_customer"

    async def read_x11_text(self, host: NativeVscodeExecutor, surface: str) -> str:
        """Extract text from one native screenshot without altering retained evidence."""
        capture = host.runtime / "readiness-ocr.png"
        capture.write_bytes(await host.screenshot())
        await host.command("python", str(Path(__file__).parents[1] / "prepare-ocr.py"), str(capture),
                           "--surface", surface)
        return await host.command("env", "OMP_THREAD_LIMIT=1", "tesseract", str(capture),
                                  "stdout", "--psm", "11")

    async def inspect_closed_editors(self, host: NativeVscodeExecutor, ctx: ExecutionContext) -> None:
        """Await removal of notebook entries from the rendered open-files tree."""
        if host.page is not None:
            await host.page.wait_for_function("""() =>
                document.querySelectorAll('.monaco-editor').length === 0 &&
                !Array.from(document.querySelectorAll('.custom-view-tree-node-item')).some(node =>
                    node.textContent.includes('first cell') || node.textContent.includes('second cell'))
            """, timeout=10000)
            return
        deadline = asyncio.get_running_loop().time() + 10
        while True:
            text = await self.read_x11_text(host, "workbench")
            words = text.split()
            if "open files" in text and "FIXME" not in words and "TODO" not in words:
                retain(ctx, "closed-editors-ocr.txt", text.encode(), "document", "text/plain")
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise ActionError(f"closed notebook entries remain visible: {text}", self.id)
            await asyncio.sleep(0.2)

    async def inspect_x11_settings_tree(self, host: NativeVscodeExecutor, ctx: ExecutionContext,
                                        name: str, expected: dict) -> None:
        """Require one editor occurrence and the configured tree occurrence for each fixture label."""
        deadline = asyncio.get_running_loop().time() + 10
        while True:
            text = await self.read_x11_text(host, "workbench")
            words = text.split()
            if all(words.count(label) == 2 for label in expected["included"]) and \
                    all(words.count(label) == 1 for label in expected["excluded"]):
                retain(ctx, name + "-tree-ocr.txt", text.encode(), "document", "text/plain")
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise ActionError(f"native settings tree labels differ: {text}", self.id)
            await asyncio.sleep(0.2)

    async def inspect_notebook_icons(self, host: NativeVscodeExecutor, ctx: ExecutionContext, name: str) -> None:
        """Verify rendered notebook icons reference existing, decodable SVG assets."""
        expected = "FIXME edited first cell" if name == "notebook-edited" else "TODO first cell"
        await host.page.wait_for_function("expected => Array.from(document.querySelectorAll("
            "'.custom-view-tree-node-item')).some(node => node.textContent.includes(expected))",
            arg=expected, timeout=10000)
        await host.page.wait_for_function(
            "document.querySelectorAll('.glyph-margin-widgets .cgmr').length === 2", timeout=10000)
        assets = await host.page.evaluate("""() => Array.from(document.querySelectorAll(
            '.glyph-margin-widgets .cgmr, .custom-view-tree-node-item-icon')).flatMap(node => {
                const box = node.getBoundingClientRect();
                if (!box.width || !box.height) return [];
                return [null, '::before'].flatMap(pseudo => {
                    const image = getComputedStyle(node, pseudo).backgroundImage;
                    return image.startsWith('url("') ? [{url: image.slice(5, -2),
                        kind: node.classList.contains('cgmr') ? 'gutter' : 'tree'}] : [];
                });
            })""")
        counts = {kind: sum(asset["kind"] == kind for asset in assets) for kind in ["gutter", "tree"]}
        if counts != {"gutter": 2, "tree": 2}:
            raise ActionError(f"notebook icon count mismatch: {counts}", self.id)
        await inspect_svg_assets(host, assets)
        retain(ctx, name + "-icons.json", json.dumps(assets, indent=2).encode(), "data", "application/json")

    async def inspect_x11_notebook(self, host: NativeVscodeExecutor, ctx: ExecutionContext, name: str) -> None:
        """Wait for notebook labels in the native X11 screenshot using OCR."""
        deadline = asyncio.get_running_loop().time() + 10
        while True:
            text = await self.read_x11_text(host, "notebook")
            words = text.split()
            ready = words.count("FIXME") >= 3 and words.count("TODO") >= 2 if name == "notebook-edited" \
                else words.count("TODO") >= 5
            if ready:
                retain(ctx, name + "-ocr.txt", text.encode(), "document", "text/plain")
                await asyncio.sleep(1)
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise ActionError(f"native notebook labels did not settle: {text}", self.id)
            await asyncio.sleep(0.2)

    async def execute(self, ctx: ExecutionContext) -> dict[str, Any]:
        host = ctx.get_resource("native_vscode")
        window = await host.window_id()
        await host.command(host.env["BETTER_TODO_TREE_QA_PYTHON"],
                           str(Path(__file__).parents[1] / "focus-window.py"), window)
        (host.output_dir / "customer-start").write_text("start\n")
        result_path = host.output_dir / "customer.json"
        checkpoint_path = Path(str(result_path) + ".checkpoint")
        last_checkpoint = None
        deadline = asyncio.get_running_loop().time() + 180
        while not result_path.is_file():
            if checkpoint_path.is_file():
                request = json.loads(checkpoint_path.read_text())
                checkpoint = request["name"]
                if checkpoint != last_checkpoint:
                    if "tree" in request and host.page is not None:
                        await host.page.wait_for_function("""expected => {
                            const labels = Array.from(document.querySelectorAll('.custom-view-tree-node-item'))
                                .filter(node => {
                                    const rect = node.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0;
                                }).map(node => node.textContent);
                            return expected.included.every(text => labels.some(label => label.includes(text))) &&
                                expected.excluded.every(text => labels.every(label => !label.includes(text)));
                        }""", arg=request["tree"], timeout=10000)
                        await host.page.evaluate("async () => { await new Promise(requestAnimationFrame); "
                                                 "await new Promise(requestAnimationFrame); }")
                    elif "tree" in request:
                        await self.inspect_x11_settings_tree(host, ctx, checkpoint, request["tree"])
                    if checkpoint.startswith("settings-import-ready-"):
                        if host.page is not None:
                            await host.page.wait_for_function("""() => {
                                const toast = Array.from(document.querySelectorAll('.notification-toast'))
                                    .find(node => node.textContent.includes('imported Todo Tree settings across'));
                                if (!toast || getComputedStyle(toast).opacity !== '1') return false;
                                const rect = toast.getBoundingClientRect();
                                return rect.top >= 0 && rect.bottom <= innerHeight &&
                                    toast.getAnimations({subtree: true}).every(animation =>
                                        animation.playState === 'finished' || animation.playState === 'idle');
                            }""", timeout=15000)
                        else:
                            notification_deadline = asyncio.get_running_loop().time() + 15
                            while True:
                                text = await self.read_x11_text(host, "workbench")
                                if "imported Todo Tree settings across" in " ".join(text.split()):
                                    break
                                if asyncio.get_running_loop().time() >= notification_deadline:
                                    raise ActionError("settings import notification missing", self.id)
                                await asyncio.sleep(0.2)
                    if checkpoint.startswith("notebook-"):
                        if host.page is not None:
                            await self.inspect_notebook_icons(host, ctx, checkpoint)
                        else:
                            await self.inspect_x11_notebook(host, ctx, checkpoint)
                    retain(ctx, checkpoint + ".png", await host.screenshot(), "screenshot", "image/png")
                    if host.page is not None:
                        dom = await host.page.locator(".monaco-workbench").inner_html()
                        retain(ctx, checkpoint + ".html", dom.encode(), "document", "text/html")
                    Path(str(checkpoint_path) + ".ack").write_text(checkpoint)
                    last_checkpoint = checkpoint
            if asyncio.get_running_loop().time() >= deadline:
                raise ActionError("customer probe result missing", self.id)
            await asyncio.sleep(0.2)
        result = json.loads(result_path.read_text())
        retain(ctx, "customer.json", result_path.read_bytes(), "data", "application/json")
        if result.get("success") is not True:
            raise ActionError(json.dumps(result.get("error")), self.id)
        if "notebookChecks" in result:
            await self.inspect_closed_editors(host, ctx)
        retain(ctx, "workbench.png", await host.screenshot(), "screenshot", "image/png")
        return {"state": {"success": result["success"], "unexecuted": result["unexecutedCommands"]},
                "commands": len(result["executedCommands"])}


@hookimpl
def register_executor() -> dict[str, type]:
    """Register the native workbench executor."""
    return {"native_vscode": NativeVscodeExecutor}


@hookimpl
def register_actions() -> dict[str, type[ActionBase]]:
    """Register native editor evidence actions."""
    return {"native_inspect": NativeInspectAction, "native_highlight": NativeHighlightAction,
            "native_customer": NativeCustomerAction}
