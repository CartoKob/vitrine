
(function(){
  const themes={
    epure:{bg:"#f6f1e7",ink:"#171717",road:"#8f8a82",minor:"#c8c1b6",a:"#ad5945",b:"#2f6178",water:"#b9ced4",park:"#c8d2c1"},
    night:{bg:"#15191c",ink:"#f3eee4",road:"#77818a",minor:"#485159",a:"#ef8354",b:"#65c2cf",water:"#244c5a",park:"#31483d"},
    atlas:{bg:"#e8ece7",ink:"#17201c",road:"#697b72",minor:"#acb7af",a:"#b23831",b:"#315f79",water:"#a9c9d1",park:"#b8ccb7"},
    vintage:{bg:"#eadcc2",ink:"#2a211a",road:"#8d775f",minor:"#c3ae8d",a:"#914b3e",b:"#586c59",water:"#b8c4bd",park:"#bfc3a5"}
  };
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s||"").replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));
  const short=s=>String(s||"").split(",")[0].trim().slice(0,36);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  async function geocode(q){
    const k="ici:g:"+q.trim().toLowerCase(), cached=localStorage.getItem(k);
    if(cached)return JSON.parse(cached);
    const r=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q="+encodeURIComponent(q),{headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error("Géocodage indisponible");
    const j=await r.json(); if(!j.length)throw new Error("Lieu introuvable : "+q);
    const o={lat:+j[0].lat,lon:+j[0].lon,label:j[0].display_name}; localStorage.setItem(k,JSON.stringify(o)); return o;
  }
  async function route(a,b){
    const u="https://router.project-osrm.org/route/v1/driving/"+a.lon+","+a.lat+";"+b.lon+","+b.lat+"?overview=full&geometries=geojson";
    const r=await fetch(u); if(!r.ok)throw new Error("Routage indisponible");
    const j=await r.json(); if(j.code!=="Ok"||!j.routes?.length)throw new Error("Aucun trajet trouvé");
    return j.routes[0];
  }
  async function features(box,rich=false){
    const highway=rich?"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street":"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service";
    let q='[out:json][timeout:18];('+'way["highway"~"'+highway+'"]('+box.s+','+box.w+','+box.n+','+box.e+');';
    if(rich)q+='way["building"]('+box.s+','+box.w+','+box.n+','+box.e+');way["waterway"]('+box.s+','+box.w+','+box.n+','+box.e+');way["natural"="water"]('+box.s+','+box.w+','+box.n+','+box.e+');way["leisure"="park"]('+box.s+','+box.w+','+box.n+','+box.e+');way["landuse"~"grass|forest|recreation_ground|meadow"]('+box.s+','+box.w+','+box.n+','+box.e+');';
    q+=');out geom;';
    const endpoints=["https://overpass.private.coffee/api/interpreter","https://overpass-api.de/api/interpreter"];
    for(const endpoint of endpoints){
      try{
        const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),14000);
        const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"data="+encodeURIComponent(q),signal:ctl.signal});
        clearTimeout(timer); if(!r.ok)continue; const j=await r.json();
        const out=(j.elements||[]).filter(x=>x.geometry).slice(0,3200).map(x=>{
          const t=x.tags||{},coords=x.geometry.map(g=>[g.lon,g.lat]); let kind="other";
          if(t.highway)kind="road"; else if(t.building)kind="building"; else if(t.waterway||t.natural==="water")kind="water"; else if(t.leisure==="park"||t.landuse)kind="park";
          return {kind,cls:t.highway||t.landuse||t.waterway||"",name:t.name||"",coords,closed:coords.length>3&&coords[0][0]===coords.at(-1)[0]&&coords[0][1]===coords.at(-1)[1]};
        }).filter(x=>x.kind!=="other");
        if(out.some(x=>x.kind==="road"))return out;
      }catch(e){}
    }
    return [];
  }
  function projector(coords,rect={x:46,y:170,w:708,h:630},pad=18){
    const merc=p=>{const lat=Math.max(-85,Math.min(85,p[1]))*Math.PI/180;return[p[0],Math.log(Math.tan(Math.PI/4+lat/2))*180/Math.PI]};
    const m=coords.map(merc),xs=m.map(p=>p[0]),ys=m.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const scale=Math.min((rect.w-pad*2)/Math.max(maxX-minX,.00001),(rect.h-pad*2)/Math.max(maxY-minY,.00001));
    const usedW=(maxX-minX)*scale,usedH=(maxY-minY)*scale,ox=rect.x+(rect.w-usedW)/2,oy=rect.y+(rect.h-usedH)/2;
    const project=p=>{const v=merc(p);return[ox+(v[0]-minX)*scale,oy+usedH-(v[1]-minY)*scale]};
    const path=cc=>cc.map((p,i)=>{const q=project(p);return(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)}).join(" ");
    return {project,path};
  }
  function roadW(c){if(/motorway|trunk/.test(c))return 2.5;if(c==="primary")return 2;if(c==="secondary")return 1.5;if(c==="tertiary")return 1.15;if(c==="residential")return .75;return .5}
  function featureSvg(fs,p,t,rich=false){
    return fs.map(f=>{
      const d=p.path(f.coords);if(!d)return"";
      if(f.kind==="building")return rich&&f.closed?'<path d="'+d+' Z" fill="'+t.ink+'" fill-opacity=".07"/>':"";
      if(f.kind==="water")return f.closed?'<path d="'+d+' Z" fill="'+t.water+'" fill-opacity=".55"/>':'<path d="'+d+'" fill="none" stroke="'+t.water+'" stroke-width="2.5"/>';
      if(f.kind==="park")return rich&&f.closed?'<path d="'+d+' Z" fill="'+t.park+'" fill-opacity=".32"/>':"";
      const w=roadW(f.cls);return '<path d="'+d+'" fill="none" stroke="'+(w<1?t.minor:t.road)+'" stroke-width="'+w+'" stroke-linecap="round" opacity="'+(w<1?.5:.78)+'"/>';
    }).join("");
  }
  function base(title,sub,t){
    return '<rect width="800" height="1000" fill="'+t.bg+'"/><text x="46" y="48" font-family="Georgia" font-size="10" letter-spacing="3" fill="'+t.ink+'" opacity=".55">ICI. · CARTOKOB</text><text x="46" y="108" font-family="Georgia" font-size="50" font-weight="700" letter-spacing="-3" fill="'+t.ink+'">'+esc(title)+'</text><text x="754" y="103" text-anchor="end" font-family="Georgia" font-size="15" fill="'+t.ink+'" opacity=".75">'+esc(sub)+'</text><line x1="46" y1="138" x2="754" y2="138" stroke="'+t.ink+'" opacity=".2"/>';
  }
  function bottom(main,sub,t,right=""){
    return '<line x1="46" y1="826" x2="754" y2="826" stroke="'+t.ink+'" opacity=".18"/><text x="46" y="884" font-family="Georgia" font-size="29" font-weight="700" fill="'+t.ink+'">'+esc(main)+'</text><text x="46" y="915" font-family="Georgia" font-size="13" fill="'+t.ink+'" opacity=".58">'+esc(sub)+'</text><text x="754" y="884" text-anchor="end" font-family="Georgia" font-size="11" fill="'+t.ink+'" opacity=".52">'+esc(right)+'</text><text x="754" y="916" text-anchor="end" font-family="Georgia" font-size="10" fill="'+t.ink+'" opacity=".42">© OpenStreetMap contributors</text><text x="46" y="968" font-family="Georgia" font-size="13" font-weight="700" fill="'+t.ink+'">ICI. par CartoKob</text>';
  }
  function download(id,name,png=true){
    const svg=document.getElementById(id).cloneNode(true);svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
    const ns="http://www.w3.org/2000/svg",g=document.createElementNS(ns,"g");g.setAttribute("opacity",".10");g.setAttribute("transform","rotate(-28 400 500)");
    [460,540,620].forEach(y=>{const tx=document.createElementNS(ns,"text");tx.setAttribute("x","400");tx.setAttribute("y",y);tx.setAttribute("text-anchor","middle");tx.setAttribute("font-family","Georgia");tx.setAttribute("font-size","62");tx.setAttribute("font-weight","700");tx.setAttribute("letter-spacing","7");tx.textContent="CARTOKOB";g.appendChild(tx)});svg.appendChild(g);
    const xml=new XMLSerializer().serializeToString(svg),blob=new Blob([xml],{type:"image/svg+xml;charset=utf-8"});
    if(!png){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name+".svg";a.click();return}
    const u=URL.createObjectURL(blob),img=new Image();img.onload=()=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0,1080,1350);URL.revokeObjectURL(u);c.toBlob(p=>{const a=document.createElement("a");a.href=URL.createObjectURL(p);a.download=name+"-SD.png";a.click()},"image/png",.92)};img.src=u;
  }
  window.ICI={themes,$,$$,esc,short,sleep,geocode,route,features,projector,roadW,featureSvg,base,bottom,download};
})();