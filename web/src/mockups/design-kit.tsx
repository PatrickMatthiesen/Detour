import {useEffect,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import type {FeatureCollection,LineString} from 'geojson';
import {Compass} from 'lucide-react';
import {getTrip} from '../api';
import type {Place,TripSnapshot} from '../types';
import {centers, cityMapCenter, unresolvedRouteCities} from '../plan/city-location';
export {cityMapCenter} from '../plan/city-location';
import {STATUS_COLORS, type summarizeCityStops} from './route-status';
import PlacePhoto from '../photos/PlacePhoto';
import {photoFor} from '../photos/place-photo';
import './design-kit.css';
import 'maplibre-gl/dist/maplibre-gl.css';
export {PlacePhoto,photoFor};
export const designNames=['Photo explorer','City chapters','Interest board','Route planner','Map explorer','Day composer'];
const featured=['Gotokuji Temple','Ghibli Museum, Mitaka','Ginza Itoya','Melon Pan 802 Hachioji','Menya Musashi — Tokyo locations','Koenji — thrift and vintage neighbourhood','Pixel Lab Tokyo — Game Boy Mod Workshop','Nakano — anime, watches and nightlife'];
const knownCoordinates:Record<string,{latitude:number;longitude:number}>={
 'Gotokuji Temple':{latitude:35.64877778,longitude:139.64741667},
 'Ghibli Museum, Mitaka':{latitude:35.69623333,longitude:139.57043056},
};
export function displayPlaces(input:Place[]){const rank=(p:Place)=>{const i=featured.indexOf(p.name);return i<0?100:i}; return [...input].sort((a,b)=>rank(a)-rank(b)).map(p=>{const coordinates=knownCoordinates[p.name];return p.latitude==null&&p.longitude==null&&coordinates?{...p,...coordinates}:p})}
export function useDesignTrip(){
 const [trip,setTrip]=useState<TripSnapshot|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Set<string>>(new Set());
 useEffect(()=>{let alive=true;getTrip().then(t=>{if(!alive)return; const places=displayPlaces(t.places);setTrip({...t,places});setSelected(new Set(t.places.filter(p=>p.selected).map(p=>p.id)))}).catch(e=>alive&&setError(String(e)));return()=>{alive=false}},[]);
 const toggle=(id:string)=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next});
 return {trip,selected,toggle,loading:!trip&&!error,error};
}
export function cityPlaces(trip:TripSnapshot|null,city:string){return trip?.places.filter(p=>!city||city==='All'||city==='All cities'||p.city===city)??[]}
export function shortDate(date:string){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date.slice(0,10)+'T12:00:00Z'))}
export function PreviewNav({active}:{active:number}){return <header className="dk-nav"><a href="/" className="dk-trip"><Compass size={19}/><strong>Japan 2026</strong><span>30 Sep – 25 Oct</span></a><nav aria-label="Design alternatives">{designNames.map((n,i)=><a key={n} href={'/'+(i+4)} className={active===i+4?'dk-active':''} title={n}>{i+4}<span>{n}</span></a>)}</nav><span className="dk-preview" title="Your saved trip is unchanged. Reload to reset this preview.">Preview only</span></header>}
const defaultAreaRadius=(city:string):[number,number]=>city==='Tokyo'?[.23,.13]:[.10,.08];
/** Return an ellipse perimeter that contains every resolved place in a city. */
export function cityAreaPerimeter(city:string,points:Array<[number,number]>,center=centers[city]):Array<[number,number]> {
 if(!center)return [];
 const [baseX,baseY]=defaultAreaRadius(city);
 const scale=points.reduce((max,[x,y])=>{
  if(!Number.isFinite(x)||!Number.isFinite(y))return max;
  const distance=Math.hypot((x-center[0])/baseX,(y-center[1])/baseY);
  return Math.max(max,distance);
 },1)*1.12;
 const [radiusX,radiusY]=[baseX*scale,baseY*scale];
 return Array.from({length:49},(_,i)=>{const angle=i/48*Math.PI*2;return [center[0]+radiusX*Math.cos(angle),center[1]+radiusY*Math.sin(angle)]});
}
/** Gentle schematic curves separate opposite directions without implying transport paths. */
function cityRouteCurve(from:[number,number],to:[number,number]):Array<[number,number]> {
 const start=maplibregl.MercatorCoordinate.fromLngLat(from),end=maplibregl.MercatorCoordinate.fromLngLat(to);
 const dx=end.x-start.x,dy=end.y-start.y;
 const control={x:(start.x+end.x)/2-dy*.16,y:(start.y+end.y)/2+dx*.16};
 return Array.from({length:25},(_,i)=>{
  if(i===0)return from;
  if(i===24)return to;
  const t=i/24,u=1-t;
  const point=new maplibregl.MercatorCoordinate(u*u*start.x+2*u*t*control.x+t*t*end.x,u*u*start.y+2*u*t*control.y+t*t*end.y).toLngLat();
  return [point.lng,point.lat];
 });
}
type MapPoint=[number,number];
function insideArea([x,y]:MapPoint,polygon:MapPoint[]):boolean {
 let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [ax,ay]=polygon[i],[bx,by]=polygon[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}
/** Remove the part inside an endpoint group, intersecting its actual rendered perimeter. */
function trimRouteStart(line:MapPoint[],polygon:MapPoint[]):MapPoint[] {
 if(!polygon.length||!line.length||!insideArea(line[0],polygon))return line;
 const outside=line.findIndex(point=>!insideArea(point,polygon));
 if(outside<0)return [];
 const [ax,ay]=line[outside-1],[bx,by]=line[outside],dx=bx-ax,dy=by-ay;
 for(let i=1;i<polygon.length;i++){
  const [cx,cy]=polygon[i-1],[ex,ey]=polygon[i],sx=ex-cx,sy=ey-cy;
  const cross=dx*sy-dy*sx;
  if(cross===0)continue;
  const t=((cx-ax)*sy-(cy-ay)*sx)/cross,u=((cx-ax)*dy-(cy-ay)*dx)/cross;
  if(t>=0&&t<=1&&u>=0&&u<=1)return [[ax+t*dx,ay+t*dy],...line.slice(outside)];
 }
 return line.slice(outside);
}
function routeOutsideGroups(line:MapPoint[],fromArea:MapPoint[],toArea:MapPoint[]):MapPoint[] {
 if(!fromArea.length&&!toArea.length)return line;
 // Clip in Mercator space so endpoints match the map's projected polygon edges.
 const project=(point:MapPoint):MapPoint=>{const p=maplibregl.MercatorCoordinate.fromLngLat(point);return [p.x,p.y]};
 const startTrimmed=trimRouteStart(line.map(project),fromArea.map(project));
 const trimmed=trimRouteStart([...startTrimmed].reverse(),toArea.map(project)).reverse();
 return trimmed.map(([x,y])=>{const p=new maplibregl.MercatorCoordinate(x,y).toLngLat();return [p.lng,p.lat]});
}
/** Connect adjacent planned stops only; unresolved stops must leave a gap. */
export function cityRouteFeatures(stops:ReadonlyArray<{city:string}>,places:Place[]):FeatureCollection<LineString> {
 const features:FeatureCollection<LineString>['features']=[];
 const boundaries=new Map<string,MapPoint[]>();
 for(const {city} of stops){
  if(boundaries.has(city))continue;
  const members=places.filter(p=>p.city===city),center=cityMapCenter(city,places);
  boundaries.set(city,members.length&&center?cityAreaPerimeter(city,members.flatMap(p=>p.longitude!=null&&p.latitude!=null?[[p.longitude,p.latitude] as MapPoint]:[]),center):[]);
 }
 for(let i=1;i<stops.length;i++){
  const from=cityMapCenter(stops[i-1].city,places),to=cityMapCenter(stops[i].city,places);
  if(!from||!to||(from[0]===to[0]&&from[1]===to[1]))continue;
  const coordinates=routeOutsideGroups(cityRouteCurve(from,to),boundaries.get(stops[i-1].city)!,boundaries.get(stops[i].city)!);
  if(coordinates.length<2)continue;
  features.push({type:'Feature',properties:{from:stops[i-1].city,to:stops[i].city},geometry:{type:'LineString',coordinates}});
 }
 return {type:'FeatureCollection',features};
}
const empty:any={type:'FeatureCollection',features:[]};
const noRouteStops:ReadonlyArray<{city:string}>=[];
const routeColor='#527cc4';
const noCityStatuses:ReturnType<typeof summarizeCityStops>={};
function routeArrowImage():ImageData {
 const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
 const context=canvas.getContext('2d')!;
 context.strokeStyle=routeColor;context.lineWidth=2.5;context.lineCap='round';context.lineJoin='round';
 context.beginPath();context.moveTo(8,5);context.lineTo(15,12);context.lineTo(8,19);context.stroke();
 return context.getImageData(0,0,24,24);
}
export function DesignMap({places,selected,city,onCity,onPlace,className='',route=false,routeStops=noRouteStops,cityStatuses=noCityStatuses,palette,showInformation=true}:{places:Place[];selected:Set<string>;city?:string;onCity?:(city:string)=>void;onPlace?:(place:Place)=>void;className?:string;route?:boolean;routeStops?:ReadonlyArray<{city:string}>;cityStatuses?:ReturnType<typeof summarizeCityStops>;showInformation?:boolean;palette?:'stone'|'sage'|'sand'|'original'|'journey'}){
 const originalPaint=useRef(new Map<string,unknown>());
 const host=useRef<HTMLDivElement>(null),map=useRef<maplibregl.Map|null>(null),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);const callbacks=useRef({onCity,onPlace,places});callbacks.current={onCity,onPlace,places};
 useEffect(()=>{if(!host.current)return;const m=new maplibregl.Map({container:host.current,style:'https://tiles.openfreemap.org/styles/positron',center:[137.5,35.8],zoom:5.8,attributionControl:{compact:true}});map.current=m;let live=true;
 m.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
 m.on('load',()=>{if(!live)return; for(const id of ['areas','points','route'])m.addSource('dk-'+id,{type:'geojson',data:empty});
 m.addLayer({id:'dk-area-fill',type:'fill',source:'dk-areas',paint:{'fill-color':['get','statusColor'],'fill-opacity':['case',['get','active'],0.10,0.03]}});
 m.addLayer({id:'dk-area-edge',type:'line',source:'dk-areas',paint:{'line-color':['get','statusColor'],'line-width':1.5,'line-dasharray':[3,3]}});
 m.addLayer({id:'dk-route-line',type:'line',source:'dk-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':routeColor,'line-width':1.2,'line-opacity':0.65}});
 m.addImage('dk-route-arrow',routeArrowImage(),{pixelRatio:2});
 m.addLayer({id:'dk-route-arrows',type:'symbol',source:'dk-route',layout:{'symbol-placement':'line','symbol-spacing':130,'icon-image':'dk-route-arrow','icon-rotation-alignment':'map','icon-keep-upright':false,'icon-ignore-placement':true,'icon-padding':8},paint:{'icon-opacity':0.85}});
 m.addLayer({id:'dk-dots',type:'circle',source:'dk-points',filter:['==',['get','place'],true],paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.5,6,2.5,10,4.5,14,7],'circle-color':['case',['get','selected'],STATUS_COLORS.picked,'#ffffff'],'circle-stroke-color':STATUS_COLORS.saved,'circle-stroke-width':['interpolate',['linear'],['zoom'],3,0.6,10,1.5,14,2]}});
 m.addLayer({id:'dk-city-status',type:'circle',source:'dk-points',filter:['==',['get','place'],false],paint:{'circle-radius':4,'circle-color':['get','statusColor'],'circle-stroke-color':['case',['get','viewed'],'#263b59','#ffffff'],'circle-stroke-width':['case',['get','viewed'],2,1.5]}});
 m.addLayer({id:'dk-city-labels',type:'symbol',source:'dk-points',filter:['==',['get','place'],false],layout:{'symbol-sort-key':['case',['get','planned'],0,1],'text-field':['step',['zoom'],['get','city'],5,['get','label']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],3,11,7,14],'text-padding':2,'text-variable-anchor':['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'],'text-radial-offset':0.8,'text-justify':'auto'},paint:{'text-color':'#263b59','text-halo-color':'#ffffff','text-halo-width':3}});
 m.addLayer({id:'dk-labels',type:'symbol',source:'dk-points',filter:['==',['get','place'],true],minzoom:8,layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':13,'text-variable-anchor':['top','bottom','left','right'],'text-radial-offset':0.8,'text-justify':'auto'},paint:{'text-color':'#263b59','text-halo-color':'#ffffff','text-halo-width':2}});
 // Place saved-city labels before lower-priority map and individual-place text.
 m.moveLayer('dk-city-labels');
 m.on('click','dk-dots',e=>{const p=e.features?.[0]?.properties;if(!p)return;if(p.place){const found=callbacks.current.places.find(x=>x.id===p.id);if(found)callbacks.current.onPlace?.(found)}else callbacks.current.onCity?.(p.city)});
 m.on('click','dk-city-labels',e=>{const c=e.features?.[0]?.properties?.city;if(c)callbacks.current.onCity?.(c)});
 m.on('click','dk-city-status',e=>{const c=e.features?.[0]?.properties?.city;if(c)callbacks.current.onCity?.(c)});
 const statusPopup=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:12});
 for(const layer of ['dk-city-status','dk-city-labels']){
  m.on('mousemove',layer,e=>{const feature=e.features?.[0];if(feature?.geometry.type!=='Point')return;statusPopup.setLngLat(feature.geometry.coordinates as [number,number]).setText(`${feature.properties.city}. ${feature.properties.detail}`).addTo(m)});
  m.on('mouseleave',layer,()=>statusPopup.remove());
  m.on('click',layer,()=>statusPopup.remove());
 }
 m.on('click','dk-labels',e=>{const id=e.features?.[0]?.properties?.id;const p=callbacks.current.places.find(p=>p.id===id);if(p)callbacks.current.onPlace?.(p)});
 for(const layer of ['dk-dots','dk-labels','dk-city-labels','dk-city-status']){m.on('mouseenter',layer,()=>m.getCanvas().style.cursor='pointer');m.on('mouseleave',layer,()=>m.getCanvas().style.cursor='')};setReady(true)});
 m.on('error',()=>{if(live&&!m.isStyleLoaded())setFailed(true)});
 const resize=new ResizeObserver(()=>m.resize());resize.observe(host.current);return()=>{live=false;resize.disconnect();setReady(false);m.remove();map.current=null}},[]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;const plannedCities=new Set(routeStops.map(stop=>stop.city));
 const groups=[...new Set([...places.map(p=>p.city),...plannedCities])].filter(c=>cityMapCenter(c,places));
 const pointFeatures:any[]=[],areas:any[]=[]; for(const c of groups){const ps=places.filter(p=>p.city===c),chosen=ps.filter(p=>selected.has(p.id)).length,[x,y]=cityMapCenter(c,places)!;const summary=cityStatuses[c];const status=summary?.status??(plannedCities.has(c)||chosen>0?'picked':'saved');const statusColor=STATUS_COLORS[status];const active=status!=='saved';
 const perimeter=cityAreaPerimeter(c,ps.flatMap(p=>p.longitude!=null&&p.latitude!=null?[[p.longitude,p.latitude] as [number,number]]:[]),[x,y]);
 if(ps.length)areas.push({type:'Feature',properties:{active,statusColor},geometry:{type:'Polygon',coordinates:[perimeter]}});
 pointFeatures.push({type:'Feature',properties:{city:c,place:false,selected:active,planned:plannedCities.has(c),statusColor,viewed:c===city,detail:summary?`Accommodation: ${summary.label}. ${summary.detail}`:chosen?`${chosen} picked places`:'Saved ideas',label:ps.length?`${c}\n${ps.length} saved`:c},geometry:{type:'Point',coordinates:[x,y]}});
 }
 // Known places remain visible across cities; changing city only changes the camera.
 for(const p of places){if(p.longitude==null||p.latitude==null)continue;pointFeatures.push({type:'Feature',properties:{id:p.id,city:p.city,place:true,selected:selected.has(p.id),label:p.name},geometry:{type:'Point',coordinates:[p.longitude,p.latitude]}})}
 (m.getSource('dk-points') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:pointFeatures});(m.getSource('dk-areas') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:areas});
 },[ready,places,selected,city,routeStops,cityStatuses]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;
 (m.getSource('dk-route') as maplibregl.GeoJSONSource).setData(cityRouteFeatures(routeStops,places));
 },[ready,places,routeStops]);
 useEffect(()=>{if(!ready||!map.current)return;const center=city?cityMapCenter(city,callbacks.current.places):undefined;map.current.easeTo({center:center??[137.5,35.8],zoom:center?9.2:5.8,duration:400})},[city,ready]);
 useEffect(()=>{const m=map.current;if(!m||!ready||!palette)return;
 const tones={journey:{land:'#f7f5ef',water:'#b8dce3',accent:'#cb5745'},stone:{land:'#eeeae3',water:'#c8d1cc',accent:'#80624c'},sage:{land:'#e9ede3',water:'#bdcfc7',accent:'#557052'},sand:{land:'#f2e7d5',water:'#cad6ca',accent:'#a05a37'},original:{land:'#fafafa',water:'#cdd0d2',accent:'#2463eb'}};
 const tone=tones[palette];
 const paint=(id:string,key:string,value:unknown)=>{const cacheKey=id+'/'+key;if(!originalPaint.current.has(cacheKey))originalPaint.current.set(cacheKey,m.getPaintProperty(id,key)??null);m.setPaintProperty(id,key,palette==='original'?originalPaint.current.get(cacheKey):value)};
 for(const layer of m.getStyle().layers){if(layer.type==='background')paint(layer.id,'background-color',tone.land);else if(layer.type==='fill'&&'source-layer' in layer&&layer['source-layer']==='water')paint(layer.id,'fill-color',tone.water);else if(palette==='journey'&&layer.type==='fill'&&'source-layer' in layer&&layer['source-layer']==='park')paint(layer.id,'fill-color','#d4e4c3')}

 },[ready,palette]);
 const unresolvedCities=unresolvedRouteCities(routeStops,places);
 const shown=places.filter(p=>!city||p.city===city),unknown=shown.filter(p=>p.latitude==null||p.longitude==null).length;
 return <div className={'dk-map '+className}><div ref={host} className="dk-map-canvas"/>{!!unresolvedCities.length&&<p className="dk-route-warning" role="status">Route incomplete: cannot locate {unresolvedCities.join(", ")}. Edit these stays to use one mapped city or city area.</p>}{failed&&!ready&&<div className="dk-map-error">Map unavailable. You can still browse and select places.</div>}{showInformation&&<details className="dk-map-key"><summary><span className="dk-key-dot"/>Map information</summary><p>Dashed shapes are illustrative planning areas, not city boundaries. Their geographic size stays fixed as you zoom.</p><p>{unknown} places in this view still need exact coordinates. City counts include them.</p>{(route||routeStops.length>1)&&<p>Arrows show planned city order. Curves are illustrative, not transport paths.</p>}</details>}{!showInformation&&<details className="dk-map-key dk-status-key"><summary>Map key</summary><ul>{([['saved','Saved idea'],['picked','Picked / not booked'],['partial','Partly booked'],['booked','Booked']] as const).map(([status,label])=><li key={status}><span style={{background:STATUS_COLORS[status]}} aria-hidden="true"/>{label}</li>)}</ul><p>City booking status covers accommodation across all stays.</p><p>Blue arrows show city order, not transport paths.</p></details>}</div>
}
