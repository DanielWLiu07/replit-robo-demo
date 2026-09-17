import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_SQUAD } from '@workspace/contract';
import type { Chassis, MatchFrame } from '@workspace/contract';
import { Compositor } from './vendor/blender-to-threejs/comp/compositor';
import { compGraph } from './vendor/blender-to-threejs/comp/builder';
import { mangaGritGraph } from './mangaGrit';
import { watercolorGraph } from './vendor/blender-to-threejs/recipes/watercolor-comp';
import { impactRevealMask } from './impactReveal';
import { mechanicalMaterial } from './manga';
import { lampMaterial } from './lampMaterial';
import { advanceBoil, hatchMaterial, loadHatchTextures, makeHatchUniforms } from './hatchMaterial';
import { buildWordmark } from './wordmark';
import { bindChassis, buildSkinnedBot, poseSkinnedBot, type SkinnedBot } from './skinnedBot';
const DEFAULT_CHASSIS: [Chassis, Chassis] = ['DRONE','HORNET'];
function disposeObject(object: THREE.Object3D) {
 object.traverse(o=>{if(o instanceof THREE.Mesh || o instanceof THREE.Line){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
}
/** Display only: server coordinates and arenaHalf remain authoritative. */
export function Arena({frame,arenaSize=14,showcase=false,chassis=DEFAULT_CHASSIS,immersive=false,labChassis='DRONE',landing=false}:{frame:MatchFrame|null;arenaSize?:number;showcase?:boolean;chassis?:[Chassis,Chassis];immersive?:boolean;labChassis?:Chassis;landing?:boolean}) {
 const host=useRef<HTMLDivElement>(null), incoming=useRef(frame);
 const [unavailable,setUnavailable]=useState(false);
 const selectedChassis=useRef(labChassis);
 useEffect(()=>{selectedChassis.current=labChassis;},[labChassis]);
 useEffect(()=>{incoming.current=frame;},[frame]);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  let disposed=false,raf=0,visible=true;
  const renderer=new WebGPURenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setClearColor(landing?0xeeeeea:0x07070a,1);element.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(landing?0xeeeeea:0x07070a);const camera=new THREE.PerspectiveCamera(36,1,.1,100);
  camera.position.set(0,showcase?5:15,showcase?10:15);camera.lookAt(0,0,0);
  const hatchTex=landing?loadHatchTextures(import.meta.env.BASE_URL):null;
  const hatchU=landing?makeHatchUniforms(Math.min(devicePixelRatio,1.75)):null;
  const inkMaterial=()=>hatchMaterial(hatchTex!,hatchU!);
  const grid=new THREE.GridHelper(12,28,0x34353f,0x1e1f27);scene.add(grid);
  const border=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(12,.35,12)),new THREE.LineBasicMaterial({color:0xc6c7cf}));border.position.y=.15;scene.add(border);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshBasicMaterial({color:0x0c0d12}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;scene.add(floor);
  const rings=new THREE.Group();
  for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.RingGeometry(2.2+i*.65,2.205+i*.65,100),new THREE.MeshBasicMaterial({color:0x3c3d47,side:THREE.DoubleSide}));r.rotation.x=-Math.PI/2;r.position.y=-.12-i*.1;rings.add(r);}scene.add(rings);rings.visible=showcase;
  const makeBot=(dark:boolean)=>{
   const group=new THREE.Group(),assembly=new THREE.Group();assembly.name='assembly';group.add(assembly);
   const metal=landing?inkMaterial():mechanicalMaterial(dark);
   // Upright biped: pelvis, thorax, head. Legs reach the floor from the hips.
   const pelvis=new THREE.Mesh(new THREE.CylinderGeometry(.2,.24,.2,6),metal);pelvis.position.y=.46;assembly.add(pelvis);
   const thorax=new THREE.Mesh(new THREE.CylinderGeometry(.3,.22,.48,6),metal);thorax.position.y=.8;assembly.add(thorax);
   // the abdomen hangs back and down, which is what makes the silhouette read as a fly
   const abdomen=new THREE.Mesh(new THREE.CylinderGeometry(.19,.07,.46,6),metal);
   abdomen.position.set(0,.66,.3);abdomen.rotation.x=.95;assembly.add(abdomen);
   const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.19,1),metal);head.position.set(0,1.14,-.05);assembly.add(head);
   for(const side of [-1,1]){
    const eye=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,1),metal);eye.position.set(side*.14,1.17,-.16);assembly.add(eye);
    const wing=new THREE.Mesh(new THREE.BoxGeometry(.2,.022,.8),metal);
    wing.position.set(side*.24,1.0,.36);wing.rotation.set(-.22,side*-.34,side*.12);wing.name=`wing-${side}`;assembly.add(wing);
   }
   const limbMetal=landing?inkMaterial():mechanicalMaterial(dark);
   const limbs=new THREE.Group();limbs.name='limbs';group.add(limbs);
   // A punch is a real angular body in the sim, so the arm is a real pivot here:
   // it rotates about the torso centre and the fist rides at the end of it.
   const makeArm=(name:string,side:number)=>{
    const pivot=new THREE.Group();pivot.position.set(side*.26,.95,0);pivot.name=name;
    const upper=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.52),limbMetal);upper.position.z=-.26;pivot.add(upper);
    const fist=new THREE.Mesh(new THREE.IcosahedronGeometry(.125,0),limbMetal);fist.position.z=-.56;pivot.add(fist);
    limbs.add(pivot);
   };
   makeArm('arm-L',-1);makeArm('arm-R',1);
   const makeLeg=(name:string,side:number)=>{
    const pivot=new THREE.Group();pivot.position.set(side*.13,.44,0);pivot.name=name;
    const thighM=new THREE.Mesh(new THREE.BoxGeometry(.11,.24,.11),limbMetal);thighM.position.y=-.12;pivot.add(thighM);
    const shin=new THREE.Mesh(new THREE.BoxGeometry(.09,.24,.09),limbMetal);shin.position.y=-.33;pivot.add(shin);
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.14,.06,.26),limbMetal);foot.position.set(0,-.46,-.05);pivot.add(foot);
    limbs.add(pivot);
   };
   makeLeg('leg-L',-1);makeLeg('leg-R',1);
   const ring=new THREE.Mesh(new THREE.RingGeometry(.88,.892,64),new THREE.MeshBasicMaterial({color:landing?0x333333:(dark?0x6f707a:0xdedee6),side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.01;group.add(ring);scene.add(group);return group;
  };
  // One mesh per deployable unit per side, pooled up front: a match may field
  // 1v1 or 5v5 and the renderer must not rebuild when the squad size changes.
  const teamA=Array.from({length:MAX_SQUAD},()=>makeBot(false));
  const teamB=Array.from({length:MAX_SQUAD},()=>makeBot(true));
  const bots=[...teamA,...teamB];
  const battleRoot=new THREE.Group();battleRoot.position.x=immersive?18:0;scene.add(battleRoot);
  for(const object of [grid,border,floor,...bots])battleRoot.add(object);
  const specimens: THREE.Group[]=[];
  if(immersive){for(let i=0;i<3;i++){const bot=makeBot(false);bot.scale.setScalar(3.2);bot.position.x=36;specimens.push(bot);} const hero=makeBot(false);hero.scale.setScalar(2.9);specimens.push(hero);}
  const stageRail=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5,-.2,0),new THREE.Vector3(42,-.2,0)]),new THREE.LineBasicMaterial({color:0x2c2d35}));scene.add(stageRail);stageRail.visible=immersive;
  const loader=new GLTFLoader();
  /** Fit a loaded chassis to the unit cell and re-skin it, then hand back copies. */


  const dressAll=(gltf:{scene:THREE.Group},targets:THREE.Group[],dark:boolean)=>{
   const model=gltf.scene;model.updateMatrixWorld(true);
   const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
   const scale=1.65/Math.max(size.x,size.y,size.z);model.scale.setScalar(scale);model.position.set(-center.x*scale,-box.min.y*scale+.04,-center.z*scale);
   const skin=landing?inkMaterial():mechanicalMaterial(dark);
   model.traverse(o=>{if(o instanceof THREE.Mesh){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());o.material=skin;}});
   targets.forEach((bot,n)=>{
    // clone for every unit but the first, which takes the original outright
    const instance=n===0?model:model.clone(true);
    const assembly=bot.getObjectByName('assembly')!;
    for(const child of [...assembly.children]){assembly.remove(child);disposeObject(child);}
    assembly.add(instance);
   });
  };
  const loadSquad=(chassisName:Chassis,targets:THREE.Group[],dark:boolean)=>{
   loader.load(`${import.meta.env.BASE_URL}models/${chassisName.toLowerCase()}.glb`,gltf=>{
    if(disposed){disposeObject(gltf.scene);return;}
    dressAll(gltf,targets,dark);
   },undefined,()=>{/* Keep the procedural bot if an asset cannot load. */});
  };
  // Fighters wear the generated model, bound to a skeleton rather than carved into
  // pieces. Each chassis .glb is a single welded island — one mesh, no skin, no
  // animation, ~6k unique positions with every limb fused to the torso — so slicing
  // it into parts leaves the shoulder and hip sockets open and the pieces drift off
  // their pivots. The limbs are still spatially separate even though the surface is
  // not, which is enough to fit a skeleton to the silhouette and weight the vertices
  // against it: the mesh then bends at the joints instead of coming apart.
  const rigs=new Map<THREE.Group,SkinnedBot>();
  const wear=(chassisName:Chassis,targets:THREE.Group[],dark:boolean)=>{
   loader.load(`${import.meta.env.BASE_URL}models/${chassisName.toLowerCase()}.glb`,gltf=>{
    if(disposed){disposeObject(gltf.scene);return;}
    let mesh:THREE.Mesh|null=null;
    gltf.scene.traverse(o=>{if(!mesh&&o instanceof THREE.Mesh)mesh=o;});
    if(!mesh){disposeObject(gltf.scene);return;}
    // fit and weight once per chassis; a 5v5 squad shares the bound geometry
    const bind=bindChassis(mesh as THREE.Mesh);
    for(const bot of targets){
     const rig=buildSkinnedBot(bind,mechanicalMaterial(dark),chassisName);
     const assembly=bot.getObjectByName('assembly')!;
     for(const child of [...assembly.children]){assembly.remove(child);disposeObject(child);}
     assembly.add(rig.mesh);
     rigs.set(bot,rig);
    }
    disposeObject(gltf.scene);
   },undefined,()=>{/* keep the procedural rig if the asset fails */});
  };
  if(showcase){loadSquad(chassis[0],teamA,false);}
  else{wear(chassis[0],teamA,false);wear(chassis[1],teamB,true);}
  specimens.forEach((bot,i)=>{
   loader.load(`${import.meta.env.BASE_URL}models/${(['DRONE','HORNET','TANK','DRONE'][i]||'DRONE').toLowerCase()}.glb`,gltf=>{
    if(disposed){disposeObject(gltf.scene);return;}
    dressAll(gltf,[bot],false);
   },undefined,()=>{});
  });
  const sparks=new THREE.Group();battleRoot.add(sparks);
  const sparkMaterial=new THREE.LineBasicMaterial({color:0xf4f4ef,transparent:true});
  for(let i=0;i<18;i++){const a=i*Math.PI*2/18;sparks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a)*.2,.1,Math.sin(a)*.2),new THREE.Vector3(Math.cos(a)*(.5+i%3*.2),.1+i%4*.1,Math.sin(a)*(.5+i%3*.2))]),sparkMaterial));}
  // A moon gives the dark room a reason and a horizon. Shaded off the world
  // normal rather than flat white, so it reads as a sphere, not a disc.
  // The moon surface: a 70-unit sphere sunk so its crown sits at y=0, which is
  // what gives the horizon its curve instead of a flat plane running to infinity.
  const ground=landing?new THREE.Mesh(new THREE.SphereGeometry(70,96,64),inkMaterial()):null;
  if(ground){ground.position.y=-70;scene.add(ground);}
  const moon=landing?new THREE.Mesh(new THREE.SphereGeometry(2.6,48,32),inkMaterial()):null;
  if(moon){moon.position.set(-7.5,3.4,-14.5);scene.add(moon);}
  // The landing has no HTML hero any more: the title is geometry in the room.
  const wordmark=landing?buildWordmark('FLYWEIGHT',inkMaterial(),{size:1,depth:2.6}):null;
  if(wordmark)scene.add(wordmark);
  const c=compGraph();
  // The landing runs pomme's night graph — gouache compose, charcoal ground, one
  // lamp pool — held to a neutral grey so the whole page stays black and white.
  let paperTexture:THREE.Texture|null=null;
  if(landing){
   paperTexture=new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}models/paper-delivery.webp`);
   paperTexture.colorSpace=THREE.SRGBColorSpace;
  }
  // The watercolour bleed offsets each channel separately, which is where its
  // colour fringing comes from. Collapsing the composed frame to luminance keeps
  // the treatment and leaves the page strictly black and white.
  // the scene washes in from a point at the centre, the casino scene's gouache reveal
  const mono=(n:ReturnType<typeof watercolorGraph>,ground:ReturnType<typeof watercolorGraph>)=>{
   const revealed=c.blend(impactRevealMask(c),ground,n);
   const l=c.luminance(revealed);return c.combine(l,l,l,1);
  };
  const printed=landing?c.renderLayer():mangaGritGraph(c,{paper:[.012,.012,.016],ink:[.93,.93,.9],grain:.55,dotScale:3.6,hatchScale:3.1});
  const compositor=new Compositor(renderer,scene,camera,printed,
   landing?{samples:4,renderScale:1,positionPass:'onChange'}:{samples:0,renderScale:.85});
  let fit=1,viewW=1,viewH=1;
  const resize=()=>{const {width,height}=element.getBoundingClientRect();viewW=width;viewH=Math.max(height,1);renderer.setSize(width,Math.max(height,1));camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();fit=Math.min(1,Math.max(.5,camera.aspect/1.55));};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});intersection.observe(element);
  const cameraTarget=new THREE.Vector3(),cameraPosition=new THREE.Vector3();
  let station=0, pointerX=0,pointerY=0;
  const pointer=(event:PointerEvent)=>{pointerX=event.clientX/innerWidth-.5;pointerY=event.clientY/innerHeight-.5;};
  if(immersive)window.addEventListener('pointermove',pointer,{passive:true});
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current:MatchFrame|null=null,previous:MatchFrame|null=null,receivedAt=0,hitAt=-1000,revealStart=0;
  // a new match flies the camera in from an establishing shot down to the ring
  let entryAt=-1e9,lastTick=-1;
  const draw=(now:number)=>{
   if(disposed)return;raf=requestAnimationFrame(draw);if(!visible||document.hidden)return;
   const next=incoming.current;
   if(next&&next!==current){previous=current&&next.tick>current.tick?current:next;current=next;receivedAt=now;
    // the tick counter restarting is what tells us a fresh match has begun
    if(lastTick<0||next.tick<lastTick)entryAt=now;lastTick=next.tick;if(next.hits.length||next.bots.some(b=>b.struck)){hitAt=now;const live=next.bots.filter(b=>b.hull>0),mid=live.length?live:next.bots;sparks.position.set(mid.reduce((t,b)=>t+b.x,0)/mid.length/arenaSize*12,.1,mid.reduce((t,b)=>t+b.y,0)/mid.length/arenaSize*12);}}
   const alpha=current&&previous?Math.min(1,(now-receivedAt)/Math.max(16.67,(current.tick-previous.tick)*1000/60)):1;
   const impact=Math.max(0,1-(now-hitAt)/240);
   const split=current?.teamSplit??1;
   bots.forEach((bot,i)=>{
    const team=i<MAX_SQUAD?0:1, slot=i%MAX_SQUAD;
    // team A occupies frame slots [0, split); team B occupies [split, end)
    const frameIndex=team===0?slot:split+slot;
    const unit=current&&frameIndex<current.bots.length&&(team===0?slot<split:true)?current.bots[frameIndex]:undefined;
    const idle=!current||!previous;
    bot.visible=showcase?i===0:idle?slot===0:!!unit&&unit.hull>0;
    if(!bot.visible)return;
    const assembly=bot.getObjectByName('assembly')!;
    if(unit&&previous&&!showcase){const a=previous.bots[frameIndex]??unit,b=unit;bot.position.set((a.x+(b.x-a.x)*alpha)/arenaSize*12,0,(a.y+(b.y-a.y)*alpha)/arenaSize*12);bot.rotation.y=-(a.heading+Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading))*alpha)-Math.PI/2;
     if(!reducedMotion){const drive=Math.min(1,Math.hypot(b.vx,b.vy)/4);assembly.position.y=Math.sin(now*.025)*.025*drive;assembly.rotation.z=Math.sin(now*.02)*.04*drive+Math.sin(now*.12)*impact*.12;assembly.rotation.x=Math.sin(now*.03)*.025*drive;}
    }else{bot.position.set(showcase?0:team?2:-2,showcase&&!reducedMotion?Math.sin(now*.0014)*.07:0,0);bot.rotation.y=reducedMotion?-.5:now*.00018+team*Math.PI;}
    if(showcase){bot.scale.setScalar(3.1);assembly.rotation.z=reducedMotion?0:Math.sin(now*.001)*.025;}
    const rig=rigs.get(bot);
    const limbs=bot.getObjectByName('limbs');
    if(rig&&unit&&!showcase){
     // The bound mesh takes its whole pose from poseBot — stride, guard, recovery and
     // the swing arrive together, and the bob falls out of planting the lower foot.
     poseSkinnedBot(rig,unit,chassis[team]);
     // The procedural rig kept its legs in a sibling group, so leaning the assembly
     // rocked a torso. This mesh is one body from the feet up and the same lean tips
     // the whole figure off the floor, so hold the assembly flat and let the hit read
     // as a much smaller rock instead.
     assembly.position.y=0;assembly.rotation.x=0;
     assembly.rotation.z=unit.blocked?-.05:unit.struck?(unit.recovery>0?.20:.13):0;
    }
    if(limbs){
     limbs.visible=!showcase&&!rig;
     if(unit&&!rig){
      // world swing angle is heading+arm, and the group already carries heading
      // with forward on local -Z, so the pivot turns by -arm.
      const al=limbs.getObjectByName('arm-L'),ar=limbs.getObjectByName('arm-R');
      // Guard, recovery and the swing all live on the same two arms, so the pose is a
      // blend: a raised guard tucks the fists in and up, recovery drops them, and a
      // punch overrides both. Without this the boxing is invisible — the sim has
      // been tracking guard and recovery all along with nothing showing it.
      const guard=unit.guard??0, open=unit.recovery>0;
      const tuck=guard*0.95;                       // elbows in when blocking
      const drop=open?0.42:0;                      // fists fall when you are open
      if(al){al.rotation.y=-unit.armL-tuck; al.rotation.x=drop-guard*0.5; al.position.y=0.95+guard*0.16-drop*0.22;}
      if(ar){ar.rotation.y=-unit.armR+tuck; ar.rotation.x=drop-guard*0.5; ar.position.y=0.95+guard*0.16-drop*0.22;}
      const phase=unit.gait*Math.PI*2;
      const ll=limbs.getObjectByName('leg-L'),lr=limbs.getObjectByName('leg-R');
      if(ll)ll.rotation.x=Math.sin(phase)*.55;
      if(lr)lr.rotation.x=Math.sin(phase+Math.PI)*.55;
      // the torso rides the stride, and a struck bot snaps back
      assembly.position.y+=Math.abs(Math.sin(phase))*.05;
      // a blocked hit barely moves you; a clean one taken while open rocks you hard
      if(unit.blocked)assembly.rotation.z-=.07;
      else if(unit.struck)assembly.rotation.z+=unit.recovery>0?.38:.22;
      // guarding crouches the stance a little, which reads as bracing
      if(guard>.25)assembly.position.y-=guard*.05;
      if(unit.struck)assembly.rotation.z+=.22;
     }
    }
    if(!reducedMotion)for(const side of [-1,1]){const wing=assembly.getObjectByName(`wing-${side}`);if(wing)wing.rotation.z=side*Math.sin(now*.022)*.12;}
   });
   grid.visible=border.visible=floor.visible=!showcase;
   if(current&&previous&&!showcase){const half=previous.arenaHalf+(current.arenaHalf-previous.arenaHalf)*alpha;border.scale.set(half*2/arenaSize,1,half*2/arenaSize);floor.scale.set(half*2/arenaSize,half*2/arenaSize,1);grid.scale.set(half*2/arenaSize,1,half*2/arenaSize);}
   if(showcase&&!reducedMotion){rings.rotation.y=now*.00004;if(immersive){const scroll=Math.min(1,window.scrollY/Math.max(1,window.innerHeight));camera.position.set(Math.sin(now*.00012)*.35,5+scroll*2,10-scroll);camera.lookAt(0,.1,0);}}
   sparks.visible=!showcase&&impact>0;sparks.scale.setScalar(1+(1-impact)*2);sparkMaterial.opacity=impact;
   if(!showcase&&!immersive){const zoom=current?Math.max(1,current.arenaHalf/(arenaSize/2)):1;
    // fly in: high and wide for the first moment, settling into the fight framing
    const t=Math.min(1,Math.max(0,(now-entryAt)/1500)),fly=reducedMotion?1:t*t*(3-2*t);
    camera.position.set(reducedMotion?0:Math.sin(now*.12)*impact*.1,(11.5-7.9*fly)*zoom,(27-14.6*fly)*zoom);camera.lookAt(0,.75,0);
    // the HUD owns the top and the rasters own the bottom, so bias the
    // fight into the clear band between them instead of the dead centre
    camera.setViewOffset(viewW,viewH,0,viewH*.16,viewW,viewH);}
   else if(!showcase)camera.position.x=reducedMotion?0:Math.sin(now*.12)*impact*.1;
   if(immersive){
    const heroAnchor=document.querySelector('.hero-model')?.getBoundingClientRect();
    const arenaAnchor=document.querySelector('.arena-shell')?.getBoundingClientRect();
    const labAnchor=document.querySelector('.lab-specimen')?.getBoundingClientRect();
    const anchors=[heroAnchor,arenaAnchor,labAnchor];
    let best=0,nearest=Infinity;
    anchors.forEach((r,i)=>{if(r){const distance=Math.abs(r.top+r.height*.5-innerHeight*.5);if(distance<nearest){nearest=distance;best=i;}}});
    station += (best-station)*(reducedMotion?1:.065);
    const anchor=anchors[best];
    const arenaWeight=Math.max(0,1-Math.abs(station-1));
    const targetX=station*18;
    cameraTarget.set(targetX,1.6*(1-arenaWeight),0);
    cameraPosition.set(targetX+(reducedMotion?0:pointerX*.3),6+arenaWeight*15+(reducedMotion?0:pointerY*.15),13+arenaWeight*8);
    camera.position.copy(cameraPosition);camera.lookAt(cameraTarget);
    if(anchor){const offsetX=innerWidth*.5-(anchor.left+anchor.width*.5),offsetY=innerHeight*.5-(anchor.top+anchor.height*.5);camera.setViewOffset(innerWidth,innerHeight,offsetX,offsetY,innerWidth,innerHeight);}
    specimens.forEach((bot,i)=>{bot.visible=i===3||['DRONE','HORNET','TANK'][i]===selectedChassis.current;bot.rotation.y=reducedMotion?-.5:now*.00016+(i===3?0:1);bot.position.y=reducedMotion?0:Math.sin(now*.0015+i)*.08;const assembly=bot.getObjectByName('assembly');if(assembly)assembly.rotation.z=reducedMotion?0:Math.sin(now*.001)*.025;});
    rings.visible=true;rings.position.x=best===2?36:0;rings.rotation.y=reducedMotion?0:now*.00003;
  }
   if(landing){
    if(wordmark){wordmark.scale.setScalar(.116*fit);wordmark.position.set(-3.6*fit,1.05,0);wordmark.rotation.set(-.03,.26,0);}
    const hero=bots[0];
    hero.visible=true;hero.scale.setScalar(2.45*fit);
    hero.position.set(4.5*fit,reducedMotion?0:Math.sin(now*.0011)*.12,.4);
    hero.rotation.y=reducedMotion?-.6:now*.00016;
    const heroAssembly=hero.getObjectByName('assembly');
    if(heroAssembly&&!reducedMotion)heroAssembly.rotation.z=Math.sin(now*.0009)*.03;
    rings.visible=true;rings.position.set(4.5*fit,-1.15,.4);rings.rotation.y=reducedMotion?0:now*.00004;
    camera.position.set(reducedMotion?0:Math.sin(now*.00011)*.3,3.3,16);camera.lookAt(0,.55,0);
    if(hatchU)advanceBoil(hatchU,now);
    if(moon)moon.rotation.y=now*.00002;
    // The wobble is the graph's own paint distortion, driven live: `loose`
    // wanders the wash off its edges and `bleed` widens it, so the whole frame
    // breathes instead of sitting still.
    const u=compositor.uniforms;
    if(!revealStart)revealStart=now;
    if(u.impactReturn)u.impactReturn.value=reducedMotion?1:Math.min(1,(now-revealStart)/1900);
    if(!reducedMotion){
     if(u.loose)u.loose.value=9+Math.sin(now*.00035)*3.4;
     if(u.bleed)u.bleed.value=8+Math.sin(now*.00027+1.3)*2.4;
     if(u.hazeX)u.hazeX.value=now*.000018;
     if(u.hazeY)u.hazeY.value=now*.000011;
    }
   }
   compositor.render();
  };
  void renderer.init().then(()=>{if(!disposed)raf=requestAnimationFrame(draw);}).catch(()=>{if(!disposed)setUnavailable(true);});
  return()=>{disposed=true;window.removeEventListener('pointermove',pointer);cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();compositor.dispose();hatchTex?.hatch.dispose();hatchTex?.paper.dispose();ground?.geometry.dispose();if(moon){moon.geometry.dispose();(moon.material as THREE.Material).dispose();}disposeObject(scene);renderer.dispose();renderer.domElement.remove();};
 },[arenaSize,showcase,chassis[0],chassis[1],immersive,landing]);
 return <div className="arena-canvas" ref={host} role="img" aria-label={showcase?'Animated mechanical insect specimen in manga shading':'Live robot battle with moving arena walls'}>{unavailable&&<p className="render-fallback">3D rendering unavailable. Neural activity and match readouts remain live below.</p>}</div>;
}
