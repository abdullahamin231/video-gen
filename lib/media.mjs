// Media probing shared by the capture pipeline: how long a recording is, and what size its frames really are.
import {spawn} from 'node:child_process';

function probe(args, what) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', args, {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`ffprobe could not read ${what}: ${err.trim().split('\n').slice(-2).join(' ')}`)));
  });
}

export async function probeDuration(file) {
  return Number(await probe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 'the recording duration'));
}

/** The frame size of the video stream, in pixels — the detail a recording actually carries, not its CSS viewport. */
export async function probeSize(file) {
  const out = await probe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], 'the recording size');
  return out.split('x').map(Number);
}
