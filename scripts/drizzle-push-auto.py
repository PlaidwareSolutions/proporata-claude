#!/usr/bin/env python3
"""Run drizzle-kit push, auto-answering all prompts with the default
(first/highlighted option = press Enter)."""
import os, pty, select, sys, time

CMD = ["pnpm", "exec", "drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(CMD[0], CMD)

last_send = 0.0
buffer = b""
done = False

while not done:
    r, _, _ = select.select([fd], [], [], 1.0)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        buffer += chunk
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        # If a prompt question appears, send Enter
        if b"?" in chunk or b"created or renamed" in chunk or b"Is " in chunk:
            now = time.time()
            if now - last_send > 0.2:
                os.write(fd, b"\r")
                last_send = now
    else:
        # Idle - if we've seen prompts, occasionally send Enter to advance
        if buffer and (b"created or renamed" in buffer[-2000:] or "❯".encode() in buffer[-2000:]):
            os.write(fd, b"\r")
        # Check if process is still alive
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                done = True
        except ChildProcessError:
            done = True

try:
    _, status = os.waitpid(pid, 0)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
except ChildProcessError:
    sys.exit(0)
