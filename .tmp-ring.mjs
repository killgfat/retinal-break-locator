import {createEyeballGeometry, limbusRing} from './src/visualize.js';
import {calculateEyeGeometry} from './src/mapper.js';
for(const AL of [20,24,26,30]){
  const g=calculateEyeGeometry(AL);
  const L=limbusRing(g);
  const geo=createEyeballGeometry(g);
  const p=geo.attributes.position.array;
  const segLat=72,segLon=96,body=(segLat+1)*(segLon+1);
  let bMin=Infinity,bMax=-Infinity,bzMin=Infinity,bzMax=-Infinity;
  for(let i=(body-segLon-1)*3;i<body*3;i+=3){const r=Math.hypot(p[i],p[i+1]);bMin=Math.min(bMin,r);bMax=Math.max(bMax,r);bzMin=Math.min(bzMin,p[i+2]);bzMax=Math.max(bzMax,p[i+2]);}
  console.log(`AL=${AL} ring r=${L.radius.toFixed(3)} z=${L.z.toFixed(3)}  线框末圈 r=[${bMin.toFixed(3)},${bMax.toFixed(3)}] z=[${bzMin.toFixed(3)},${bzMax.toFixed(3)}]  差 r=${(bMax-L.radius).toExponential(1)} z=${(bzMax-L.z).toExponential(1)}`);
}
