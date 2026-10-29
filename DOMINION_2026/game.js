(() => {
"use strict";
const $ = id => document.getElementById(id);
const canvas = $("battleMap"), ctx = canvas.getContext("2d");
const SAVE_KEY = "dominion2026_save_v1";
const defs = {
  generator:{name:"Энергоузел",icon:"ϟ",desc:"Вырабатывает энергию для растущей колонии.",cost:{credits:100,alloy:25},income:{energy:5},hp:500,type:"building"},
  mine:{name:"Экстрактор сплава",icon:"⬡",desc:"Добывает строительный сплав из месторождений.",cost:{credits:130,energy:30},income:{alloy:3},hp:440,type:"building"},
  refinery:{name:"Кредитный синтезатор",icon:"₡",desc:"Увеличивает поступление кредитов.",cost:{credits:160,energy:35,alloy:20},income:{credits:5},hp:420,type:"building"},
  barracks:{name:"Казарма",icon:"✣",desc:"Позволяет обучать пехотные отряды.",cost:{credits:150,energy:40,alloy:35},income:{},hp:650,type:"building"},
  turret:{name:"Оборонная турель",icon:"⌖",desc:"Автоматически атакует врагов в радиусе.",cost:{credits:180,energy:50,alloy:45},income:{},hp:600,type:"building"},
  lab:{name:"Научный комплекс",icon:"⌬",desc:"Открывает доступ к новым технологиям.",cost:{credits:220,energy:80,alloy:60},income:{},hp:520,type:"building"}
};
const unitDefs = {
  scout:{name:"Разведчик",icon:"➤",desc:"Быстрый лёгкий отряд для разведки.",cost:{credits:80,alloy:10},hp:100,damage:12,range:105,speed:56,rate:0.8},
  soldier:{name:"Штурмовик",icon:"✣",desc:"Универсальная пехота для боя.",cost:{credits:110,alloy:20},hp:160,damage:20,range:115,speed:42,rate:1},
  tank:{name:"Тяжёлый шагоход",icon:"▰",desc:"Бронированная машина с мощной атакой.",cost:{credits:220,energy:20,alloy:65},hp:360,damage:38,range:135,speed:27,rate:1.35}
};
const state = {
  resources:{credits:650,energy:180,alloy:120}, elapsed:0, paused:false, mode:"campaign",
  units:[], buildings:[], enemies:[], projectiles:[], particles:[], selected:[], tech:{weapons:0,industry:0,shields:0}, completed:[], campaignIndex:0, enemyTimer:28, nextId:1, camera:{x:0,y:0,zoom:1}, stats:{kills:0}, stability:86
};
let lastFrame=performance.now(), lastIncome=0, saveTimer=0, mapW=1000,mapH=650, mouse={x:0,y:0}, drag=null, mapScale={x:1,y:1}, gameStarted=false;
const rand=(a,b)=>a+Math.random()*(b-a), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function log(message,type=""){const row=document.createElement("div");row.className="log-item";const time=new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});row.innerHTML=`<span class="log-time">${time}</span><span class="log-dot ${type}"></span><div class="log-text">${message}</div>`;$("eventLog").prepend(row);while($("eventLog").children.length>12)$("eventLog").lastChild.remove();}
function toast(message,error=false){const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toastStack").append(el);setTimeout(()=>el.remove(),2800);}
function mapToast(message){const el=$("mapToast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1800);}
function entity(type,x,y,extra={}){return {id:state.nextId++,type,x,y,hp:extra.hp??500,maxHp:extra.maxHp??extra.hp??500,team:extra.team||"player",angle:0,target:null,selected:false,cooldown:rand(0,.5),...extra};}
function addStartingWorld(){
 state.units=[entity("scout",210,300,{hp:100,maxHp:100}),entity("soldier",250,330,{hp:160,maxHp:160}),entity("soldier",270,285,{hp:160,maxHp:160})];
 state.buildings=[entity("hq",155,320,{name:"Командный центр",icon:"⌂",hp:1200,maxHp:1200,team:"player",income:{credits:12},type:"building"}),entity("generator",210,405,{hp:500,maxHp:500,team:"player",income:{energy:8}})];
 state.enemies=[entity("enemy",760,230,{hp:150,maxHp:150,damage:12,range:100,speed:28,rate:1.3}),entity("enemy",805,270,{hp:150,maxHp:150,damage:12,range:100,speed:28,rate:1.3}),entity("enemy",760,330,{hp:150,maxHp:150,damage:12,range:100,speed:28,rate:1.3})];
}
function allEntities(){return [...state.units,...state.buildings,...state.enemies];}
function findEntity(id){return allEntities().find(e=>e.id===id);}
function selectedEntities(){return state.selected.map(findEntity).filter(Boolean);}
function selected(){return selectedEntities()[0]||null;}
function costText(cost){return Object.entries(cost||{}).map(([k,v])=>`${({credits:"₡",energy:"ϟ",alloy:"⬡"})[k]} ${v}`).join(" · ")||"Бесплатно";}
function canAfford(cost){return Object.entries(cost||{}).every(([k,v])=>state.resources[k]>=v);}
function pay(cost){if(!canAfford(cost)){toast("Недостаточно ресурсов для этой операции.",true);return false;}for(const [k,v] of Object.entries(cost||{}))state.resources[k]-=v;return true;}
function formatNum(n){return Math.floor(n).toLocaleString("ru-RU");}
function updateUI(){
 for(const key of ["credits","energy","alloy"])$(key).textContent=formatNum(state.resources[key]);
 const income=incomeRates();$("creditsRate").textContent=`+${income.credits}/мин`;$("energyRate").textContent=`+${income.energy}/мин`;$("alloyRate").textContent=`+${income.alloy}/мин`;
 $("dayCount").textContent=String(1+Math.floor(state.elapsed/180)).padStart(2,"0");
 const t=Math.floor(state.elapsed),h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;$("clockLabel").textContent=[h,m,s].map(v=>String(v).padStart(2,"0")).join(":");
 $("unitCount").textContent=state.units.length;$("buildingCount").textContent=state.buildings.length;$("enemyCount").textContent=state.enemies.length;
 $("techLevel").textContent="Уровень "+(1+Object.values(state.tech).reduce((a,b)=>a+b,0));
 $("defense").textContent=state.buildings.some(b=>b.type==="turret")?"Укреплена":state.units.length>=5?"Средняя":"Низкая";
 $("stability").textContent=Math.round(state.stability)+"%";
 $("controlPct").textContent=Math.min(100,42+state.stats.kills*3+state.buildings.length*2)+"%";
 $("population").innerHTML=`${120+state.buildings.length*20} <small>/ ${180+state.buildings.filter(b=>b.type==="hq").length*60}</small>`;
 updateMission();renderSelection();
}
function incomeRates(){
 const out={credits:0,energy:0,alloy:0};
 for(const b of state.buildings){if(b.hp<=0)continue;const inc=b.income||defs[b.type]?.income||{};for(const k of Object.keys(out))out[k]+=inc[k]||0;}
 if(state.tech.industry)out.credits+=state.tech.industry*3;
 return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Math.round(v*60)]));
}
function updateMission(){
 const m=missions[state.campaignIndex];
 if(!m){$("missionTitle").textContent="Рубеж достигнут";$("missionDesc").textContent="Первый сектор стабилизирован. Продолжайте расширять империю в режиме песочницы.";$("missionProgress").style.width="100%";$("missionProgressText").textContent="Кампания завершена";return;}
 $("missionTitle").textContent=m.title;$("missionDesc").textContent=m.desc;
 const count=m.check();$("missionProgress").style.width=`${Math.min(100,count/m.goal*100)}%`;$("missionProgressText").textContent=`Прогресс директивы: ${Math.min(count,m.goal)} / ${m.goal}`;
}
const missions=[
 {title:"Укрепить плацдарм",desc:"Постройте энергоузел и казарму, затем подготовьте отряд разведчиков.",goal:3,check:()=>Number(state.buildings.some(b=>b.type==="generator"))+Number(state.buildings.some(b=>b.type==="barracks"))+Number(state.units.some(u=>u.type==="scout"))},
 {title:"Развернуть промышленность",desc:"Постройте экстрактор сплава и кредитный синтезатор для стабильного дохода.",goal:2,check:()=>Number(state.buildings.some(b=>b.type==="mine"))+Number(state.buildings.some(b=>b.type==="refinery"))},
 {title:"Подавить угрозу",desc:"Уничтожьте 3 вражеских отряда и установите контроль над зоной.",goal:3,check:()=>state.stats.kills},
 {title:"Технологическое превосходство",desc:"Завершите любое исследование в научном комплексе.",goal:1,check:()=>Object.values(state.tech).reduce((a,b)=>a+b,0)}
];
function checkMission(){const m=missions[state.campaignIndex];if(m&&m.check()>=m.goal){state.campaignIndex++;log(`<b>Директива выполнена.</b> Получена награда: 180 кредитов и 35 сплава.`);state.resources.credits+=180;state.resources.alloy+=35;toast("Директива выполнена! Награда начислена.");updateUI();}}
function resizeCanvas(){
 const r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
 canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));
 ctx.setTransform(dpr,0,0,dpr,0,0);mapScale={x:r.width/mapW,y:r.height/mapH};drawMap();
}
function worldToScreen(x,y){return {x:(x-state.camera.x)*state.camera.zoom*mapScale.x,y:(y-state.camera.y)*state.camera.zoom*mapScale.y};}
function screenToWorld(x,y){return {x:x/(mapScale.x*state.camera.zoom)+state.camera.x,y:y/(mapScale.y*state.camera.zoom)+state.camera.y};}
function drawMap(){
 if(!ctx)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#0a1420";ctx.fillRect(0,0,w,h);
 ctx.save();ctx.scale(mapScale.x*state.camera.zoom,mapScale.y*state.camera.zoom);ctx.translate(-state.camera.x,-state.camera.y);
 const grad=ctx.createLinearGradient(0,0,mapW,mapH);grad.addColorStop(0,"#122631");grad.addColorStop(.48,"#10202a");grad.addColorStop(1,"#171c2a");ctx.fillStyle=grad;ctx.fillRect(0,0,mapW,mapH);
 for(let i=0;i<65;i++){const x=(i*137)%mapW,y=(i*229)%mapH;ctx.fillStyle=i%3?"#a0d4df10":"#6da3b710";ctx.beginPath();ctx.arc(x,y,(i%4)+1,0,Math.PI*2);ctx.fill();}
 ctx.strokeStyle="#4fd9e510";ctx.lineWidth=1;for(let x=0;x<=mapW;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,mapH);ctx.stroke();}for(let y=0;y<=mapH;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(mapW,y);ctx.stroke();}
 ctx.strokeStyle="#4bd7e51c";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,150);ctx.bezierCurveTo(260,190,380,100,600,170);ctx.stroke();ctx.beginPath();ctx.moveTo(0,520);ctx.bezierCurveTo(300,470,500,580,1000,450);ctx.stroke();
 // Neutral resource nodes
 for(const node of [{x:490,y:150,c:"#ffbf68",t:"ALLOY"},{x:565,y:470,c:"#65e5e9",t:"ENERGY"},{x:430,y:365,c:"#b3a5ff",t:"DATA"}]){
  ctx.beginPath();ctx.arc(node.x,node.y,18,0,Math.PI*2);ctx.strokeStyle=node.c+"77";ctx.lineWidth=1.5;ctx.stroke();ctx.beginPath();ctx.arc(node.x,node.y,5,0,Math.PI*2);ctx.fillStyle=node.c;ctx.fill();ctx.fillStyle=node.c;ctx.font="9px monospace";ctx.fillText(node.t,node.x-17,node.y+31);
 }
 // enemy base territory
 ctx.fillStyle="#f45d7820";ctx.beginPath();ctx.ellipse(780,300,145,170,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#ff687d45";ctx.setLineDash([6,8]);ctx.stroke();ctx.setLineDash([]);
 for(const b of state.buildings)drawBuilding(b);
 for(const e of state.enemies)drawUnit(e,true);
 for(const u of state.units)drawUnit(u,false);
 for(const p of state.projectiles){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.07,p.y-p.vy*.07);ctx.strokeStyle=p.color+"99";ctx.stroke();}
 for(const p of state.particles){ctx.globalAlpha=Math.max(0,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,2,2);ctx.globalAlpha=1;}
 ctx.restore();
 // Compass and tactical overlay
 ctx.fillStyle="#a9c4d766";ctx.font="10px monospace";ctx.fillText("N ↑",w-35,20);
 ctx.strokeStyle="#3b5968";ctx.strokeRect(10,10,34,34);ctx.strokeStyle="#4bd9e9";ctx.beginPath();ctx.moveTo(27,15);ctx.lineTo(27,39);ctx.moveTo(15,27);ctx.lineTo(39,27);ctx.stroke();
}
function drawHealth(e){const width=e.type==="hq"?54:34;ctx.fillStyle="#050b12cc";ctx.fillRect(e.x-width/2,e.y-30,width,4);ctx.fillStyle=e.team==="enemy"?"#ff687d":e.hp/e.maxHp<.35?"#ffb45e":"#4ee0a0";ctx.fillRect(e.x-width/2,e.y-30,width*clamp(e.hp/e.maxHp,0,1),4);}
function drawBuilding(b){
 ctx.save();ctx.translate(b.x,b.y);const selectedNow=state.selected.includes(b.id);
 if(selectedNow){ctx.strokeStyle="#55e7f2";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,36,25,0,0,Math.PI*2);ctx.stroke();}
 if(b.type==="hq"){ctx.fillStyle="#173a48";ctx.strokeStyle="#55ddea";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-28,18);ctx.lineTo(-23,-13);ctx.lineTo(0,-27);ctx.lineTo(24,-12);ctx.lineTo(29,18);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle="#5fe7ef";ctx.fillRect(-5,-15,10,24);ctx.fillStyle="#d5fcff";ctx.fillRect(-2,-9,4,12);}
 else {ctx.fillStyle=b.type==="turret"?"#48332b":"#163342";ctx.strokeStyle=b.type==="turret"?"#ffb45e":"#4dd9e9";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-22,15);ctx.lineTo(-19,-12);ctx.lineTo(0,-22);ctx.lineTo(19,-12);ctx.lineTo(22,15);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(-4,-8,8,16);ctx.beginPath();ctx.arc(0,-2,4,0,Math.PI*2);ctx.fill();}
 ctx.restore();drawHealth(b);
 ctx.fillStyle="#c6dbe8";ctx.font="10px Inter,Arial";ctx.textAlign="center";ctx.fillText(b.name||defs[b.type]?.name||"Объект",b.x,b.y+34);ctx.textAlign="left";
}
function drawUnit(u,enemy){
 ctx.save();ctx.translate(u.x,u.y);const sel=state.selected.includes(u.id);
 if(sel){ctx.strokeStyle=enemy?"#ff8c9c":"#59e9f4";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,22,15,0,0,Math.PI*2);ctx.stroke();}
 if(u.target){ctx.strokeStyle=enemy?"#ff687d30":"#4bd9e930";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(u.target.x-u.x,u.target.y-u.y);ctx.stroke();ctx.setLineDash([]);}
 ctx.rotate(u.angle||0);ctx.fillStyle=enemy?"#542331":u.type==="tank"?"#24473d":"#153b49";ctx.strokeStyle=enemy?"#ff6c81":u.type==="tank"?"#70e0a3":"#53e1ef";ctx.lineWidth=2;
 ctx.beginPath();if(u.type==="tank"){ctx.roundRect(-15,-10,30,20,5);ctx.fill();ctx.stroke();ctx.fillRect(-5,-16,10,32);}else{ctx.moveTo(0,-15);ctx.lineTo(12,9);ctx.lineTo(0,5);ctx.lineTo(-12,9);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fillStyle=enemy?"#ff9aaa":"#a8faff";ctx.fill();}
 ctx.restore();drawHealth(u);
}
function pointerPos(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function hitTest(x,y){const p=screenToWorld(x,y);const entities=[...state.units,...state.enemies,...state.buildings].sort((a,b)=>b.y-a.y);for(const e of entities){const r=e.type==="hq"?33:e.type==="building"?27:20;if(Math.hypot(p.x-e.x,p.y-e.y)<r)return e;}return null;}
canvas.addEventListener("mousemove",e=>{const p=pointerPos(e),w=screenToWorld(p.x,p.y);mouse=p;$("coords").textContent=`X: ${w.x.toFixed(1)} / Y: ${w.y.toFixed(1)}`;if(drag&&drag.moving){drag.x2=p.x;drag.y2=p.y;drawMap();}});
canvas.addEventListener("mousedown",e=>{if(e.button!==0)return;const p=pointerPos(e);drag={x:p.x,y:p.y,x2:p.x,y2:p.y,moving:false};});
canvas.addEventListener("mouseup",e=>{
 if(!drag)return;const p=pointerPos(e);const dist=Math.hypot(p.x-drag.x,p.y-drag.y);const wasDrag=dist>6;drag=null;
 if(wasDrag)return;
 const obj=hitTest(p.x,p.y);
 if(obj){if(e.shiftKey){if(state.selected.includes(obj.id))state.selected=state.selected.filter(id=>id!==obj.id);else state.selected.push(obj.id);}else state.selected=[obj.id];renderSelection();drawMap();return;}
 state.selected=[];renderSelection();drawMap();
});
canvas.addEventListener("contextmenu",e=>{e.preventDefault();if(state.paused)return;const p=pointerPos(e),w=screenToWorld(p.x,p.y),units=selectedEntities().filter(u=>state.units.includes(u));if(!units.length){mapToast("Сначала выберите свои войска");return;}units.forEach((u,i)=>{const angle=2*Math.PI*i/units.length;u.target={x:clamp(w.x+Math.cos(angle)*16,25,mapW-25),y:clamp(w.y+Math.sin(angle)*16,25,mapH-25)};});mapToast("Приказ на перемещение передан");});
canvas.addEventListener("click",e=>{if(drag&&Math.hypot(pointerPos(e).x-drag.x,pointerPos(e).y-drag.y)>6){ctx.save();ctx.strokeStyle="#4bd9e9";ctx.fillStyle="#4bd9e916";ctx.strokeRect(drag.x,drag.y,drag.x2-drag.x,drag.y2-drag.y);ctx.restore();}});
$("zoomIn").onclick=()=>{state.camera.zoom=clamp(state.camera.zoom*1.15,0.75,1.8);drawMap();};$("zoomOut").onclick=()=>{state.camera.zoom=clamp(state.camera.zoom/1.15,.75,1.8);drawMap();};$("centerMap").onclick=()=>{state.camera={x:0,y:0,zoom:1};drawMap();};

function renderSelection(){
 const e=selected();const box=$("selectionContent");$("selectionTag").textContent=e?(e.team==="enemy"?"HOSTILE":(state.buildings.includes(e)||e.type==="hq")?"STRUCTURE":"UNIT"):"—";
 if(!e){box.innerHTML='<div class="empty-selection"><span>⌖</span><strong>Объект не выбран</strong><small>Выберите юнит или постройку на карте</small></div>';return;}
 const def=defs[e.type]||unitDefs[e.type]||{};
 const icon=e.icon||def.icon||(e.team==="enemy"?"✕":"⌖"),name=e.name||def.name||(e.team==="enemy"?"Вражеский дрон":"Юнит"),desc=def.desc||(e.team==="enemy"?"Неопознанная враждебная единица.":"Подразделение колонии.");
 let actions="";
 if(e.team==="player"&&state.units.includes(e))actions=`<button class="small-btn" data-action="attack">Атаковать цель</button><button class="small-btn" data-action="stop">Стоп</button>`;
 if(e.team==="player"&&state.buildings.includes(e)&&e.type==="barracks")actions=`<button class="small-btn" data-action="train">Обучить отряд</button>`;
 if(e.team==="player"&&state.buildings.includes(e)&&e.type==="turret")actions=`<button class="small-btn" data-action="upgrade-turret">Усилить турель · 90₡</button>`;
 if(e.team==="enemy")actions=`<button class="small-btn" data-action="attack">Атаковать цель</button>`;
 box.innerHTML=`<div class="selected-object"><div class="object-emblem">${icon}</div><div><h4>${name}</h4><p>${desc}</p></div></div><div class="object-meta"><span>ПРОЧНОСТЬ</span><b>${Math.ceil(e.hp)} / ${e.maxHp}</b></div><div class="health-track"><span style="width:${clamp(e.hp/e.maxHp*100,0,100)}%;background:${e.team==="enemy"?"var(--red)":"var(--green)"}"></span></div><div class="object-meta"><span>${e.team==="enemy"?"ВРАЖЕСКИЙ СИГНАЛ":"АРКАДИЯ / СОЮЗНИК"}</span><span>ID-${String(e.id).padStart(4,"0")}</span></div><div class="object-actions">${actions}</div>`;
 box.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>objectAction(e,b.dataset.action));
}
function objectAction(e,action){
 if(action==="stop"){e.target=null;e.attackTarget=null;toast("Приказы отменены.");}
 if(action==="attack"){const target=state.enemies.find(x=>x.id!==e.id)||state.enemies[0];if(!target){toast("Вражеских целей больше нет.");return;}for(const u of selectedEntities().filter(x=>state.units.includes(x)))u.attackTarget=target.id;toast("Приказ на атаку передан.");}
 if(action==="train"){trainUnit("soldier");}
 if(action==="upgrade-turret"){if(pay({credits:90,alloy:25})){e.damage=(e.damage||20)+8;toast("Турель усилена.");log("Оборонная турель модернизирована.");}}
 updateUI();drawMap();
}
function buildBuilding(type){
 const def=defs[type];if(!def)return;
 if(type==="barracks"&&state.buildings.some(b=>b.type==="barracks")){toast("Казарма уже построена.",true);return;}
 if(type==="lab"&&state.buildings.some(b=>b.type==="lab")){toast("Научный комплекс уже построен.",true);return;}
 if(!pay(def.cost))return;
 const angle=state.buildings.length*2.2,x=clamp(190+Math.cos(angle)*75,55,mapW-55),y=clamp(335+Math.sin(angle)*80,55,mapH-55);
 const b=entity(type,x,y,{name:def.name,icon:def.icon,hp:def.hp,maxHp:def.hp,income:def.income||{},team:"player"});
 state.buildings.push(b);state.selected=[b.id];log(`Построен объект: <b>${def.name}</b>.`);toast(`${def.name} введён в эксплуатацию.`);checkMission();updateUI();drawMap();renderBuild();
}
function trainUnit(type){
 const def=unitDefs[type];if(!def)return;
 if(!state.buildings.some(b=>b.type==="barracks")){toast("Сначала постройте казарму.",true);return;}
 if(state.units.length>=30){toast("Лимит армии достигнут.",true);return;}
 if(!pay(def.cost))return;
 const hq=state.buildings.find(b=>b.type==="hq"),angle=rand(0,Math.PI*2);
 const u=entity(type,clamp((hq?.x||155)+Math.cos(angle)*50,30,mapW-30),clamp((hq?.y||320)+Math.sin(angle)*50,30,mapH-30),{hp:def.hp,maxHp:def.hp,team:"player",damage:def.damage,range:def.range,speed:def.speed,rate:def.rate});
 state.units.push(u);state.selected=[u.id];log(`Подготовлен отряд: <b>${def.name}</b>.`);toast(`${def.name} готов к выполнению приказов.`);checkMission();updateUI();drawMap();renderArmy();
}
function renderBuild(){
 const body=$("modalBody");body.innerHTML=`<div class="option-grid">${Object.entries(defs).map(([type,d])=>`<article class="build-card"><div class="card-icon">${d.icon}</div><h3>${d.name}</h3><p>${d.desc}</p><div class="cost-line">${costText(d.cost)}</div><button data-build="${type}" ${!canAfford(d.cost)||(type==="barracks"&&state.buildings.some(b=>b.type===type))||(type==="lab"&&state.buildings.some(b=>b.type===type))?"disabled":""}>${(type==="barracks"||type==="lab")&&state.buildings.some(b=>b.type===type)?"Уже построено":"Построить"}</button></article>`).join("")}</div><p class="modal-note">Каждый объект занимает место на карте и влияет на экономику или оборону. Ресурсы списываются сразу при строительстве.</p>`;
 body.querySelectorAll("[data-build]").forEach(b=>b.onclick=()=>buildBuilding(b.dataset.build));
}
function renderArmy(){
 const body=$("modalBody");body.innerHTML=`<div class="army-list">${Object.entries(unitDefs).map(([type,d])=>`<div class="army-row"><div class="army-emblem">${d.icon}</div><div><h3>${d.name}</h3><p>${d.desc}<br>Прочность ${d.hp} · Урон ${d.damage} · Радиус ${d.range}</p><p>${costText(d.cost)}</p></div><button data-train="${type}" ${!canAfford(d.cost)||!state.buildings.some(b=>b.type==="barracks")||state.units.length>=30?"disabled":""}>Обучить</button></div>`).join("")}</div>${!state.buildings.some(b=>b.type==="barracks")?'<p class="modal-note">Чтобы обучать войска, сначала постройте казарму.</p>':""}`;
 body.querySelectorAll("[data-train]").forEach(b=>b.onclick=()=>trainUnit(b.dataset.train));
}
const techDefs={weapons:{name:"Боевые алгоритмы",icon:"⌁",desc:"+20% урона всем боевым единицам за уровень.",cost:{credits:180,energy:80,alloy:30}},industry:{name:"Автоматизация производства",icon:"ϟ",desc:"+3 кредита в минуту за уровень.",cost:{credits:150,energy:100,alloy:35}},shields:{name:"Композитная броня",icon:"⬡",desc:"+15% прочности всем новым юнитам за уровень.",cost:{credits:170,energy:70,alloy:55}}};
function research(type){
 const d=techDefs[type];if(!d)return;if(!state.buildings.some(b=>b.type==="lab")){toast("Для исследований нужен научный комплекс.",true);return;}if(state.tech[type]>=3){toast("Достигнут максимальный уровень.",true);return;}const cost=Object.fromEntries(Object.entries(d.cost).map(([k,v])=>[k,v*(state.tech[type]+1)]));if(!pay(cost))return;state.tech[type]++;log(`Исследование завершено: <b>${d.name}</b>, уровень ${state.tech[type]}.`);toast("Технология улучшена.");checkMission();updateUI();drawMap();renderResearch();
}
function renderResearch(){
 $("modalBody").innerHTML=`<div class="option-grid">${Object.entries(techDefs).map(([type,d])=>{const level=state.tech[type],cost=Object.fromEntries(Object.entries(d.cost).map(([k,v])=>[k,v*(level+1)]));return `<article class="research-card"><div class="card-icon">${d.icon}</div><h3>${d.name}</h3><p>${d.desc}</p><div class="cost-line">Уровень ${level}/3</div><div class="cost-line">${costText(cost)}</div><button data-tech="${type}" ${!canAfford(cost)||level>=3||!state.buildings.some(b=>b.type==="lab")?"disabled":""}>${level>=3?"Максимум":"Исследовать"}</button></article>`}).join("")}</div>${!state.buildings.some(b=>b.type==="lab")?'<p class="modal-note">Постройте научный комплекс, чтобы открыть технологическое дерево.</p>':""}`;
 $("modalBody").querySelectorAll("[data-tech]").forEach(b=>b.onclick=()=>research(b.dataset.tech));
}
function renderCampaign(){
 const body=$("modalBody");body.innerHTML=`<article class="campaign-card"><span class="campaign-state">АКТИВНЫЙ СЦЕНАРИЙ · ${state.mode==="campaign"?"КАМПАНИЯ":"ПЕСОЧНИЦА"}</span><h3>Операция «Первый свет»</h3><p>Разверните колонию на Аркадии, наладьте производство, изучите технологии и очистите сектор от враждебных дронов.</p><div class="cost-line">Цели: инфраструктура · экономика · армия · контроль сектора</div><button id="toggleMode">${state.mode==="campaign"?"Переключиться в песочницу":"Переключиться в кампанию"}</button></article><article class="campaign-card"><span class="campaign-state">УСЛОВИЯ ПОБЕДЫ</span><h3>Контроль над Аркадией</h3><p>Уничтожьте все вражеские отряды, постройте научный комплекс и завершите четыре директивы. В песочнице игра продолжается без финального экрана.</p><button id="showObjectives">Показать директивы</button></article><p class="modal-note">Противник действует самостоятельно: перемещает патрули, атакует ближайшие цели и периодически вызывает подкрепления. Время в мире идёт в реальном времени.</p>`;
 $("toggleMode").onclick=()=>{state.mode=state.mode==="campaign"?"sandbox":"campaign";toast("Режим: "+(state.mode==="campaign"?"кампания":"песочница"));closeModal();updateUI();};
 $("showObjectives").onclick=()=>{closeModal();$("missionBanner").scrollIntoView({behavior:"smooth",block:"center"});};
}
function openModal(title,kicker,renderer){$("modalTitle").textContent=title;$("modalKicker").textContent=kicker;$("modalBackdrop").classList.remove("hidden");renderer();}
function closeModal(){$("modalBackdrop").classList.add("hidden");}
function showBuild(){openModal("Строительство","ИНФРАСТРУКТУРА / CONSTRUCTION",renderBuild);}
function showArmy(){openModal("Армия и производство","ВОЕННОЕ КОМАНДОВАНИЕ / ARMY",renderArmy);}
function showResearch(){openModal("Дерево технологий","НАУЧНЫЙ ОТДЕЛ / RESEARCH",renderResearch);}
function showCampaign(){openModal("Операции и директивы","СТРАТЕГИЧЕСКИЙ ШТАБ / CAMPAIGN",renderCampaign);}
$("modalClose").onclick=closeModal;$("modalBackdrop").addEventListener("click",e=>{if(e.target===$("modalBackdrop"))closeModal();});
document.querySelectorAll(".nav-item[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".nav-item[data-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");switch(b.dataset.tab){case"overview":$("pageTitle").textContent="Развитие колонии";$("pageSubtitle").textContent="Расширяйте производство. Исследуйте технологии. Подготовьтесь к угрозе.";break;case"build":showBuild();break;case"army":showArmy();break;case"research":showResearch();break;case"campaign":showCampaign();break;}}));
document.querySelectorAll("[data-quick]").forEach(b=>b.onclick=()=>({build:showBuild,army:showArmy,research:showResearch})[b.dataset.quick]());
$("missionBtn").onclick=()=>{const m=missions[state.campaignIndex];if(!m){showCampaign();return;}if(m.title.includes("плацдарм"))showBuild();else if(m.title.includes("промышленность"))showBuild();else if(m.title.includes("угрозу")){const e=state.enemies[0];if(e){state.selected=[e.id];renderSelection();drawMap();mapToast("Вражеский отряд отмечен на карте.");}}else showResearch();};
$("clearLog").onclick=()=>$("eventLog").replaceChildren();
$("settingsBtn").onclick=()=>openModal("Настройки системы","LOCAL CONFIGURATION",()=>{$("modalBody").innerHTML=`<div class="settings-row"><span>Звук интерфейса</span><input type="checkbox" id="soundToggle" checked></div><div class="settings-row"><span>Автосохранение</span><input type="checkbox" id="autoSaveToggle" checked></div><div class="settings-row"><span>Скорость симуляции</span><select id="speedSelect" style="background:#142230;color:#eaf3fc;border:1px solid #304253;padding:7px;border-radius:5px"><option value="0.75">Медленно</option><option value="1" selected>Нормально</option><option value="1.5">Быстро</option></select></div><button class="primary-wide" id="settingsDone">Применить</button>`;$("settingsDone").onclick=()=>{autoSave=$("autoSaveToggle").checked;speed=Number($("speedSelect").value);closeModal();toast("Настройки применены.");};});
let autoSave=true,speed=1;
$("saveBtn").onclick=()=>saveGame(true);
$("exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="dominion-2026-save.json";a.click();URL.revokeObjectURL(a.href);toast("Файл сохранения экспортирован.");};
$("newGameBtn").onclick=()=>openModal("Начать новую игру","RESET CAMPAIGN",()=>{$("modalBody").innerHTML=`<p style="color:#aab9c9;line-height:1.7">Текущий прогресс будет заменён новой колонией. При необходимости сначала экспортируйте сохранение.</p><button class="primary-wide" id="confirmNew">Создать новую колонию</button>`;$("confirmNew").onclick=()=>{localStorage.removeItem(SAVE_KEY);location.reload();};});
function snapshot(){return {version:1,resources:state.resources,elapsed:state.elapsed,mode:state.mode,units:state.units,buildings:state.buildings,enemies:state.enemies,tech:state.tech,completed:state.completed,campaignIndex:state.campaignIndex,enemyTimer:state.enemyTimer,nextId:state.nextId,stats:state.stats,stability:state.stability,camera:state.camera};}
function saveGame(manual=false){try{localStorage.setItem(SAVE_KEY,JSON.stringify(snapshot()));if(manual)toast("Игра сохранена на этом устройстве.");}catch(e){if(manual)toast("Не удалось сохранить прогресс в браузере.",true);}}
function loadGame(){
 try{const raw=localStorage.getItem(SAVE_KEY);if(!raw)return false;const d=JSON.parse(raw);if(d.version!==1)return false;
  for(const k of ["resources","elapsed","mode","units","buildings","enemies","tech","campaignIndex","enemyTimer","nextId","stats","stability","camera"])if(d[k]!==undefined)state[k]=d[k];
  state.projectiles=[];state.particles=[];state.selected=[];return true;
 }catch(e){return false;}
}
function updateEconomy(dt){
 for(const b of state.buildings){if(b.hp<=0)continue;const inc=b.income||defs[b.type]?.income||{};for(const [k,v]of Object.entries(inc))state.resources[k]=Math.min(99999,state.resources[k]+v*dt);}
 if(state.tech.industry)state.resources.credits+=state.tech.industry*0.05*dt;
}
function spawnEnemy(){
 const edge=Math.random()<.5?0:mapW;const y=rand(100,mapH-80);
 const u=entity("enemy",edge?mapW-25:25,y,{hp:150+state.elapsed*.15,maxHp:150+state.elapsed*.15,damage:12+state.elapsed*.015,range:105,speed:28,rate:1.2,team:"enemy"});
 state.enemies.push(u);log("<b>Вражеское подкрепление</b> замечено на границе сектора.","danger");toast("Вражеский сигнал: обнаружено подкрепление.",true);
}
function nearestTarget(e,targets){let best=null,dist=Infinity;for(const t of targets){const d=Math.hypot(t.x-e.x,t.y-e.y);if(d<dist){dist=d;best=t;}}return {target:best,dist};}
function damageEntity(target,amount,source){
 target.hp-=amount;
 if(target.hp<=0){
  if(state.enemies.includes(target)){state.enemies=state.enemies.filter(x=>x.id!==target.id);state.stats.kills++;state.resources.credits+=25;state.resources.alloy+=5;log("Вражеский отряд уничтожен. Получено <b>25 кредитов</b>.");checkMission();}
  else if(state.units.includes(target)){state.units=state.units.filter(x=>x.id!==target.id);log("Потерян дружественный отряд.","danger");}
  else if(state.buildings.includes(target)){state.buildings=state.buildings.filter(x=>x.id!==target.id);log("Объект инфраструктуры уничтожен.","danger");state.stability=Math.max(20,state.stability-8);}
  state.selected=state.selected.filter(id=>id!==target.id);state.particles.push(...Array.from({length:16},()=>({x:target.x+rand(-8,8),y:target.y+rand(-8,8),vx:rand(-35,35),vy:rand(-35,35),life:.6,maxLife:.6,color:target.team==="enemy"?"#ff687d":"#4bd9e9"})));
  updateUI();renderSelection();
 }
}
function combatUpdate(dt){
 const friendly=[...state.units,...state.buildings.filter(b=>b.type==="turret")],hostile=state.enemies;
 for(const u of [...state.units,...state.enemies]){
  const enemy=u.team==="enemy",targets=enemy?friendly:hostile;if(!targets.length){u.attackTarget=null;continue;}
  let target=u.attackTarget?findEntity(u.attackTarget):null;if(!target||target.hp<=0||target.team===u.team){const near=nearestTarget(u,targets);target=near.target;if(target)u.attackTarget=target.id;}
  if(!target)continue;
  const dx=target.x-u.x,dy=target.y-u.y,d=Math.hypot(dx,dy),range=u.range||100;
  const def=unitDefs[u.type]||{},speed=u.speed||0,rate=u.rate||1;
  if(d>range*.82&&speed>0){if(!u.target)u.target={x:target.x,y:target.y};else if(Math.hypot(u.target.x-target.x,u.target.y-target.y)>45)u.target={x:target.x,y:target.y};}
  if(u.target&&speed>0){
   const tx=u.target.x-u.x,ty=u.target.y-u.y,td=Math.hypot(tx,ty);
   if(td>5){u.x+=tx/td*speed*dt;u.y+=ty/td*speed*dt;u.angle=Math.atan2(ty,tx)+Math.PI/2;}
   else u.target=null;
  }
  if(d<=range){u.cooldown-=dt;if(u.cooldown<=0){u.cooldown=rate;const techBonus=!enemy?1+state.tech.weapons*.2:1;const damage=(u.damage||def.damage||14)*techBonus;
    state.projectiles.push({x:u.x,y:u.y,vx:dx/Math.max(1,d)*260,vy:dy/Math.max(1,d)*260,life:.25,target:target.id,damage,color:enemy?"#ff7187":"#57eaf4"});
  }}
 }
 for(const b of state.buildings.filter(x=>x.type==="turret")){const near=nearestTarget(b,hostile);if(near.target&&near.dist<170){b.cooldown=(b.cooldown||0)-dt;if(b.cooldown<=0){b.cooldown=.8;state.projectiles.push({x:b.x,y:b.y-8,vx:(near.target.x-b.x)/Math.max(1,near.dist)*300,vy:(near.target.y-b.y)/Math.max(1,near.dist)*300,life:.3,target:near.target.id,damage:26+state.tech.weapons*4,color:"#ffb45e"});}}}
 for(const p of state.projectiles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;const t=findEntity(p.target);if(t&&Math.hypot(p.x-t.x,p.y-t.y)<16){damageEntity(t,p.damage);p.life=-1;}}
 state.projectiles=state.projectiles.filter(p=>p.life>0);
}
function enemyAI(dt){
 state.enemyTimer-=dt;if(state.enemyTimer<=0){state.enemyTimer=state.mode==="campaign"?36:48;if(state.enemies.length<10)spawnEnemy();}
 for(const e of state.enemies){
  const targets=[...state.units,...state.buildings];if(!targets.length)continue;
  const {target,dist}=nearestTarget(e,targets);if(!target)continue;
  if(dist>e.range*.8&&!e.target)e.target={x:target.x,y:target.y};
  if(e.target){const dx=e.target.x-e.x,dy=e.target.y-e.y,d=Math.hypot(dx,dy);if(d>4){e.x+=dx/d*(e.speed||25)*dt;e.y+=dy/d*(e.speed||25)*dt;}else e.target=null;}
 }
}
function updateParticles(dt){for(const p of state.particles){p.x+=(p.vx||0)*dt;p.y+=(p.vy||0)*dt;p.life-=dt;}state.particles=state.particles.filter(p=>p.life>0);}
function frame(now){
 const dt=Math.min((now-lastFrame)/1000,.05)*speed;lastFrame=now;
 if(gameStarted&&!state.paused){state.elapsed+=dt;updateEconomy(dt);combatUpdate(dt);enemyAI(dt);updateParticles(dt);saveTimer+=dt;lastIncome+=dt;if(saveTimer>12){if(autoSave)saveGame();saveTimer=0;}if(lastIncome>.5){updateUI();lastIncome=0;}}
 drawMap();requestAnimationFrame(frame);
}
function init(){
 const loaded=loadGame();if(!loaded)addStartingWorld();
 $("eventLog").replaceChildren();
 log(loaded?"<b>Сохранение восстановлено.</b> Колония готова к работе.":"<b>Система запущена.</b> Командный центр функционирует.");
 log("Сканирование завершено: обнаружены неизвестные сигналы.","warning");
 log("Производственные линии работают в штатном режиме.");
 gameStarted=true;resizeCanvas();updateUI();renderSelection();
 window.addEventListener("resize",resizeCanvas);
 document.addEventListener("keydown",e=>{if(e.target.matches("input,select,textarea"))return;if(e.key==="Escape")closeModal();if(e.key==="1")document.querySelector('[data-tab="overview"]').click();if(e.key==="2")showBuild();if(e.key==="3")showArmy();if(e.key==="4")showResearch();if(e.key==="5")showCampaign();if(e.code==="Space"){e.preventDefault();state.paused=!state.paused;toast(state.paused?"Симуляция приостановлена":"Симуляция продолжена");}});
 window.addEventListener("beforeunload",()=>saveGame());
}
init();requestAnimationFrame(frame);
})();