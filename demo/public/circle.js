// Trust Circle front end.
// 1. A scroll-driven story (the problem, then Stellar), closed by drawing a circle.
// 2. A toy island where each district is a member's country. The panel drives the real demo
//    through the server API (/api/state, /api/contribute, /api/payout…) and Freighter.
//    Opened without the demo server, it falls back to a local simulation.
(() => {
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EXPLORER = 'https://stellar.expert/explorer/testnet';
const PI = Math.PI;

/* Members, in the same order as FAMILY in demo/lib.mjs (= payout rotation order). */
const FAM = [
  { code:'XLM',  name:'You',  city:'Nova Lumen',   country:'Stellaria', rate:3.5,  sym:'XLM', color:'#2bb3a3', imaginary:true },
  { code:'EURC', name:'Léa',  city:'Paris',        country:'France',    rate:0.86, sym:'€',   color:'#4c7cf0', lat:48.86, lon:2.35 },
  { code:'GYEN', name:'Hugo', city:'Tokyo',        country:'Japan',     rate:148,  sym:'¥',   color:'#ec5f8f', lat:35.68, lon:139.69 },
  { code:'AUDD', name:'Inès', city:'Sydney',       country:'Australia', rate:1.52, sym:'A$',  color:'#eaa23a', lat:-33.87, lon:151.21 },
  { code:'NGNC', name:'Noah', city:'Lagos',        country:'Nigeria',   rate:1530, sym:'₦',   color:'#33a671', lat:6.52, lon:3.38 },
  { code:'ARST', name:'Emma', city:'Buenos Aires', country:'Argentina', rate:1380, sym:'$',   color:'#8a6ae6', lat:-34.60, lon:-58.38 },
];
const LOOK = Object.fromEntries(FAM.map((f) => [f.code, f]));

const $ = (id) => document.getElementById(id);
const ss = (a,b,x) => { const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
const lerp = (a,b,t) => a+(b-a)*t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, max=2) => Number(n).toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:max });
const short = (g) => `${g.slice(0,4)}…${g.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// real average great-circle distance between the five real cities
const hav = (a,b) => { const R=6371, r=PI/180, dLa=(b.lat-a.lat)*r, dLo=(b.lon-a.lon)*r;
  const h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
const REAL = FAM.filter((f) => !f.imaginary);
let dsum=0, dn=0;
for (let i=0;i<REAL.length;i++) for (let j=i+1;j<REAL.length;j++) { dsum+=hav(REAL[i],REAL[j]); dn++; }
const AVG_KM = Math.round(dsum/dn);

/* ---------- renderer ---------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.autoClear = false;
renderer.setClearColor(0xf4f7fb,1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const INK='#0e1530', SUN='#ffd23f';
function tex(draw){ const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d'); draw(g); const t=new THREE.CanvasTexture(c); t.anisotropy=4; return t; }
// white "coin" with a soft drop shadow, a thin coloured rim and the currency symbol
function orbTex(sym,color){ return tex((g) => {
  const sh=g.createRadialGradient(128,140,40,128,140,124); sh.addColorStop(0,'rgba(14,21,48,.16)'); sh.addColorStop(1,'rgba(14,21,48,0)');
  g.fillStyle=sh; g.fillRect(0,0,256,256);
  g.beginPath(); g.arc(128,124,76,0,PI*2); g.fillStyle='#fff'; g.fill();
  g.lineWidth=5; g.strokeStyle=color; g.stroke();
  g.fillStyle=INK; g.textAlign='center'; g.textBaseline='middle';
  g.font=`600 ${sym.length>2?40:sym.length>1?50:62}px Unbounded, Avenir Next, system-ui, sans-serif`; g.fillText(sym,128,128);
}); }
const HUBT=tex((g) => { const sh=g.createRadialGradient(128,140,40,128,140,124); sh.addColorStop(0,'rgba(14,21,48,.2)'); sh.addColorStop(1,'rgba(14,21,48,0)');
  g.fillStyle=sh; g.fillRect(0,0,256,256); g.beginPath(); g.arc(128,124,76,0,PI*2); g.fillStyle=INK; g.fill();
  g.beginPath(); g.arc(128,124,30,0,PI*2); g.fillStyle=SUN; g.fill(); });
const DOT=tex((g) => { g.beginPath(); g.arc(128,128,100,0,PI*2); g.fillStyle='#fff'; g.fill(); });

/* ---------- sky shader ---------- */
const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const bgU = { uTime:{value:0}, uRes:{value:new THREE.Vector2(1,1)}, uWarm:{value:0}, uGold:{value:0}, uDim:{value:0}, uCity:{value:0} };
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({
  uniforms:bgU, depthWrite:false, depthTest:false,
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader:`
  precision highp float; varying vec2 vUv;
  uniform float uTime,uWarm,uGold,uDim,uCity; uniform vec2 uRes;
  float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
  void main(){
    vec2 uv=vUv; vec2 p=(uv-.5)*vec2(uRes.x/uRes.y,1.); float t=uTime;
    vec3 col=mix(vec3(.985,.99,1.),vec3(.80,.88,.98),smoothstep(.1,1.05,uv.y));
    float c=fbm(p*vec2(1.1,2.6)+vec2(t*.012,0.)), c2=fbm(p*vec2(2.2,4.)+vec2(-t*.02,3.));
    col=mix(col,vec3(1.),smoothstep(.55,.8,c)*.6*(1.-uCity*.5));
    col=mix(col,vec3(1.),smoothstep(.62,.86,c2)*.3);
    col=mix(col,vec3(1.,.95,.93),uWarm*.55);
    col+=vec3(1.,.86,.4)*exp(-length(p-vec2(.2,.02))*2.8)*.22*uGold;
    col=mix(col,vec3(.09,.12,.24),uDim*.72);
    col+=(h(uv*uRes+t)-.5)*.012;
    gl_FragColor=vec4(col,1.);
  }`,
})));

/* ================= STORY ================= */
const story = new THREE.Scene();
const sCam = new THREE.PerspectiveCamera(45,1,.1,100);
sCam.position.set(0,0,13);
let STAGE = { cx:3.2, cy:.2, sx:1 };

// the five real members first, then "You" (who appears with Stellar)
const SM = [1,2,3,4,5,0].map((i) => FAM[i]);
// map-like layout: Americas left, Asia/Oceania right, kept in the right half so the text column stays clear
const geo = [ {x:3.6,y:2.7}, {x:7.0,y:1.7}, {x:6.6,y:-2.3}, {x:3.3,y:-.1}, {x:1.0,y:-2.7}, {x:.4,y:2.2} ];

const orbs = SM.map((m) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:orbTex(m.sym,m.color), transparent:true, depthWrite:false }));
  s.renderOrder=3; story.add(s); return s;
});
document.fonts && document.fonts.load('600 60px Unbounded').then(() => orbs.forEach((o,i) => { o.material.map=orbTex(SM[i].sym,SM[i].color); o.material.needsUpdate=true; })).catch(() => {});
const hub = new THREE.Sprite(new THREE.SpriteMaterial({ map:HUBT, transparent:true, opacity:0, depthWrite:false }));
hub.renderOrder=4; story.add(hub);

const DN=260, dpos=new Float32Array(DN*3), dseed=new Float32Array(DN);
for (let i=0;i<DN;i++) { dpos[i*3]=(Math.random()-.5)*26; dpos[i*3+1]=(Math.random()-.5)*16; dpos[i*3+2]=(Math.random()-.5)*6-3; dseed[i]=Math.random(); }
const dgeo=new THREE.BufferGeometry(); dgeo.setAttribute('position',new THREE.BufferAttribute(dpos,3));
story.add(new THREE.Points(dgeo,new THREE.PointsMaterial({ size:.07, map:DOT, color:0x0e1530, transparent:true, opacity:.14, depthWrite:false })));

// Story lines are ribbons (WebGL ignores lineWidth): ink on white, like a technical drawing.
const ribbonGeo=new THREE.PlaneGeometry(1,1);
function ribbon(color, order=1){ const m=new THREE.Mesh(ribbonGeo,new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0, depthWrite:false }));
  m.renderOrder=order; story.add(m); return m; }
function setRibbon(m,a,b,w){ const dx=b.x-a.x, dy=b.y-a.y; m.position.set((a.x+b.x)/2,(a.y+b.y)/2,0); m.rotation.z=Math.atan2(dy,dx); m.scale.set(Math.hypot(dx,dy),w,1); }
const ring=new THREE.Mesh(new THREE.TorusGeometry(1,.014,8,200),new THREE.MeshBasicMaterial({ color:0x0e1530, transparent:true, opacity:.5, depthWrite:false }));
ring.renderOrder=1; story.add(ring);
const pairs=[]; for (let i=0;i<5;i++) for (let j=i+1;j<5;j++) pairs.push([i,j]);
const fric=pairs.map(() => ribbon(0x0e1530));
const hubL=[0,1,2,3,4,5].map(() => ribbon(0x0e1530));

const PN=30, ppos=new Float32Array(PN*3);
const pgeo=new THREE.BufferGeometry(); pgeo.setAttribute('position',new THREE.BufferAttribute(ppos,3));
const packets=new THREE.Points(pgeo,new THREE.PointsMaterial({ size:.2, map:DOT, color:0xffd23f, transparent:true, opacity:0, depthWrite:false }));
packets.renderOrder=2; story.add(packets);

const olabWrap=$('orbLabels');
const olabs=SM.map((m) => { const d=document.createElement('div'); d.className='olab'; d.style.color=m.color;
  d.innerHTML=`<i></i><span>${esc(m.name)}</span><small>${esc(m.city)}</small>`; olabWrap.appendChild(d); return d; });
// fee tags shown on a few links during "friction"
const FEES=[[0,1,'FX <b>−3.1%</b>'],[1,2,'<b>3 days</b>'],[0,4,'fee <b>$18</b>'],[3,4,'FX <b>−4.5%</b>'],[2,3,'<b>?</b> paid'],[1,4,'fee <b>$12</b>']];
const feeEls=FEES.map(([,,h]) => { const d=document.createElement('div'); d.className='fee'; d.innerHTML=h; $('feeTags').appendChild(d); return d; });

const chaps=[...document.querySelectorAll('.chap')];
const railItems=[...document.querySelectorAll('#rail li')];
const needle=$('needle'), ruler=$('rail');
const hint=$('hint');
const COLS=5, strips=[];
for (let c=0;c<COLS;c++) { const col=document.createElement('span'); col.className='dc';
  const st=document.createElement('span'); st.className='strip';
  for (let d=0;d<=10;d++) { const s=document.createElement('span'); s.textContent=d%10; st.appendChild(s); }
  col.appendChild(st); $('odo').appendChild(col); strips.push({ col, st }); }
function setOdo(v){
  for (let c=0;c<COLS;c++) { const p=10**(COLS-1-c), raw=v/p; let d=raw%10;
    if (c<COLS-1) { const lower=(v%p)/p; d=Math.floor(raw)%10+Math.max(0,(lower-.9)/.1); }
    strips[c].st.style.transform=`translateY(${-d}em)`;
    strips[c].col.classList.toggle('lead', v<p && c<COLS-1); }
}

/* ---------- input ---------- */
let mode='story', target=0, prog=0, gateOpen=false, lastInput=performance.now();
const clamp01=(x) => Math.min(1,Math.max(0,x));
addEventListener('wheel',(e) => {
  if (mode==='city' && e.target.closest && e.target.closest('.panel')) return; // let the panel scroll
  e.preventDefault(); lastInput=performance.now();
  if (mode==='story') { if (gateOpen && e.deltaY>0) return; target=clamp01(target+e.deltaY*.00055); }
  else cityZoom(e.deltaY);
},{ passive:false });
let ty=null;
addEventListener('touchstart',(e) => { ty=e.touches[0].clientY; },{ passive:true });
addEventListener('touchmove',(e) => { if (mode!=='story'||ty===null) return; const y=e.touches[0].clientY;
  if (!(gateOpen && ty-y>0)) target=clamp01(target+(ty-y)*.0016); ty=y; },{ passive:true });
addEventListener('keydown',(e) => { if (mode!=='story') return;
  if (['ArrowDown','PageDown',' '].includes(e.key)) { e.preventDefault(); if (!gateOpen) target=clamp01(Math.round(target*6+1)/6); }
  if (['ArrowUp','PageUp'].includes(e.key)) { e.preventDefault(); target=clamp01(Math.round(target*6-1)/6); }
  if (e.key==='Enter' && gateOpen) closeCircle();
});
let mx=0,my=0; addEventListener('pointermove',(e) => { mx=e.clientX/innerWidth-.5; my=e.clientY/innerHeight-.5; });
let VX=0, VY=0, VW=innerWidth, VH=innerHeight; // the canvas window inside the page frame

/* ---------- gate: draw a circle ---------- */
const gate=$('gate'), draw=$('draw'), dctx=draw.getContext('2d'), miss=$('miss');
let pts=[], drawing=false, closing=false;
function sizeDraw(){ const r=Math.min(devicePixelRatio,2); draw.width=innerWidth*r; draw.height=innerHeight*r; dctx.setTransform(r,0,0,r,0,0); }
function paintPath(){
  dctx.clearRect(0,0,innerWidth,innerHeight); if (pts.length<2) return;
  dctx.lineCap='round'; dctx.lineJoin='round';
  dctx.strokeStyle='#fff'; dctx.lineWidth=16; dctx.shadowColor='rgba(255,255,255,.7)'; dctx.shadowBlur=22;
  dctx.beginPath(); dctx.moveTo(pts[0][0],pts[0][1]); for (const p of pts) dctx.lineTo(p[0],p[1]); dctx.stroke();
}
draw.addEventListener('pointerdown',(e) => { if (closing) return; drawing=true; pts=[[e.clientX,e.clientY]]; miss.textContent=''; draw.setPointerCapture(e.pointerId); });
draw.addEventListener('pointermove',(e) => { if (!drawing) return; pts.push([e.clientX,e.clientY]); paintPath(); });
draw.addEventListener('pointerup',() => { if (!drawing) return; drawing=false;
  if (isCircle(pts)) closeCircle();
  else { miss.textContent='Almost. Go all the way round without lifting.'; setTimeout(() => { if (!closing) { pts=[]; paintPath(); } },500); }
});
function isCircle(P){
  if (P.length<12) return false;
  let cx=0,cy=0; for (const p of P) { cx+=p[0]; cy+=p[1]; } cx/=P.length; cy/=P.length;
  const rs=P.map((p) => Math.hypot(p[0]-cx,p[1]-cy)); const mean=rs.reduce((a,b) => a+b,0)/rs.length;
  if (mean<35) return false;
  const sd=Math.sqrt(rs.reduce((a,r) => a+(r-mean)**2,0)/rs.length);
  if (sd/mean>.38) return false;
  let sweep=0; for (let i=1;i<P.length;i++) { let d=Math.atan2(P[i][1]-cy,P[i][0]-cx)-Math.atan2(P[i-1][1]-cy,P[i-1][0]-cx);
    if (d>PI) d-=2*PI; if (d<-PI) d+=2*PI; sweep+=d; }
  return Math.abs(sweep)>PI*1.7;
}
// hold-to-close: an alternative to drawing (Enter also works)
const holdBtn=$('gateSkip'), holdProg=$('holdProg'); let holdT=0, holdRaf=0;
function holdStep(){ const k=Math.min(1,(performance.now()-holdT)/1100); holdProg.style.strokeDashoffset=String(119.4*(1-k));
  if (k>=1) { holdT=0; closeCircle(); return; } holdRaf=requestAnimationFrame(holdStep); }
function holdEnd(){ if (!holdT) return; holdT=0; cancelAnimationFrame(holdRaf); holdProg.style.transition='stroke-dashoffset .3s'; holdProg.style.strokeDashoffset='119.4'; }
holdBtn.addEventListener('pointerdown',(e) => { e.stopPropagation(); if (closing) return; holdProg.style.transition='none'; holdT=performance.now(); holdStep(); });
['pointerup','pointerleave','pointercancel'].forEach((ev) => holdBtn.addEventListener(ev,holdEnd));
holdBtn.addEventListener('keydown',(e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); closeCircle(); } });

const flash=$('flash');
let ringClose=0, closeT0=0;
function closeCircle(){
  if (closing) return; closing=true; closeT0=performance.now();
  if (pts.length<2) { const cx=innerWidth/2, cy=innerHeight/2, r=Math.min(innerWidth,innerHeight)*.22; pts=[];
    for (let i=0;i<=64;i++) { const a=i/64*PI*2-PI/2; pts.push([cx+Math.cos(a)*r, cy+Math.sin(a)*r]); } }
  paintPath();
  flash.animate([{opacity:0},{opacity:1,offset:.55},{opacity:0}],{ duration:1500, delay:900, easing:'ease-in-out' });
  setTimeout(enterCity,1720);
}

/* ================= CITY ================= */
const polar=(r,a,y=0) => new THREE.Vector3(Math.cos(a)*r,y,-Math.sin(a)*r);
const lam=(c,o={}) => new THREE.MeshLambertMaterial(Object.assign({ color:c },o));
let city=null, cCam=null, cityT0=0, cityPackets=[], pulseT=-1, pulseIdx=0;
const orbit={ theta:0, el:.7, dist:70, tTheta:null };

function buildCity(){
  const S=new THREE.Scene(); S.fog=new THREE.Fog(0xf1f5fa,90,200);
  S.add(new THREE.HemisphereLight(0xffffff,0xd9dde6,.78));
  const sun=new THREE.DirectionalLight(0xfff6e8,.72); sun.position.set(-30,55,30); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{ left:-36, right:36, top:36, bottom:-36, near:1, far:160 });
  sun.shadow.bias=-.0006; sun.shadow.radius=6; S.add(sun);
  const shadowy=(m) => { m.castShadow=true; m.receiveShadow=true; return m; };
  const add=(m,parent=S) => { parent.add(m); return m; };

  const water=add(new THREE.Mesh(new THREE.CircleGeometry(220,72),lam(0xd6e9f4))); water.rotation.x=-PI/2; water.position.y=-.7;
  const foam=add(new THREE.Mesh(new THREE.RingGeometry(29.2,30.4,96),lam(0xffffff,{ transparent:true, opacity:.9 }))); foam.rotation.x=-PI/2; foam.position.y=-.66;
  const island=add(new THREE.Mesh(new THREE.CylinderGeometry(29,29.6,1.4,96),lam(0xe9e6df))); island.position.y=-.7; island.receiveShadow=true;
  const grass=add(new THREE.Mesh(new THREE.CircleGeometry(28.4,96),lam(0xf8f7f4))); grass.rotation.x=-PI/2; grass.position.y=.005; grass.receiveShadow=true;

  // instanced props
  const pools={};
  const G={
    box:(() => { const g=new THREE.BoxGeometry(1,1,1); g.translate(0,.5,0); return g; })(),
    pyr:(() => { const g=new THREE.ConeGeometry(.72,1,4); g.rotateY(PI/4); g.translate(0,.5,0); return g; })(),
    cone:(() => { const g=new THREE.ConeGeometry(.5,1,8); g.translate(0,.5,0); return g; })(),
    ball:new THREE.SphereGeometry(.5,14,10),
    cyl:(() => { const g=new THREE.CylinderGeometry(.5,.5,1,10); g.translate(0,.5,0); return g; })(),
    oct:new THREE.OctahedronGeometry(.5,0),
  };
  const _e=new THREE.Euler();
  const put=(geo,color,x,y,z,sx,sy,sz,ry=0) => (pools[geo]||(pools[geo]={ geo:G[geo], items:[] })).items.push({
    m:new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(_e.set(0,ry,0)),new THREE.Vector3(sx,sy,sz)),
    c:new THREE.Color(color) });
  const pick=(a) => a[Math.floor(Math.random()*a.length)];
  const rnd=(a,b) => a+Math.random()*(b-a);
  const tree={
    round:(x,z,s=1,c=0xa9cfa2,trunk=0xcbbba6) => { put('cyl',trunk,x,0,z,.22*s,.9*s,.22*s); put('ball',c,x,1.25*s,z,1.3*s,1.2*s,1.3*s); },
    cherry:(x,z,s=1) => { put('cyl',0xcbbba6,x,0,z,.2*s,.9*s,.2*s); put('ball',pick([0xf9cfdc,0xfbdbe5,0xf5c0d1]),x,1.25*s,z,1.5*s,1.1*s,1.5*s); },
    palm:(x,z,s=1) => { put('cyl',0xd4c4ac,x,0,z,.16*s,2.6*s,.16*s);
      for (let k=0;k<5;k++) { const a=k/5*PI*2; put('box',0x9cc896,x+Math.cos(a)*.55*s,2.55*s,z+Math.sin(a)*.55*s,1.3*s,.12*s,.4*s,-a); } },
  };

  const SECT=PI*2/6, R0=7, R1=27.5, occupied=[];
  const free=(x,z,r) => occupied.every((o) => Math.hypot(o.x-x,o.z-z)>o.r+r) && Math.hypot(x,z)<R1-r && Math.hypot(x,z)>R0+r;
  const claim=(x,z,r) => occupied.push({ x, z, r });
  const spot=(a,r,rMin,rMax,spread=.42) => { for (let g=0;g<300;g++) { const p=polar(rnd(rMin,rMax),a+rnd(-spread,spread)*SECT); if (free(p.x,p.z,r)) { claim(p.x,p.z,r); return p; } } return null; };

  const districts=FAM.map((f,i) => {
    const a=i*SECT-PI/2;
    const pastel=new THREE.Color(f.color).lerp(new THREE.Color(0xfbfaf7),.88);
    const ground=add(new THREE.Mesh(new THREE.RingGeometry(R0+.3,R1,40,1,a-SECT/2+.035,SECT-.07),lam(pastel)));
    ground.rotation.x=-PI/2; ground.position.y=.02; ground.receiveShadow=true;
    for (let k=0;k<7;k++) { const p=polar(R1-.45,a-SECT/2+.16+k*(SECT-.32)/6); put('cyl',f.color,p.x,0,p.z,.32,.22,.32); }
    return { a, code:f.code, center:polar(16,a), hub:polar(16,a,1.2), anchor:new THREE.Vector3() };
  });
  for (let i=0;i<6;i++) { const a=i*SECT-PI/2+SECT/2, mid=polar((R0+R1)/2,a);
    const road=add(new THREE.Mesh(new THREE.PlaneGeometry(R1-R0,.9),lam(0xe4e7ee))); road.rotation.x=-PI/2; road.rotation.z=a; road.position.set(mid.x,.04,mid.z); road.receiveShadow=true; }

  // the plaza: the circle itself
  shadowy(add(new THREE.Mesh(new THREE.CylinderGeometry(6.6,6.9,.35,64),lam(0xffffff)))).position.y=.17;
  add(new THREE.Mesh(new THREE.CylinderGeometry(3.2,3.2,.2,48),lam(0xc9e4f2))).position.y=.4;
  const tring=shadowy(add(new THREE.Mesh(new THREE.TorusGeometry(4.6,.18,12,120),lam(0xffd23f,{ emissive:0x5a4300, emissiveIntensity:.2 })))); tring.rotation.x=PI/2; tring.position.y=.75;
  shadowy(add(new THREE.Mesh(new THREE.CylinderGeometry(.35,.55,4,16),lam(0xffffff)))).position.y=2.4;
  const orb=shadowy(add(new THREE.Mesh(new THREE.SphereGeometry(.9,32,24),lam(0xffd23f,{ emissive:0xc99400, emissiveIntensity:.3 })))); orb.position.y=5.1;
  FAM.forEach((f,i) => { const p=polar(5.6,districts[i].a); put('cyl',f.color,p.x,.35,p.z,.6,.14,.6); });

  const floaters=[];
  const B={
    // STELLARIA (imaginary): crystal spire, floating islets, orbiting rings
    XLM(d){ const c=polar(16.5,d.a); claim(c.x,c.z,3);
      const crystal=lam(0x5eead4,{ transparent:true, opacity:.92, emissive:0x0f766e, emissiveIntensity:.25 });
      const main=shadowy(add(new THREE.Mesh(new THREE.OctahedronGeometry(1.4,0),crystal))); main.scale.set(1,5,1); main.position.set(c.x,7,c.z);
      floaters.push({ m:main, y:7, sp:.8, ph:0, rot:.3 });
      [0,1].forEach((k) => { const r=shadowy(add(new THREE.Mesh(new THREE.TorusGeometry(3+k*1.1,.12,8,64),lam(k?0xffc53d:0xffffff))));
        r.position.set(c.x,6.5+k*.8,c.z); r.rotation.x=PI/2+.35*(k?-1:1); floaters.push({ m:r, y:r.position.y, sp:.5, ph:k, spin:k?-.5:.4 }); });
      d.anchor.set(c.x,15.4,c.z);
      for (let k=0;k<5;k++) { const p=spot(d.a,1.6,9,25); if (!p) break; const y=rnd(4,8);
        const rock=shadowy(add(new THREE.Mesh(new THREE.ConeGeometry(1.3,2.2,6),lam(0xdfe3ea)))); rock.rotation.x=PI; rock.position.set(p.x,y,p.z);
        const top=shadowy(add(new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.3,.3,6),lam(0xe6f6f1)))); top.position.set(p.x,y+1.2,p.z);
        const cr=shadowy(add(new THREE.Mesh(new THREE.OctahedronGeometry(.45,0),crystal))); cr.scale.set(1,2.6,1); cr.position.set(p.x,y+2.4,p.z);
        [rock,top,cr].forEach((m,j) => floaters.push({ m, y:m.position.y, sp:.6+k*.07, ph:k*1.3, rot:j===2?.6:0 })); }
      for (let k=0;k<9;k++) { const p=spot(d.a,.9,8,27); if (!p) break; const h=rnd(1.2,3.6);
        put('oct',pick([0xc8f1ea,0xe3f7f3,0x9fe3d6,0xffffff]),p.x,h/2+.1,p.z,.9,h,.9,rnd(0,PI)); }
      for (let k=0;k<6;k++) { const p=spot(d.a,1.1,9,26); if (!p) break;
        const dome=shadowy(add(new THREE.Mesh(new THREE.SphereGeometry(1,20,12,0,PI*2,0,PI/2),lam(0xffffff)))); dome.position.copy(p); dome.scale.setScalar(rnd(.9,1.3)); }
    },
    // FRANCE: Eiffel Tower, Haussmann blocks with slate roofs, round trees
    EURC(d){ const c=polar(16.5,d.a); claim(c.x,c.z,3.6);
      const g=new THREE.Group(); g.position.copy(c); const iron=lam(0xb08d6a);
      for (let k=0;k<4;k++) { const sx=k%2?1:-1, sz=k<2?1:-1;
        const leg=new THREE.Mesh(new THREE.BoxGeometry(.55,3.5,.55),iron); leg.position.set(sx*1.15,1.6,sz*1.15); leg.rotation.z=sx*.3; leg.rotation.x=-sz*.3; g.add(shadowy(leg)); }
      const p1=new THREE.Mesh(new THREE.BoxGeometry(2.4,.32,2.4),iron); p1.position.y=3.25; g.add(shadowy(p1));
      const mid=new THREE.Mesh(new THREE.CylinderGeometry(.42,1.05,3.6,4),iron); mid.rotation.y=PI/4; mid.position.y=5.2; g.add(shadowy(mid));
      const p2=new THREE.Mesh(new THREE.BoxGeometry(1.2,.24,1.2),iron); p2.position.y=7.05; g.add(shadowy(p2));
      const top=new THREE.Mesh(new THREE.CylinderGeometry(.1,.45,4.6,4),iron); top.rotation.y=PI/4; top.position.y=9.4; g.add(shadowy(top));
      const ant=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1.2,6),lam(0xffffff)); ant.position.y=12.2; g.add(ant);
      g.rotation.y=-d.a; add(g); d.anchor.set(c.x,13.6,c.z);
      for (let k=0;k<13;k++) { const p=spot(d.a,1.4,9,26); if (!p) break; const w=rnd(1.8,2.6), dd=rnd(1.6,2.2), h=rnd(2,3.2), ry=-d.a+rnd(-.1,.1);
        put('box',pick([0xfbf8f2,0xf5f0e7,0xf8f4ec]),p.x,0,p.z,w,h,dd,ry); put('pyr',0xc6ccd8,p.x,h,p.z,w*1.05,.7,dd*1.05,ry); }
      for (let k=0;k<12;k++) { const p=spot(d.a,.7,8,27); if (p) tree.round(p.x,p.z,rnd(.8,1.05)); }
    },
    // JAPAN: Mount Fuji, five-storey pagoda, torii gate, cherry trees
    GYEN(d){ const f=polar(23.5,d.a); claim(f.x,f.z,5.4);
      shadowy(add(new THREE.Mesh(new THREE.ConeGeometry(5.4,7.2,40),lam(0xb9c6e2)))).position.set(f.x,3.6,f.z);
      shadowy(add(new THREE.Mesh(new THREE.ConeGeometry(2.25,3,40),lam(0xffffff)))).position.set(f.x,5.72,f.z);
      const c=polar(14.5,d.a-.12); claim(c.x,c.z,2.4);
      const g=new THREE.Group(); g.position.copy(c);
      let y=0; for (let k=0;k<5;k++) { const s=1-k*.13;
        const body=new THREE.Mesh(new THREE.BoxGeometry(1.7*s,1.05,1.7*s),lam(0xd8564e)); body.position.y=y+.52; g.add(shadowy(body));
        const roof=new THREE.Mesh(new THREE.CylinderGeometry(.6*s,1.85*s,.45,4),lam(0x4b546e)); roof.rotation.y=PI/4; roof.position.y=y+1.25; g.add(shadowy(roof));
        y+=1.3; }
      const sp=new THREE.Mesh(new THREE.CylinderGeometry(.06,.1,1.6,6),lam(0xffc53d)); sp.position.y=y+.6; g.add(sp);
      g.rotation.y=-d.a; add(g); d.anchor.set(c.x,y+2.4,c.z);
      const t=polar(9.6,d.a+.08); claim(t.x,t.z,1.6);
      const tg=new THREE.Group(); tg.position.copy(t); tg.rotation.y=d.a+PI/2; const red=lam(0xe0554a), dark=lam(0x3a3f55);
      [-1,1].forEach((s) => { const post=new THREE.Mesh(new THREE.CylinderGeometry(.16,.18,2.6,10),red); post.position.set(s*1.05,1.3,0); tg.add(shadowy(post)); });
      const kasagi=new THREE.Mesh(new THREE.BoxGeometry(3.2,.26,.36),dark); kasagi.position.y=2.7; tg.add(shadowy(kasagi));
      const nuki=new THREE.Mesh(new THREE.BoxGeometry(2.6,.18,.24),red); nuki.position.y=2.15; tg.add(shadowy(nuki));
      add(tg);
      for (let k=0;k<12;k++) { const p=spot(d.a,1.2,9,22); if (!p) break; const w=rnd(1.3,1.8), h=rnd(1,1.5);
        put('box',pick([0xfbf8f2,0xf6f1e8]),p.x,0,p.z,w,h,w,-d.a); put('pyr',0x8790a6,p.x,h,p.z,w*1.25,.75,w*1.25,-d.a); }
      for (let k=0;k<11;k++) { const p=spot(d.a,.8,8,27); if (p) tree.cherry(p.x,p.z,rnd(.8,1.1)); }
    },
    // AUSTRALIA: Sydney Opera House by the water, Harbour Bridge arch, eucalyptus, terracotta roofs
    AUDD(d){ const c=polar(21,d.a); claim(c.x,c.z,4.2);
      const g=new THREE.Group(); g.position.copy(c); g.rotation.y=d.a;
      const podium=new THREE.Mesh(new THREE.BoxGeometry(6.4,.8,3.6),lam(0xefe7da)); podium.position.y=.4; g.add(shadowy(podium));
      const shellGeo=new THREE.SphereGeometry(1,22,10,0,PI,0,PI/2), white=lam(0xfbfaf4,{ side:THREE.DoubleSide });
      [[-.9,[[-2,1.5,2.6],[-.5,1.25,2.2],[.9,1,1.7],[2.1,.75,1.2]]],[.95,[[-1.4,1.05,1.9],[.1,.85,1.5],[1.4,.65,1.1]]]].forEach(([z,shells]) =>
        shells.forEach(([x,w,h]) => { const s=new THREE.Mesh(shellGeo,white); s.scale.set(w,h,w*.9); s.rotation.y=-PI/2; s.rotation.z=-.18; s.position.set(x,.8,z); g.add(shadowy(s)); }));
      add(g); d.anchor.set(c.x,4.6,c.z);
      const bc=polar(18,d.a+.3), bg=new THREE.Group(); bg.position.copy(bc); bg.rotation.y=d.a+PI/2; claim(bc.x,bc.z,3.4);
      const steel=lam(0xa9b2c3);
      const arch=new THREE.Mesh(new THREE.TorusGeometry(3.1,.22,8,40,PI),steel); bg.add(shadowy(arch));
      const deck=new THREE.Mesh(new THREE.BoxGeometry(7.6,.25,1),steel); deck.position.y=1.5; bg.add(shadowy(deck));
      [-3.4,3.4].forEach((x) => { const py=new THREE.Mesh(new THREE.BoxGeometry(.9,2.4,1.2),lam(0xe8e1d4)); py.position.set(x,1.2,0); bg.add(shadowy(py)); });
      add(bg);
      for (let k=0;k<14;k++) { const p=spot(d.a,1.2,8.5,24); if (!p) break; const w=rnd(1.4,2), h=rnd(1,1.5);
        put('box',pick([0xffffff,0xf8f4ec]),p.x,0,p.z,w,h,w*.9,-d.a); put('pyr',pick([0xe9a890,0xe3998a]),p.x,h,p.z,w*1.25,.85,w*1.15,-d.a); }
      for (let k=0;k<12;k++) { const p=spot(d.a,.8,8,27); if (p) tree.round(p.x,p.z,rnd(.85,1.1),pick([0xb3cdb5,0xa6c4aa]),0xece7dd); }
    },
    // NIGERIA: Zuma Rock, Lagos glass towers, yellow danfo buses, palms
    NGNC(d){ const c=polar(19.5,d.a); claim(c.x,c.z,3.4);
      const rock=shadowy(add(new THREE.Mesh(new THREE.SphereGeometry(1,32,22),lam(0xc2b2a0)))); rock.scale.set(3,3.8,2.5); rock.position.set(c.x,.6,c.z);
      const cap=shadowy(add(new THREE.Mesh(new THREE.SphereGeometry(1,20,12),lam(0xa9cfa2)))); cap.scale.set(1.6,.5,1.2); cap.position.set(c.x+.3,4.1,c.z);
      d.anchor.set(c.x,6.4,c.z);
      for (let k=0;k<4;k++) { const p=spot(d.a,1,9,14,.3); if (!p) break; const h=rnd(5,8.5);
        put('box',pick([0xcfe6ef,0xbfdde9,0xdcedf3]),p.x,0,p.z,1.5,h,1.5,-d.a); put('box',0xffffff,p.x,h,p.z,1.6,.25,1.6,-d.a); }
      for (let k=0;k<14;k++) { const p=spot(d.a,1.1,8.5,26); if (!p) break; const w=rnd(1.3,1.9), h=rnd(.9,1.6);
        put('box',pick([0xffffff,0xf8f4ec]),p.x,0,p.z,w,h,w*.9,-d.a); put('box',pick([0xa9cfa2,0xe9a890,0xc6ccd8]),p.x,h,p.z,w+.15,.18,w*.9+.15,-d.a); }
      for (let k=0;k<4;k++) { const aa=d.a+SECT/2-.07, r=10+k*4.2, p=polar(r,aa);
        put('box',0xffd23f,p.x,.05,p.z,2,.95,.85,aa); put('box',0x3a3f55,p.x,.5,p.z,2.02,.1,.87,aa); put('box',0xcfe6ef,p.x,.62,p.z,1.6,.25,.88,aa); }
      for (let k=0;k<8;k++) { const p=spot(d.a,.7,8,27.5); if (p) tree.palm(p.x,p.z,rnd(.85,1.15)); }
    },
    // ARGENTINA: Obelisco, Caminito's painted houses, jacaranda trees
    ARST(d){ const c=polar(15.5,d.a); claim(c.x,c.z,2.2);
      shadowy(add(new THREE.Mesh(new THREE.CylinderGeometry(1.8,1.9,.3,40),lam(0xffffff)))).position.set(c.x,.15,c.z);
      const shaft=shadowy(add(new THREE.Mesh(new THREE.CylinderGeometry(.34,.66,9,4),lam(0xf7f4ee)))); shaft.rotation.y=PI/4-d.a; shaft.position.set(c.x,4.8,c.z);
      const tip=shadowy(add(new THREE.Mesh(new THREE.ConeGeometry(.48,.9,4),lam(0xf7f4ee)))); tip.rotation.y=PI/4-d.a; tip.position.set(c.x,9.75,c.z);
      d.anchor.set(c.x,11.6,c.z);
      const cols=[0xef8a80,0xffd77a,0x8fcfc4,0x9db6dd,0xf5b88a,0xbfe0ef,0xee9e84,0xa7d6b4];
      for (let k=0;k<9;k++) { const aa=d.a-.3+k*.055, p=polar(23,aa); if (!free(p.x,p.z,.6)) continue; claim(p.x,p.z,.7); const h=rnd(1.4,2.3);
        put('box',cols[k%cols.length],p.x,0,p.z,1.15,h,1.4,aa); put('box',cols[(k+3)%cols.length],p.x,h,p.z,1.25,.16,1.5,aa); }
      for (let k=0;k<12;k++) { const p=spot(d.a,1.2,8.5,25); if (!p) break; const w=rnd(1.4,2), h=rnd(1.2,2.4);
        put('box',pick([0xfbf8f2,0xffffff]),p.x,0,p.z,w,h,w,-d.a); put('pyr',0xe3a08c,p.x,h,p.z,w*1.2,.65,w*1.2,-d.a); }
      for (let k=0;k<12;k++) { const p=spot(d.a,.8,8,27); if (p) tree.round(p.x,p.z,rnd(.85,1.1),pick([0xc9b8f2,0xbba6ee,0xd8ccf6])); }
    },
  };
  districts.forEach((d) => B[d.code](d));

  for (const k in pools) { const P=pools[k];
    const im=new THREE.InstancedMesh(P.geo,lam(0xffffff),P.items.length);
    P.items.forEach((it,i) => { im.setMatrixAt(i,it.m); im.setColorAt(i,it.c); });
    im.instanceColor.needsUpdate=true; shadowy(im); S.add(im); }

  const clouds=[];
  for (let k=0;k<6;k++) { const g=new THREE.Group(), a=rnd(0,PI*2), r=rnd(48,80);
    for (let j=0;j<4;j++) { const b=new THREE.Mesh(new THREE.SphereGeometry(rnd(1.2,2),12,10),lam(0xffffff,{ transparent:true, opacity:.92 })); b.position.set(j*1.6-2.4,rnd(-.3,.4),rnd(-.6,.6)); b.scale.y=.7; g.add(b); }
    g.position.set(Math.cos(a)*r,rnd(14,24),Math.sin(a)*r); g.scale.setScalar(rnd(1.4,2.2)); S.add(g); clouds.push({ g, a, r, sp:rnd(.01,.025) }); }

  const star=add(new THREE.Mesh(new THREE.OctahedronGeometry(.8,0),lam(0xffd23f,{ emissive:0xc99400, emissiveIntensity:.35 }))); star.scale.set(1,1.4,1);
  const pulse=add(new THREE.Mesh(new THREE.RingGeometry(.94,1,96),lam(0xffd23f,{ transparent:true, opacity:0, side:THREE.DoubleSide }))); pulse.rotation.x=-PI/2; pulse.position.y=.08;
  return { S, tring, orb, districts, floaters, clouds, star, pulse };
}

const coinGeo=new THREE.CylinderGeometry(.6,.6,.18,24);
function coin(from,to,color,size,dur){
  const s=new THREE.Mesh(coinGeo,new THREE.MeshLambertMaterial({ color:new THREE.Color(color), emissive:new THREE.Color(color), emissiveIntensity:.25 }));
  s.rotation.x=PI/2; s.scale.setScalar(size); s.castShadow=true; city.S.add(s);
  cityPackets.push({ s, from:from.clone(), to:to.clone(), t0:performance.now(), dur });
}
const CENTER=new THREE.Vector3(0,5.1,0);

/* ================= BACKEND: live demo server, or local simulation ================= */
const fr = window.freighterApi;
async function api(path, body){
  const r = await fetch(path, body ? { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) } : undefined);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
  return data;
}
const live = {
  state: () => api('/api/state'),
  contribute: (i) => api('/api/contribute', { index:i }),
  contributeAll: () => api('/api/contribute-all', {}),
  payout: () => api('/api/payout', {}),
  reset: () => api('/api/reset', {}),
};
function makeSim(){
  const s = { contractId:null, wallet:{ index:0, public:'', ready:true }, contribution:100, round:0, totalRounds:FAM.length,
    pot:0, potTarget:100*FAM.length, beneficiary:0, finished:false,
    members:FAM.map((f,i) => ({ ...f, index:i, wallet:i===0, paid:false, contributionLocal:100*f.rate, balanceUsdc:0 })) };
  const pay = (i) => { s.members[i].paid=true; s.pot+=100; const m=s.members[i]; return { label:`${m.wallet?'You pay':`${m.name} pays`} 100 USDC into the circle`, hash:null }; };
  return {
    state: async () => JSON.parse(JSON.stringify(s)),
    contribute: async (i) => { await sleep(700); return { steps:[pay(i)] }; },
    contributeAll: async () => { await sleep(900); return { steps:s.members.filter((m) => !m.paid && !m.wallet).map((m) => pay(m.index)) }; },
    payout: async () => { await sleep(900); const b=s.members[s.beneficiary];
      const step={ label:`Trust Circle pays ${s.potTarget} USDC to ${b.name} (${b.city}), received as ${fmt(s.potTarget*b.rate)} ${b.code}`, hash:null };
      s.round++; s.pot=0; s.members.forEach((m) => { m.paid=false; });
      if (s.round>=s.totalRounds) { s.finished=true; s.beneficiary=null; } else s.beneficiary=s.round;
      return { steps:[step] }; },
    reset: async () => { await sleep(500); Object.assign(s,{ round:0, pot:0, beneficiary:0, finished:false }); s.members.forEach((m) => { m.paid=false; });
      return { steps:[{ label:'New circle: back to month 1', hash:null }] }; },
  };
}
let backend = live, LIVE = true;
let state = null, busy = false, walletAddr = null, logItems = [], selected = -1;

async function connectWallet({ silent=false }={}){
  if (!fr) throw new Error('Freighter extension not found in this browser.');
  const c = await fr.isConnected();
  if (!c.isConnected) throw new Error('Freighter is not installed or not enabled in this browser.');
  let address;
  if (silent) {
    if (!(await fr.isAllowed()).isAllowed) return;
    address = (await fr.getAddress()).address; if (!address) return;
  } else {
    const r = await fr.requestAccess();
    if (r.error) throw new Error(r.error.message ?? 'Connection refused');
    address = r.address;
  }
  const net = await fr.getNetworkDetails();
  if (net.networkPassphrase !== state.passphrase) throw new Error('Switch Freighter to Testnet (Settings → Network).');
  if (address !== state.wallet.public) throw new Error(`The active Freighter account (${short(address)}) is not the demo wallet (${short(state.wallet.public)}).`);
  walletAddr = address;
}
async function walletTx(action, extra={}){
  const built = await api('/api/wallet/build', { action, ...extra });
  const signed = await fr.signTransaction(built.xdr, { networkPassphrase:state.passphrase, address:walletAddr });
  if (signed.error) throw new Error(signed.error.message ?? 'Signature refused in Freighter');
  const { steps } = await api('/api/wallet/submit', { xdr:signed.signedTxXdr, kind:built.kind, label:built.label, action });
  steps.forEach((st) => addLog(st.label, st.hash));
}
async function walletContribute(){
  if (!LIVE) return backend.contribute(state.wallet.index);
  const me = state.members[state.wallet.index];
  if (me.balanceUsdc < state.contribution) await walletTx('convert'); // 1st signature: XLM → USDC
  await walletTx('contribute');                                        // 2nd signature: payment into the contract
  return {};
}

function addLog(label, hash, cls){ logItems.unshift({ label, hash, cls }); logItems=logItems.slice(0,4); renderLog(); }
function renderLog(){
  const ol=$('log'); ol.innerHTML='';
  if (!logItems.length) { ol.innerHTML=`<li><span>${LIVE?'No transactions yet. Each one will link to the testnet explorer.':'No payments yet this session.'}</span></li>`; return; }
  for (const it of logItems) { const li=document.createElement('li'); if (it.cls) li.className=it.cls;
    const sp=document.createElement('span'); sp.textContent=it.label; sp.title=it.label; li.append(sp);
    if (it.hash) { const a=document.createElement('a'); a.href=`${EXPLORER}/tx/${it.hash}`; a.target='_blank'; a.rel='noopener'; a.textContent=`${it.hash.slice(0,6)}… ↗`; li.append(a); }
    ol.append(li); }
}
let toastT=0;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(() => { t.hidden=true; },6000); }

async function run(label, fn, button){
  if (busy) return;
  busy=true;
  document.querySelectorAll('.panel button').forEach((b) => { b.disabled=true; });
  if (button) { button.disabled=true; button.innerHTML=`<span class="spinner"></span>${esc(label)}`; }
  try {
    const { steps=[], walletConvert } = (await fn()) ?? {};
    for (const st of steps) addLog(st.label, st.hash);
    if (walletConvert) { // the pot just landed on your wallet: convert it back into XLM
      if (!walletAddr) await connectWallet();
      await walletTx('receive', { amount:walletConvert });
    }
  } catch (e) {
    addLog(e.message, null, 'error'); toast(e.message);
  } finally {
    busy=false; await refresh();
  }
}

async function refresh(){
  try { applyState(await backend.state()); }
  catch (e) {
    if (LIVE && !state) { // no demo server behind this page (opened as a static file): simulate
      console.warn('Trust Circle: demo server unavailable, switching to simulation.', e);
      LIVE=false; backend=makeSim(); applyState(await backend.state());
    } else addLog(`Could not read the circle: ${e.message}`, null, 'error');
  }
}

// animate what changed between two states (coins in, pot out)
function applyState(next){
  const prev=state; state=next;
  if (city && prev) {
    if (next.round>prev.round || (next.finished && !prev.finished)) {
      const b=prev.beneficiary;
      if (b!=null) { coin(CENTER,city.districts[b].hub,'#ffd23f',3.2,1900); setTimeout(() => { pulseT=performance.now(); pulseIdx=b; },1900); }
    } else if (next.round===prev.round) {
      let k=0; next.members.forEach((m,i) => { if (m.paid && !prev.members[i].paid) { const d=city.districts[i]; setTimeout(() => coin(d.hub,CENTER,FAM[i].color,1.7,1500),k++*260); } });
    }
  }
  renderPanel();
}

/* ---------- panel ---------- */
function btn(text, cls, onClick, disabled=false){ const b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=text; b.disabled=busy||disabled; b.onclick=(e) => onClick(e.currentTarget); return b; }
function renderPanel(){
  if (!state || !city) return;
  const s=state, wi=s.wallet.index, me=s.members[wi];
  const allPaid=s.members.every((m) => m.paid), othersPaid=s.members.every((m) => m.paid || m.wallet);
  const b=s.beneficiary!=null ? s.members[s.beneficiary] : null;
  $('pMeta').textContent = s.finished ? `Circle complete · ${s.totalRounds} months` : `Month ${s.round+1} of ${s.totalRounds}`;
  $('pTitle').textContent = s.finished ? 'Everyone has received the pot once' : `Recipient: ${b.name}, ${b.city}`;
  $('pot').textContent = `${fmt(s.pot)} / ${fmt(s.potTarget)} USDC`;
  $('potFill').style.width = `${Math.min(100,(s.pot/s.potTarget)*100)}%`;

  const chip=$('walletChip');
  if (!LIVE) { chip.textContent='Simulation'; chip.disabled=true; chip.className='chip'; chip.title='The demo server is not running, so payments are simulated.'; }
  else { chip.disabled=busy; chip.className=`chip${walletAddr?' on':''}`; chip.textContent = walletAddr ? `Freighter · ${short(walletAddr)}` : 'Connect Freighter';
    chip.onclick = () => run('Connecting…', async () => { await connectWallet(); return {}; }, null); }

  const rows=$('rows'); rows.innerHTML='';
  s.members.forEach((m,i) => {
    const li=document.createElement('li'); li.className=`row${i===selected?' sel':''}${i===s.beneficiary&&!s.finished?' benef':''}`; li.style.color=FAM[i].color;
    const amount = m.contributionLocal!=null ? `${fmt(m.contributionLocal)} ${m.code}` : '—';
    li.innerHTML=`<span class="d"></span><span class="who">${esc(m.name)} <small>· ${esc(m.city)}${i===s.beneficiary&&!s.finished?' · gets the pot':''}</small></span><span class="amt">${amount}</span>`;
    if (m.paid) { const p=document.createElement('span'); p.className='pill-s paid'; p.textContent='paid'; li.append(p); }
    else if (m.wallet || s.finished) { const p=document.createElement('span'); p.className='pill-s'; p.textContent= m.wallet ? 'you' : 'pending'; li.append(p); }
    else li.append(btn('pay','pill-s',(el) => run('…', () => backend.contribute(i), el)));
    li.onclick=(e) => { if (e.target.tagName!=='BUTTON') select(i); };
    rows.append(li);
  });

  const acts=$('actions'); acts.innerHTML='';
  if (s.finished) acts.append(btn('Restart at month 1','cta',(el) => run('Redeploying…', () => backend.reset(), el)));
  else {
    if (!me.paid) {
      if (LIVE && !walletAddr) acts.append(btn('Connect Freighter','cta',(el) => run('Connecting…', async () => { await connectWallet(); return {}; }, el)));
      else if (LIVE && !s.wallet.ready) acts.append(btn('Activate my wallet','cta',(el) => run('Sign in Freighter…', async () => { await walletTx('activate'); return {}; }, el)));
      else acts.append(btn(`Pay in ${me.code}${LIVE?' · Freighter':''}`,'cta',(el) => run(LIVE?'Sign in Freighter…':'Paying…', walletContribute, el)));
    }
    if (!othersPaid) acts.append(btn('The others pay','ghost',(el) => run('Paying…', () => backend.contributeAll(), el)));
    if (allPaid) acts.append(btn(`Pay out ${fmt(s.potTarget)} USDC`,'cta',(el) => run('Paying out…', () => backend.payout(), el)));
  }

  const fine=$('fine');
  fine.innerHTML = LIVE
    ? `Soroban contract <a href="${EXPLORER}/contract/${s.contractId}" target="_blank" rel="noopener">${s.contractId.slice(0,8)}…${s.contractId.slice(-4)} ↗</a> · Demo FX rates on the testnet DEX · <button type="button" id="resetLink">Restart at month 1</button> · <a href="/classic.html">Classic view</a>`
    : 'Simulation with the demo FX rates. Run <code>npm start</code> in <code>demo/</code> to send real testnet transactions.';
  const rl=$('resetLink'); if (rl) { rl.disabled=busy; rl.onclick=() => run('Redeploying…', async () => { logItems=[]; return backend.reset(); }, null); }

  dlabs.forEach((el,i) => { el.classList.toggle('recv', i===s.beneficiary && !s.finished); el.classList.toggle('sel', i===selected);
    el.querySelector('.ok').textContent = s.members[i].paid ? '✓' : ''; });
  if (!logItems.length) renderLog();
}
function select(i){ selected=i; orbit.tTheta=city.districts[i].a; renderPanel(); }

let dlabs=[];
function buildLabels(){
  const wrap=$('labels'); wrap.innerHTML='';
  dlabs=FAM.map((f,i) => { const b=document.createElement('button'); b.className='dlab'; b.type='button'; b.style.color=f.color;
    b.innerHTML=`<span class="d"><span>${f.code}</span></span><span class="t">${esc(f.country)}<span class="ok"></span><small>${esc(f.name)} · ${esc(f.imaginary?'imaginary country':f.city)}</small></span>`;
    b.addEventListener('click',() => select(i)); wrap.appendChild(b); return b; });
}

function enterCity(){
  if (!city) { city=buildCity(); cCam=new THREE.PerspectiveCamera(40,VW/VH,.1,400); buildLabels(); orbit.theta=city.districts[0].a; }
  mode='city'; cityT0=performance.now(); gateOpen=false; closing=false; pts=[]; paintPath();
  gate.hidden=true; $('cityUI').hidden=false;
  ['story','orbLabels','feeTags','odoWrap','rail','hint','skip'].forEach((id) => { $(id).hidden=true; });
  $('replay').hidden=false;
  resize(); renderPanel();
  if (!state) refresh();
}
function backToStory(){
  mode='story'; target=prog=0; ringClose=0;
  $('cityUI').hidden=true; ['story','orbLabels','feeTags','odoWrap','rail','hint','skip'].forEach((id) => { $(id).hidden=false; });
  $('replay').hidden=true;
}
$('skip').addEventListener('click',() => { flash.animate([{opacity:0},{opacity:.9},{opacity:0}],{ duration:900 }); setTimeout(enterCity,420); });
$('replay').addEventListener('click',backToStory);

let drag=null;
canvas.addEventListener('pointerdown',(e) => { if (mode!=='city') return; drag={ x:e.clientX, y:e.clientY }; orbit.tTheta=null; canvas.setPointerCapture(e.pointerId); lastInput=performance.now(); });
canvas.addEventListener('pointermove',(e) => { if (!drag) return; orbit.theta-=(e.clientX-drag.x)*.006; orbit.el=Math.min(1.3,Math.max(.22,orbit.el+(e.clientY-drag.y)*.004)); drag={ x:e.clientX, y:e.clientY }; lastInput=performance.now(); });
canvas.addEventListener('pointerup',() => { drag=null; });
function cityZoom(dy){ orbit.dist=Math.min(95,Math.max(28,orbit.dist+dy*.03)); }

/* ---------- resize ---------- */
function resize(){
  const r=canvas.getBoundingClientRect(); VX=r.left; VY=r.top; VW=r.width; VH=r.height;
  const w=VW, h=VH, asp=w/h, narrow=innerWidth<720; renderer.setSize(w,h,false);
  bgU.uRes.value.set(w,h); sCam.aspect=asp; sCam.updateProjectionMatrix();
  if (cCam) { cCam.aspect=asp; if (!narrow) cCam.setViewOffset(w,h,-Math.min(210,w*.16),0,w,h); else { cCam.clearViewOffset(); orbit.dist=Math.max(orbit.dist,86); } cCam.updateProjectionMatrix(); }
  STAGE = narrow ? { cx:0, cy:1.9, sx:Math.min(1,asp/1.25)*.62 } : { cx:(asp>1.5?3.4:2.6)*Math.min(1,asp/1.7), cy:.2, sx:Math.min(1,asp/1.7) };
  sCam.position.z = narrow ? 15 : 13;
  sizeDraw();
}
addEventListener('resize',resize); resize();

/* ---------- loop ---------- */
const v3=new THREE.Vector3();
function project(p, el, cam){
  v3.copy(p).project(cam);
  el.style.transform=`translate(${VX+(v3.x*.5+.5)*VW}px,${VY+(-v3.y*.5+.5)*VH}px) translate(-50%,-100%)`;
  return v3.z<1;
}
const t0=performance.now();
function frame(now){
  const t=(now-t0)/1000; bgU.uTime.value=RM?0:t;
  renderer.clear();
  if (mode==='story') storyFrame(now,t); else cityFrame(now,t);
  requestAnimationFrame(frame);
}
function storyFrame(now,t){
  prog+=(target-prog)*.07; const p=prog, narrow=innerWidth<720;
  chaps.forEach((el,i) => { const d=(p-(i+.5)/6)*6;
    const o = i===0 ? 1-ss(.15,.45,d) : 1-ss(.22,.5,Math.abs(d));
    el.style.opacity=o.toFixed(3);
    el.style.transform = narrow ? `translateY(${((1-o)*20).toFixed(1)}px)` : `translateY(calc(-50% + ${(-d*60).toFixed(1)}px))`;
    el.style.visibility=o<.01?'hidden':'visible'; });
  const ci=Math.min(5,Math.floor(p*6+.0001)); railItems.forEach((li,i) => li.classList.toggle('on',i===ci));
  needle.style.transform=`translateX(${(p*ruler.clientWidth-1).toFixed(1)}px)`;
  hint.style.opacity=(.75*(1-ss(.01,.06,p))).toFixed(3);

  const mix1=ss(.36,.47,p), mix2=ss(.9,.985,p), six=ss(.84,.9,p);
  const warm=ss(.66,.72,p)*(1-ss(.8,.86,p)), gold=ss(.84,.93,p);
  bgU.uWarm.value=warm; bgU.uGold.value=gold*(1-ss(.96,1,p)); bgU.uCity.value=0;
  bgU.uDim.value=lerp(bgU.uDim.value,(gateOpen||closing)?1:0,.06);

  const C={ x:STAGE.cx, y:STAGE.cy }, R5=2.3, R6=2.6;
  const pos=SM.map((m,i) => {
    const a5=i/5*PI*2+PI/2, a6=i/6*PI*2+PI/2;
    const disp={ x:narrow?(geo[i].x-3.7)*STAGE.sx:geo[i].x*STAGE.sx, y:geo[i].y*(narrow?.75:1)+(narrow?1.2:0) };
    let q = i<5 ? { x:lerp(C.x+Math.cos(a5)*R5,disp.x,mix1), y:lerp(C.y+Math.sin(a5)*R5,disp.y,mix1) } : { ...disp };
    q={ x:lerp(q.x,C.x+Math.cos(a6)*R6,mix2), y:lerp(q.y,C.y+Math.sin(a6)*R6,mix2) };
    if (!RM) { q.x+=Math.sin(t*.7+i*1.3)*.06; q.y+=Math.cos(t*.6+i)*.06; }
    return q;
  });
  orbs.forEach((o,i) => { o.position.set(pos[i].x,pos[i].y,0); o.material.opacity=i<5?1:six;
    o.scale.setScalar((1.02+Math.sin(t*2+i)*.03)*(i===5?(.4+.6*six):1)); });
  hub.position.set(C.x,C.y,0); hub.material.opacity=Math.min(1,gold+ringClose); hub.scale.setScalar(1.6+Math.sin(t*3)*.08+ringClose*.8);
  ring.position.set(C.x,C.y,0); ring.scale.setScalar(lerp(R5,R6,mix2));
  ring.material.opacity=Math.max((1-mix1)*.55,mix2*.7);
  if (closing) { ringClose=Math.min(1,(now-closeT0)/900); ring.material.opacity=.9; ring.material.color.set(0xffd23f); } else ring.material.color.set(0x0e1530);

  const fo=warm*(.28+.1*Math.sin(t*9)*Math.sin(t*3.1));
  pairs.forEach(([a,b],k) => { setRibbon(fric[k],pos[a],pos[b],.016); fric[k].material.opacity=fo; });
  FEES.forEach(([a,b],k) => { const pa=pos[a], pb=pos[b]; project(new THREE.Vector3((pa.x+pb.x)/2,(pa.y+pb.y)/2+.15,0),feeEls[k],sCam);
    feeEls[k].style.opacity=(warm*ss(0,1,(warm*1.4)-k*.07)).toFixed(3); });
  const ho=ss(.85,.9,p)*(1-mix2)*.45;
  pos.forEach((q,i) => { setRibbon(hubL[i],q,C,.016); hubL[i].material.opacity=ho; });

  let pm=0;
  for (let j=0;j<PN;j++) { let x=0,y=0;
    if (p<.36) { const a=(t*.5+j/PN*PI*2)%(PI*2); if (j%6) x=9999; else { x=C.x+Math.cos(a)*R5; y=C.y+Math.sin(a)*R5; } pm=(1-mix1)*ss(.08,.17,p); }
    else if (p<.84) { const [a,b]=pairs[j%pairs.length], raw=(t*.07+j*.137)%1, seg=(raw*5)%1, tt=Math.floor(raw*5)/5+Math.max(0,seg-.7)/.3/5; // stop-and-go
      x=lerp(pos[a].x,pos[b].x,tt); y=lerp(pos[a].y,pos[b].y,tt); pm=warm*.9; }
    else { const i=j%6, tt=(t*.7+j*.173)%1; x=lerp(pos[i].x,C.x,tt); y=lerp(pos[i].y,C.y,tt); pm=ss(.86,.9,p)*(1-mix2); }
    ppos[j*3]=x; ppos[j*3+1]=y; ppos[j*3+2]=.1; }
  pgeo.attributes.position.needsUpdate=true; packets.material.opacity=pm;
  packets.material.color.set(p>=.36&&p<.84?0x0e1530:0xffc21a); packets.material.size=p>=.36&&p<.84?.11:.2;
  if (!RM) { for (let i=0;i<DN;i++) { dpos[i*3+1]+=.002+dseed[i]*.003; if (dpos[i*3+1]>8) dpos[i*3+1]=-8; } dgeo.attributes.position.needsUpdate=true; }

  const lab=ss(.38,.45,p)*(1-ss(.9,.95,p));
  olabs.forEach((el,i) => { project(new THREE.Vector3(pos[i].x,pos[i].y+.6,0),el,sCam);
    el.style.opacity=(i<5?lab:lab*six).toFixed(3); });
  setOdo(Math.max(0,AVG_KM*mix1*(1-mix2)*(1-ringClose)));

  const shouldGate=p>.975;
  if (shouldGate!==gateOpen && !closing) { gateOpen=shouldGate; gate.hidden=!gateOpen; if (gateOpen) { pts=[]; paintPath(); miss.textContent=''; } }

  sCam.position.x=lerp(sCam.position.x,mx*.6,.05); sCam.position.y=lerp(sCam.position.y,-my*.4,.05); sCam.lookAt(STAGE.cx*.15,STAGE.cy*.3,0);
  renderer.render(bgScene,bgCam); renderer.clearDepth(); renderer.render(story,sCam);
}
function cityFrame(now,t){
  bgU.uWarm.value=0; bgU.uGold.value=0; bgU.uDim.value=0; bgU.uCity.value=1;
  const e=ss(0,1,(now-cityT0)/2800);
  if (orbit.tTheta!==null) { let d=orbit.tTheta-orbit.theta; d=Math.atan2(Math.sin(d),Math.cos(d)); orbit.theta+=d*.05; if (Math.abs(d)<.002) orbit.tTheta=null; }
  else if (!drag && !RM && now-lastInput>3000) orbit.theta+=.0012;
  const el=lerp(1.4,orbit.el,e), dist=lerp(140,orbit.dist,e);
  cCam.position.set(Math.cos(orbit.theta)*Math.cos(el)*dist, Math.sin(el)*dist, -Math.sin(orbit.theta)*Math.cos(el)*dist);
  cCam.lookAt(0,3,0);
  city.tring.rotation.z=t*.4; city.orb.position.y=5.1+Math.sin(t*1.6)*.25;
  city.floaters.forEach((f) => { f.m.position.y=f.y+(RM?0:Math.sin(t*f.sp+f.ph)*.35); if (f.rot) f.m.rotation.y+=f.rot*.01; if (f.spin) f.m.rotation.z+=f.spin*.01; });
  city.clouds.forEach((c) => { if (!RM) c.a+=c.sp*.01; c.g.position.x=Math.cos(c.a)*c.r; c.g.position.z=Math.sin(c.a)*c.r; });
  const bi = state && !state.finished ? state.beneficiary : null;
  city.star.visible = bi!=null;
  if (bi!=null) { const a=city.districts[bi].anchor; city.star.position.set(a.x,a.y+1.6+Math.sin(t*2.4)*.35,a.z); city.star.rotation.y=t*1.5; }
  if (pulseT>0) { const k=(now-pulseT)/1600, c=city.districts[pulseIdx].center;
    if (k<1) { city.pulse.position.set(c.x,.08,c.z); city.pulse.scale.setScalar(1+k*9); city.pulse.material.opacity=(1-k)*.9; } else { city.pulse.material.opacity=0; pulseT=-1; } }
  cityPackets=cityPackets.filter((pk) => { const k=Math.min(1,(now-pk.t0)/pk.dur), kk=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    pk.s.position.lerpVectors(pk.from,pk.to,kk); pk.s.position.y+=Math.sin(PI*kk)*7; pk.s.rotation.z=t*6;
    if (k>=1) { city.S.remove(pk.s); return false; } return true; });
  city.districts.forEach((d,i) => { const vis=project(d.anchor,dlabs[i],cCam); dlabs[i].style.visibility=vis?'visible':'hidden'; dlabs[i].style.opacity=e.toFixed(2); });
  renderer.render(bgScene,bgCam); renderer.clearDepth(); renderer.render(city.S,cCam);
}
requestAnimationFrame(frame);

/* ---------- boot ---------- */
refresh().then(() => { if (LIVE && fr) connectWallet({ silent:true }).then(renderPanel).catch(() => {}); });
setInterval(() => { if (LIVE && !busy && mode==='city') refresh(); }, 15000);
})();
