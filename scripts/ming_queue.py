"""Cross-process FIFO for CPU Ming workers; acquire before importing torch.

Ticket locks live for the lifetime of their owning process. A killed process
cannot strand the queue: the next scan removes tickets whose locks are free.
The short registry lock protects admission, ordering and stale-ticket cleanup.
"""
import atexit
import fcntl
import json
import os
import signal
import threading
import time
from contextlib import contextmanager
from pathlib import Path

QUEUE_DIR = Path(__file__).resolve().parents[1] / '.cache' / 'ming-queue'


class MingQueue:
    def __init__(self, directory=QUEUE_DIR, on_event=None, poll_seconds=0.5):
        self.directory = Path(directory)
        self.on_event = on_event or (lambda event: None)
        self.poll_seconds = poll_seconds
        self.ticket = None
        self.owner = None

    @contextmanager
    def registry(self):
        with (self.directory / 'registry.lock').open('a+') as registry:
            fcntl.flock(registry, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(registry, fcntl.LOCK_UN)

    def live_tickets(self):
        tickets = []
        for ticket in sorted(self.directory.glob('*.ticket')):
            if ticket == self.ticket:
                tickets.append(ticket)
                continue
            with ticket.open('r') as owner:
                try:
                    fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    tickets.append(ticket)
                else:
                    ticket.unlink()
        return tickets

    def acquire(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            with self.registry():
                counter = self.directory / 'sequence'
                sequence = int(counter.read_text()) + 1 if counter.exists() else 1
                # Gaps after a crash are harmless; IDs are never reused.
                staged = counter.with_suffix('.next')
                staged.write_text(str(sequence))
                staged.replace(counter)
                self.ticket = self.directory / f'{sequence:020d}-{os.getpid()}.ticket'
                self.owner = self.ticket.open('x+')
                fcntl.flock(self.owner, fcntl.LOCK_EX)
            previous_position = None
            while True:
                with self.registry():
                    position = self.live_tickets().index(self.ticket)
                if position == 0:
                    self.on_event({'status': 'generating', 'queuePosition': 0, 'phase': 'loading-model'})
                    return self
                if position != previous_position:
                    self.on_event({'status': 'queued', 'queuePosition': position,
                                   'phase': 'waiting-for-ming'})
                    previous_position = position
                time.sleep(self.poll_seconds)
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.owner is not None:
            with self.registry():
                self.ticket.unlink(missing_ok=True)
                self.owner.close()
                self.owner = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_):
        self.close()


def queue_event(event):
    print('MING_EVENT ' + json.dumps(event), flush=True)


def acquire_worker_slot(directory=QUEUE_DIR):
    # Also stop orphaned model workers if a launcher is forcibly killed. This
    # monitor uses only the standard library and runs while queued and active.
    parent = os.getppid()

    def watch_parent():
        while True:
            if os.getppid() != parent or parent == 1:
                os.kill(os.getpid(), signal.SIGTERM)
                return
            time.sleep(0.5)

    def stop(signum, _frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=watch_parent, daemon=True).start()
    lease = MingQueue(directory, on_event=queue_event)
    atexit.register(lease.close)
    return lease.acquire()
