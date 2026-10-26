"""Exercise real process locks without importing or downloading the model."""
import json
import os
import selectors
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = r'''
import json, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from ming_queue import MingQueue
directory, name = Path(sys.argv[2]), sys.argv[3]
def report(event):
    print(json.dumps(event), flush=True)
with MingQueue(directory, report, 0.02):
    print(json.dumps({'entered': name, 'torchLoaded': 'torch' in sys.modules}), flush=True)
    while not (directory / (name + '.release')).exists():
        time.sleep(0.02)
    if name == 'failure':
        raise RuntimeError('synthetic model failure')
'''


class QueueTests(unittest.TestCase):
    def setUp(self):
        cache = ROOT / '.cache'
        cache.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='ming-queue-test-', dir=cache)
        self.directory = Path(self.temp.name)
        self.workers = []

    def tearDown(self):
        for worker in self.workers:
            if worker.poll() is None:
                worker.kill()
            worker.wait(timeout=5)
            worker.stdout.close()
            worker.stderr.close()
        self.temp.cleanup()

    def start(self, name):
        worker = subprocess.Popen([sys.executable, '-u', '-c', WORKER,
                                   str(ROOT / 'scripts'), str(self.directory), name],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        self.workers.append(worker)
        return worker

    def event(self, worker):
        with selectors.DefaultSelector() as selector:
            selector.register(worker.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(timeout=5), 'worker event timed out')
            line = worker.stdout.readline()
        self.assertTrue(line, 'worker exited without an event')
        return json.loads(line)

    def entered(self, worker, name):
        event = self.event(worker)
        if event.get('phase') == 'loading-model':
            event = self.event(worker)
        self.assertEqual(event, {'entered': name, 'torchLoaded': False})

    def release(self, worker, name, code=0):
        (self.directory / (name + '.release')).touch()
        self.assertEqual(worker.wait(timeout=5), code)

    def test_four_processes_enter_in_fifo_order_and_wait_without_model(self):
        first = self.start('first')
        self.entered(first, 'first')
        second = self.start('second')
        self.assertEqual(self.event(second)['queuePosition'], 1)
        third = self.start('third')
        self.assertEqual(self.event(third)['queuePosition'], 2)
        fourth = self.start('fourth')
        self.assertEqual(self.event(fourth)['queuePosition'], 3)
        for worker, name in [(first, 'first'), (second, 'second'), (third, 'third'), (fourth, 'fourth')]:
            if name != 'first':
                while True:
                    event = self.event(worker)
                    if event.get('status') == 'generating':
                        break
                self.entered(worker, name)
            self.release(worker, name)
        self.assertEqual(list(self.directory.glob('*.ticket')), [])

    def test_killed_active_worker_and_cancelled_waiter_do_not_block_next_job(self):
        first = self.start('first')
        self.entered(first, 'first')
        cancelled = self.start('cancelled')
        self.assertEqual(self.event(cancelled)['queuePosition'], 1)
        last = self.start('last')
        self.assertEqual(self.event(last)['queuePosition'], 2)
        cancelled.kill()
        cancelled.wait(timeout=5)
        self.assertEqual(self.event(last)['queuePosition'], 1)
        first.kill()
        first.wait(timeout=5)
        self.entered(last, 'last')
        self.release(last, 'last')
        self.assertEqual(list(self.directory.glob('*.ticket')), [])

    def test_failure_releases_slot_and_next_process_starts(self):
        failed = self.start('failure')
        self.entered(failed, 'failure')
        next_worker = self.start('next')
        self.assertEqual(self.event(next_worker)['queuePosition'], 1)
        self.release(failed, 'failure', code=1)
        self.entered(next_worker, 'next')
        self.release(next_worker, 'next')


if __name__ == '__main__':
    unittest.main()
