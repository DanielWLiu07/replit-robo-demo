import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const key = (process.env.MESHY_API_KEY || await readFile('/private/tmp/flyweight-meshy-key.txt', 'utf8')).trim();
if (!key || /[\r\n]/.test(key)) throw new Error('Save only the Meshy API key in the private input file.');
const endpoint = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const names = ['drone', 'hornet', 'tank'];
const common = 'STRICT T-POSE. Upright on TWO straight legs, knees locked, feet flat. BOTH ARMS VERY LONG, stretched FULLY HORIZONTAL out to each side at shoulder height, reaching far past the body, elbows locked. Clear OPEN GAP under each armpit: arms completely SEPARATE from the torso, never merged. Each arm has a long upper arm, a long slimmer FOREARM and a blocky FIST, with clear elbow and wrist. Narrow thorax, head with compound eyes, SMALL wings folded flat. Chipped white armour over black steel. No bent arms, no big wings, no colour.';
const prompts = {
 drone: 'Slim fruit-fly boxer robot, long thin arms. ' + common,
 hornet: 'Lean hornet boxer robot, long arms. ' + common,
 tank: 'Heavy beetle boxer robot, long thick arms. ' + common,
};
await mkdir(root + 'public/models', { recursive: true });
const recordPath = root + 'scripts/meshy-tasks.json';
let records = {}; if (!process.env.MESHY_FRESH) { try { records = JSON.parse(await readFile(recordPath, 'utf8')); } catch {} }
async function api(url, body) {
 const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
 if (!res.ok) throw new Error(`Meshy HTTP ${res.status}; response omitted to keep credentials out of logs.`);
 return res.json();
}
for (const name of names) {
 if (process.argv[2] === 'submit' && !records[name]) {
  const body = { mode: 'preview', prompt: prompts[name], ai_model: 'meshy-6', should_remesh: true, target_polycount: 12000, topology: 'triangle', target_formats: ['glb'] };
  const result = await api(endpoint, body);
  records[name] = { id: result.result, prompt: prompts[name], status: 'PENDING' };
  await writeFile(recordPath, JSON.stringify(records, null, 2) + '\n');
  console.log(name, 'submitted', result.result);
 } else if (records[name] && records[name].status !== 'DOWNLOADED') {
  const task = await api(`${endpoint}/${records[name].id}`);
  console.log(name, task.status, task.progress ?? '');
  records[name].status = task.status;
  if (task.status === 'SUCCEEDED' && task.model_urls?.glb) {
   const url = new URL(task.model_urls.glb);
   if (url.protocol !== 'https:') throw new Error('Expected HTTPS asset URL');
   const asset = await fetch(url, { signal: AbortSignal.timeout(60000) });
   if (!asset.ok) throw new Error(`Asset HTTP ${asset.status}`);
   const bytes = Buffer.from(await asset.arrayBuffer());
   if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Asset is not GLB');
   await writeFile(root + `public/models/${name}.glb`, bytes);
   records[name].status = 'DOWNLOADED'; console.log(name, 'downloaded', bytes.length, 'bytes');
  }
  await writeFile(recordPath, JSON.stringify(records, null, 2) + '\n');
 }
}
