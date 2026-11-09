// Speeds up the AI/PayPal waiting ranges recorded in recordings/marks.json and exports recordings/handshake-demo.mp4.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SPEED = Number(process.env.SPEED || 8);
const marks = JSON.parse(readFileSync('recordings/marks.json', 'utf8'));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const dur = Number(execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'recordings/raw.webm']).toString());

// Build [start, end, speed] segments covering the whole video.
const segs = [];
let t = 0;
for (const [a, b] of marks.filter(([a, b]) => b - a > 1.5).sort((x, y) => x[0] - y[0])) {
  if (a > t) segs.push([t, a, 1]);
  segs.push([Math.max(a, t), b, SPEED]);
  t = b;
}
if (t < dur) segs.push([t, dur, 1]);

const parts = segs.map(([a, b, s], i) => `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=(PTS-STARTPTS)/${s}[v${i}]`);
const filter = `${parts.join(';')};${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0,fps=30[out]`;
execFileSync(ffmpeg, ['-y', '-i', 'recordings/raw.webm', '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', 'recordings/handshake-demo.mp4'], { stdio: 'inherit' });
const total = segs.reduce((s, [a, b, sp]) => s + (b - a) / sp, 0);
console.log(`Exported recordings/handshake-demo.mp4 (~${total.toFixed(0)}s from ${dur.toFixed(0)}s raw)`);
