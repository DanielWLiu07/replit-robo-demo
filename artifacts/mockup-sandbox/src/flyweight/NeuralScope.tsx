import { useEffect, useRef } from 'react';
import type { BotSpec, MatchFrame } from '@workspace/contract';
import { MODULES } from './modules';
export function NeuralScope({ history, bot, index }: { history: MatchFrame[]; bot: BotSpec; index: 0 | 1 }) {
 const canvas = useRef<HTMLCanvasElement>(null);
 useEffect(() => {
  const node = canvas.current; if (!node) return;
  const draw = () => {
   const w = node.clientWidth, h = 220, dpr = Math.min(devicePixelRatio, 2);
   node.width = w * dpr; node.height = h * dpr;
   const ctx = node.getContext('2d'); if (!ctx) return;
   ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
   const left = 78, width = Math.max(1, w - left - 12), last = history.at(-1)?.tick ?? 0;
   const start = last - 360;
   ctx.font = '9px "IBM Plex Mono", monospace';
   for (let j = 0; j <= 6; j++) { const x = left + width * j / 6; ctx.strokeStyle = '#deded8'; ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, 199); ctx.stroke(); }
   bot.brain.slots.forEach((slot, row) => {
    const y = 20 + row * 22;
    ctx.fillStyle = '#545450'; ctx.fillText(MODULES[slot.module].circuit.replace('LPLC2 → DNp01', 'LPLC2 / GF'), 0, y + 3);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const f of history) if (f.tick >= start && (f.bots[index ? f.teamSplit : 0]?.spiked ?? []).includes(slot.module)) { const x = left + (f.tick - start) / 360 * width; ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); }
    ctx.stroke();
   });
   const slot = bot.brain.slots.find(s => s.module === 'LPLC2_DNP01') ?? bot.brain.slots[0];
   ctx.fillStyle = '#545450'; ctx.fillText('Vm / ' + (slot ? MODULES[slot.module].circuit : '—'), 0, 145);
   ctx.setLineDash([3, 4]); ctx.strokeStyle = '#aaa'; ctx.beginPath(); ctx.moveTo(left, 148); ctx.lineTo(w - 12, 148); ctx.stroke(); ctx.setLineDash([]);
   ctx.strokeStyle = '#151515'; ctx.lineWidth = 1.2; ctx.beginPath(); let begun = false;
   if (slot) for (const f of history) { if (f.tick < start) continue; const potential = f.bots[index ? f.teamSplit : 0]?.potentials[slot.module] ?? 0; const x = left + (f.tick - start) / 360 * width; const y = 195 - Math.min(1.25, potential / slot.threshold) * 47; if (!begun) {ctx.moveTo(x,y);begun=true;} else ctx.lineTo(x,y); }
   ctx.stroke(); ctx.fillStyle = '#777'; ctx.fillText('−6 s', left, 215); ctx.fillText('NOW', w - 32, 215); ctx.fillText('θ', w - 10, 151);
  };
  draw(); const observer = new ResizeObserver(draw); observer.observe(node); return () => observer.disconnect();
 }, [history, bot, index]);
 return <section className="scope glass"><div className="section-label"><span>{index ? 'B' : 'A'} / {bot.name}</span><span>NEURAL ACTIVITY</span></div><canvas ref={canvas} style={{width:'100%',height:220}} role="img" aria-label={`Six-second spike raster and membrane potential for ${bot.name}`} /><div className="scope-note"><span>Each mark is a spike.</span><span>Vm: Giant Fiber when equipped</span></div></section>;
}
