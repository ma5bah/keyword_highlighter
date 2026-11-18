#!/usr/bin/env python3
"""Launch OpenCode without occupying the calling agent.

Launches detach by default; --wait explicitly waits for completion. Durable job
JSON and logs track detached work. OPENCODE_TIMEOUT is opt-in (0/unset means
unlimited). Parallel batches start all packages unless --jobs limits concurrency.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import time
import uuid
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[2]
LIMITS = re.compile(r"usage limit|rate limit|model unavailable|quota (?:exceeded|exhausted)|insufficient (?:quota|credit|balance)", re.I)
SESSION = re.compile(r"ses_[A-Za-z0-9]+")


def positive(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value) or int(value) < 1:
        raise ValueError("expected a positive integer")
    return int(value)


def nonnegative(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError("expected a nonnegative integer")
    return int(value)


def settings() -> tuple[int, int]:
    try:
        timeout = nonnegative(os.getenv("OPENCODE_TIMEOUT", "0"))
        tail = nonnegative(os.getenv("OPENCODE_TAIL_LINES", "0"))
    except ValueError as error:
        raise ValueError(f"invalid OpenCode environment setting: {error}") from None
    return timeout, tail


def executable() -> str:
    name = os.getenv("OPENCODE_BIN") or shutil.which("opencode") or str(Path.home() / ".opencode/bin/opencode")
    found = shutil.which(name)
    if not found:
        raise ValueError(f"opencode executable not found: {name}; set OPENCODE_BIN")
    return str(Path(found).resolve())


def package_data(name: str) -> tuple[Path, str]:
    path = Path(name).resolve(strict=True)
    if not path.is_file():
        raise ValueError(f"package is not a file: {path}")
    for output in (path.with_suffix(".log"), path.with_suffix(".ses")):
        if output == path or output.is_symlink() or (
            output.exists() and (
                not output.is_file() or output.samefile(path) or output.stat().st_nlink > 1
            )
        ):
            raise ValueError(f"package conflicts with output file: {output}")
    return path, path.read_text(encoding="utf-8")


def preamble() -> str:
    name = os.getenv("OPENCODE_PREAMBLE")
    return Path(name).read_text(encoding="utf-8") + "\n\n" if name else ""


def slot_count(requested: int) -> int:
    """Compatibility helper: remote model concurrency is not a CPU count."""
    return requested


def exit_code(status: int) -> int:
    return status if status >= 0 else 128 - status


def signal_group(process: subprocess.Popen, number: int) -> None:
    try:
        os.killpg(process.pid, number)
    except ProcessLookupError:
        pass


def stop_all(processes, grace: float = 5) -> None:
    """Signal every process group, wait against one deadline, kill, then reap."""
    processes = list(processes)
    for process in processes:
        signal_group(process, signal.SIGTERM)
    deadline = time.monotonic() + grace
    for process in processes:
        remaining = max(0, deadline - time.monotonic())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            pass
    # Always signal groups: a worker leader may have exited while descendants remain.
    for process in processes:
        signal_group(process, signal.SIGKILL)
    for process in processes:
        process.wait()


def run_process(command: list[str], deadline: float, **kwargs) -> int:
    if time.monotonic() >= deadline:
        return 124
    process = subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        try:
            return exit_code(process.wait(timeout=None if deadline == float("inf") else max(0, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            stop_all([process])
            return 124
    except BaseException:
        stop_all([process])
        raise


def parallel(args: list[str]) -> int:
    """Start every session before waiting unless --jobs limits concurrency."""
    jobs = None
    if args[:1] == ["--jobs"]:
        if len(args) < 2:
            raise ValueError("--jobs needs a positive integer")
        jobs = positive(args[1])
        args = args[2:]
    if len(args) < 3 or not all(args):
        raise ValueError("usage: launch.sh --parallel [--jobs N] <model-a> <model-b> <package.md>...")
    model_a, model_b, *names = args
    settings()
    paths = [package_data(name)[0] for name in names]
    if len({path.with_suffix('.log') for path in paths}) != len(paths):
        raise ValueError("each package must have a different output path (including its filename stem)")
    executable()
    preamble()
    limit = min(len(paths), jobs or len(paths))
    print(f"Launching {len(paths)} sessions; starting up to {limit} before waiting.", flush=True)
    pending = deque(enumerate(paths))
    active = {}
    waiting = {}
    failed = []
    with ThreadPoolExecutor(max_workers=limit) as executor:
        try:
            while pending or waiting:
                started = False
                while pending and len(waiting) < limit:
                    index, path = pending.popleft()
                    models = (model_a, model_b) if index % 2 == 0 else (model_b, model_a)
                    command = [sys.executable, str(SCRIPT), "launch", "--wait", str(path), path.stem, *models]
                    process = subprocess.Popen(command, start_new_session=True)
                    active[process] = path
                    waiting[executor.submit(process.wait)] = (process, path)
                    started = True
                    print(f"Started {path} (PID {process.pid}).", flush=True)
                if started:
                    print(f"Waiting for {len(waiting)} active sessions.", flush=True)
                done, _ = wait(waiting, return_when=FIRST_COMPLETED)
                for future in done:
                    process, path = waiting.pop(future)
                    status = future.result()
                    del active[process]
                    normalized = exit_code(status)
                    print(f"Completed {path} (PID {process.pid}) with exit {normalized}; log {path.with_suffix('.log')}", flush=True)
                    if status:
                        failed.append(f"{path}: exit {normalized}, log {path.with_suffix('.log')}")
        finally:
            # Stop children before the executor joins threads blocked in wait().
            stop_all(active, grace=20)
    if failed:
        print("failed packages:\n" + "\n".join(failed), file=sys.stderr)
    print(f"Parallel complete: {len(paths) - len(failed)} succeeded, {len(failed)} failed.", flush=True)
    return int(bool(failed))


def launch(args: list[str]) -> int:
    if len(args) not in (4, 5) or not all(args[:4]):
        raise ValueError("usage: launch.sh <package.md> <title> <model> <fallback-model> [session-id]")
    name, title, model, fallback = args[:4]
    timeout, tail_lines = settings()
    deadline = time.monotonic() + timeout if timeout else float("inf")
    session = args[4] if len(args) == 5 else ""
    if len(args) == 5 and not SESSION.fullmatch(session):
        raise ValueError(f"invalid session ID: {session!r}")
    package, message = package_data(name)
    opencode = executable()
    message = (preamble() if not session else "") + message
    title = f"{' '.join(title.split())} [{uuid.uuid4().hex[:12]}]"
    log, session_file = package.with_suffix(".log"), package.with_suffix(".ses")

    def find_session() -> str | None:
        try:
            listing = subprocess.run([opencode, "session", "list", "--standalone", "-n", "1000"], cwd=REPO,
                                     capture_output=True, text=True, errors="replace", check=True, timeout=10)
            for line in listing.stdout.splitlines():
                fields = line.split("\t")
                if len(fields) >= 2 and fields[1] == title and SESSION.fullmatch(fields[0]):
                    return fields[0]
        except (OSError, subprocess.SubprocessError) as error:
            detail = getattr(error, "stderr", "") or str(error)
            print(f"error: session lookup failed: {detail.strip()}", file=sys.stderr)
            return None
        return ""

    with log.open("a+", encoding="utf-8") as output:
        try:
            fcntl.flock(output, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError(f"a session is already using this log: {log}") from None
        output.seek(0)
        output.truncate()
        if session:
            session_file.write_text(session + "\n", encoding="utf-8")
        else:
            session_file.unlink(missing_ok=True)

        def run(chosen_model: str, prompt: str) -> int:
            output.flush()
            command = [opencode, "run", "--standalone", "-m", chosen_model, "--title", title]
            if session:
                command += ["-s", session]
            return run_process(command + ["--", prompt], deadline, cwd=REPO, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=subprocess.STDOUT)

        status = 1
        try:
            status = run(model, message)
            if (status and status != 124 and time.monotonic() < deadline
                    and model != fallback and LIMITS.search(log.read_text(errors="replace"))):
                found = session or find_session()
                if found is not None:
                    session = found
                    output.write(f"=== retrying with {fallback} ===\n")
                    model = fallback
                    if time.monotonic() < deadline:
                        status = run(model, "Continue the package where you left off and finish the report."
                                     if session else message)
                    else:
                        status = 124
        finally:
            session = session or find_session() or ""
            if session:
                try:
                    session_file.write_text(session + "\n", encoding="utf-8")
                except OSError as error:
                    print(f"error: cannot save session ID to {session_file}: {error}", file=sys.stderr)
                    status = status or 1
            else:
                print(f"error: no session ID recorded for {package}; log {log}", file=sys.stderr)
                status = status or 1
        print(f"=== {title} | session {session or 'unknown'} | model {model} | log {log} ===", flush=True)
        if tail_lines:
            with log.open(errors="replace") as transcript:
                print("".join(deque(transcript, maxlen=tail_lines)), end="", flush=True)
        if status:
            if status == 124:
                print(f"error: {package}: timed out after {timeout}s (including fallback); cleanup and session recording may take additional time", file=sys.stderr)
            print(f"error: {package}: exit {status}, log {log}", file=sys.stderr)
        return status


def validate(args: list[str]) -> list[Path]:
    """Check the entire request before acknowledging a detached launch."""
    settings()
    executable()
    preamble()
    if args[:1] == ["--parallel"]:
        rest = args[1:]
        if rest[:1] == ["--jobs"]:
            if len(rest) < 2:
                raise ValueError("--jobs needs a positive integer")
            positive(rest[1])
            rest = rest[2:]
        if len(rest) < 3 or not all(rest):
            raise ValueError("expected --parallel [--jobs N] <model-a> <model-b> <package>...")
        names = rest[2:]
    else:
        if len(args) not in (4, 5) or not all(args[:4]):
            raise ValueError("expected <package> <title> <model> <fallback> [session-id]")
        if len(args) == 5 and not SESSION.fullmatch(args[4]):
            raise ValueError("invalid session ID")
        names = args[:1]
    paths = [package_data(name)[0] for name in names]
    if len({path.with_suffix('.log') for path in paths}) != len(paths):
        raise ValueError("each package must have a different output path")
    # Probe active writers without truncating their output.
    for path in paths:
        with path.with_suffix('.log').open('a') as output:
            try:
                fcntl.flock(output, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError(f"a session is already using this log: {path}") from None
    return paths


def dispatch(args: list[str]) -> int:
    return parallel(args[1:]) if args[:1] == ["--parallel"] else launch(args)


def write_status(path: Path, data: dict) -> None:
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data) + "\n", encoding="utf-8")
    temporary.replace(path)


def detached(args: list[str]) -> int:
    paths = validate(args)
    job_id = "job_" + uuid.uuid4().hex
    directory = paths[0].parent / '.opencode-jobs'
    directory.mkdir(mode=0o700, exist_ok=True)
    # Exclusive directory creation keeps status and output separate from packages.
    directory = directory / job_id
    directory.mkdir(mode=0o700)
    status_path = directory / 'status.json'
    log_path = directory / 'worker.log'
    read_fd, write_fd = os.pipe()
    try:
        with log_path.open('x') as output:
            process = subprocess.Popen(
                [sys.executable, str(SCRIPT), 'worker', str(status_path),
                 job_id, str(write_fd), *args], cwd=REPO,
                stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True, pass_fds=(write_fd,))
        os.close(write_fd)
        write_fd = -1
        # Wait only for startup acknowledgement, never for the task itself.
        if not select.select([read_fd], [], [], 10)[0] or os.read(read_fd, 1) != b'1':
            stop_all([process])
            write_status(status_path, {'job_id': job_id, 'pid': process.pid,
                                     'state': 'failed', 'exit_code': 1})
            raise ValueError(f"worker startup failed; log {log_path}")
        print(json.dumps({'job_id': job_id, 'pid': process.pid,
                          'status_path': str(status_path), 'log_path': str(log_path)}), flush=True)
        return 0
    finally:
        os.close(read_fd)
        if write_fd >= 0:
            os.close(write_fd)


def worker(args: list[str]) -> int:
    status_path, job_id, ready_fd, *request = args
    data = {'job_id': job_id, 'pid': os.getpid(), 'state': 'running'}
    code = 1
    try:
        write_status(Path(status_path), data)
        os.write(int(ready_fd), b'1')
        os.close(int(ready_fd))
        code = dispatch(request)
        return code
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else 1
        raise
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        code = 2
        return code
    finally:
        data.update(state='succeeded' if code == 0 else 'failed', exit_code=code)
        write_status(Path(status_path), data)


def main() -> int:
    def terminate(received, _frame):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        sys.exit(128 + received)
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, terminate)
    command, *args = sys.argv[1:] or [""]
    try:
        if command == "launch":
            if args[:1] == ["--wait"]:
                return dispatch(args[1:])
            return detached(args[1:] if args[:1] == ["--detach"] else args)
        if command == "worker":
            return worker(args)
        if command == "slots" and len(args) == 1:
            print(slot_count(positive(args[0])))
            return 0
        raise ValueError("usage: launch.sh ... | parallel_slots.sh <positive integer>")
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
