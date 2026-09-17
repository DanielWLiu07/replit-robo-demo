import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const key = (process.env.MESHY_API_KEY || await readFile('/private/tmp/flyweight-meshy-key.txt', 'utf8')).trim();
if (!key || /[\r\n]/.test(key)) throw new Error('Save only the Meshy API key in the private input file.');
const endpoint = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const names = ['drone', 'hornet', 'tank'];
const common = 'Bipedal mechanical fly robot standing upright on exactly TWO legs in a boxing stance, knees bent, clawed feet flat on the ground. Two arms raised in a guard with blocky fists. Upright thorax, head on top with large compound camera eyes, abdomen angled down and back. Two folded metal wing blades. Chipped white armour over black steel, rivets, vents. Industrial manga machinery, humanoid proportions. No extra legs, no insect crawling pose, no colour, no text, no pedestal.';
const prompts = {
 drone: 'Lightweight bipedal fruit-fly boxer robot. Slim frame, long slender legs, fast agile build, oversized faceted optical eyes, exposed thorax flywheel, narrow swept wing spars. ' + common,
 hornet: 'Bipedal hornet boxer robot. Lean athletic build, angular shoulder armour, long pointed abdomen behind, narrow twin optical housings, aggressive forward-leaning fighting stance. ' + common,
 tank: 'Heavy bipedal beetle boxer robot. Broad armoured torso with overlapping plates, thick powerful two legs, massive shoulders and heavy fists, short folded metal wings, recessed protected optical eyes. ' + common,
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
