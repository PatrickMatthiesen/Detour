import {useEffect,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import {Camera,Compass} from 'lucide-react';
import {getTrip} from '../api';
import type {Place,TripSnapshot} from '../types';
import photosJson from './design-photos.json';
import './design-kit.css';
import 'maplibre-gl/dist/maplibre-gl.css';
type Photo={url?:string;title?:string;source?:string;fileSource?:string;lat?:number|null;lon?:number|null};
const photos=photosJson as Record<string,Photo|null>;
export const designNames=['Photo explorer','City chapters','Interest board','Route planner','Map explorer','Day composer'];
const featured=['Gotokuji Temple','Ghibli Museum, Mitaka','Ginza Itoya','Melon Pan 802 Hachioji','Menya Musashi — Tokyo locations','Koenji — thrift and vintage neighbourhood','Pixel Lab Tokyo — Game Boy Mod Workshop','Nakano — anime, watches and nightlife'];
export function displayPlaces(input:Place[]){const rank=(p:Place)=>{const i=featured.indexOf(p.name);return i<0?100:i}; return [...input].sort((a,b)=>rank(a)-rank(b)).map(p=>{const key=p.name==='Gotokuji Temple'?'Gōtoku-ji':p.name==='Ghibli Museum, Mitaka'?'Ghibli Museum':null;const ph=key?photos[key]:null;return p.latitude==null&&p.longitude==null&&ph?.lat&&ph.lon?{...p,latitude:ph.lat,longitude:ph.lon}:p})}
export function useDesignTrip(){
 const [trip,setTrip]=useState<TripSnapshot|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Set<string>>(new Set());
 useEffect(()=>{let alive=true;getTrip().then(t=>{if(!alive)return; const places=displayPlaces(t.places);setTrip({...t,places});setSelected(new Set(t.places.filter(p=>p.selected).map(p=>p.id)))}).catch(e=>alive&&setError(String(e)));return()=>{alive=false}},[]);
 const toggle=(id:string)=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next});
 return {trip,selected,toggle,loading:!trip&&!error,error};
}
export function cityPlaces(trip:TripSnapshot|null,city:string){return trip?.places.filter(p=>!city||city==='All'||city==='All cities'||p.city===city)??[]}
export function shortDate(date:string){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date.slice(0,10)+'T12:00:00Z'))}
export function PreviewNav({active}:{active:number}){return <header className="dk-nav"><a href="/" className="dk-trip"><Compass size={19}/><strong>Japan 2026</strong><span>30 Sep – 25 Oct</span></a><nav aria-label="Design alternatives">{designNames.map((n,i)=><a key={n} href={'/'+(i+4)} className={active===i+4?'dk-active':''} title={n}>{i+4}<span>{n}</span></a>)}</nav><span className="dk-preview" title="Your saved trip is unchanged. Reload to reset this preview.">Preview only</span></header>}
function photoFor(p:Place):{photo:Photo|null;caption:string}{
 const n=p.name.toLowerCase();let key='',caption='';
 if(n.includes('gotokuji')) key='Gōtoku-ji';else if(n.includes('ghibli museum'))key='Ghibli Museum';
 else if(n.includes('melon')){key='Melonpan';caption='Melonpan · food reference'}
 else if(n.includes('menya musashi')||n.includes('ramen')||n.includes('noodle')){key='Tsukemen';caption='Tsukemen · food reference'}
 else if(n.includes('koenji')){key='Kōenji';caption='Around Kōenji'}
 else if(n.includes('nakano')){key='Nakano Broadway';caption='Around Nakano Broadway'}
 else if(n.includes('ginza')||p.area?.includes('Ginza')){key='Ginza';caption='Ginza neighbourhood'}
 else if(n.includes('pixel')||p.area?.includes('Akihabara')){key='Akihabara';caption='Akihabara neighbourhood'}
 else if(photos[p.city]?.url){key=p.city;caption=p.city+' · area photo'}
 return {photo:photos[key]??null,caption};
}
export function PlacePhoto({place,className=''}:{place:Place;className?:string}){const {photo,caption}=photoFor(place);return <figure className={'dk-photo '+className}>{photo?.url?<><img src={photo.url} alt={caption||place.name} loading="lazy"/><a href={photo.fileSource||photo.source} target="_blank" rel="noreferrer" className="dk-credit" title={'Photo source: '+photo.title} onClick={e=>e.stopPropagation()}>Photo credit</a>{caption&&<figcaption>{caption}</figcaption>}</>:<div className="dk-no-photo"><Camera size={24}/><span>{place.category?.split(',')[0]||'Saved place'}</span><small>Photo not added</small></div>}</figure>}
const centers:Record<string,[number,number]>={Tokyo:[139.7,35.68],Kyoto:[135.768,35.012],Osaka:[135.502,34.694],Nagoya:[136.907,35.181],Hakone:[139.025,35.232],Yokohama:[139.638,35.444],Nagano:[138.181,36.648],Fukui:[136.222,36.064],Gifu:[136.76,35.423],Hiroshima:[132.455,34.385],Kurashiki:[133.77,34.585],Onomichi:[133.205,34.408],'Kinosaki Onsen':[134.812,35.624]};
const empty:any={type:'FeatureCollection',features:[]};
export function DesignMap({places,selected,city,onCity,onPlace,className='',route=false,palette,showInformation=true}:{places:Place[];selected:Set<string>;city?:string;onCity?:(city:string)=>void;onPlace?:(place:Place)=>void;className?:string;route?:boolean;showInformation?:boolean;palette?:'stone'|'sage'|'sand'|'original'|'journey'}){
 const originalPaint=useRef(new Map<string,unknown>());
 const host=useRef<HTMLDivElement>(null),map=useRef<maplibregl.Map|null>(null),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);const callbacks=useRef({onCity,onPlace,places});callbacks.current={onCity,onPlace,places};
 useEffect(()=>{if(!host.current)return;const m=new maplibregl.Map({container:host.current,style:'https://tiles.openfreemap.org/styles/positron',center:[137.5,35.8],zoom:5.8,attributionControl:{compact:true}});map.current=m;let live=true;
 m.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
 m.on('load',()=>{if(!live)return; for(const id of ['areas','points','route'])m.addSource('dk-'+id,{type:'geojson',data:empty});
 m.addLayer({id:'dk-area-fill',type:'fill',source:'dk-areas',paint:{'fill-color':['case',['get','active'],'#427de5','#94a3b8'],'fill-opacity':['case',['get','active'],0.10,0.03]}});
 m.addLayer({id:'dk-area-edge',type:'line',source:'dk-areas',paint:{'line-color':['case',['get','active'],'#427de5','#97a5b7'],'line-width':1.5,'line-dasharray':[3,3]}});
 m.addLayer({id:'dk-route-line',type:'line',source:'dk-route',paint:{'line-color':'#5875ad','line-width':2,'line-dasharray':[3,3]}});
 m.addLayer({id:'dk-dots',type:'circle',source:'dk-points',filter:['==',['get','place'],true],paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.5,6,2.5,10,4.5,14,7],'circle-color':['case',['get','selected'],'#2463eb','#ffffff'],'circle-stroke-color':'#47648c','circle-stroke-width':['interpolate',['linear'],['zoom'],3,0.6,10,1.5,14,2]}});
 m.addLayer({id:'dk-city-labels',type:'symbol',source:'dk-points',filter:['==',['get','place'],false],layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':14,'text-padding':10,'text-justify':'center'},paint:{'text-color':['case',['get','selected'],'#225dcc','#263b59'],'text-halo-color':'#ffffff','text-halo-width':3}});
 m.addLayer({id:'dk-labels',type:'symbol',source:'dk-points',filter:['==',['get','place'],true],minzoom:8,layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':13,'text-variable-anchor':['top','bottom','left','right'],'text-radial-offset':0.8,'text-justify':'auto'},paint:{'text-color':'#263b59','text-halo-color':'#ffffff','text-halo-width':2}});
 m.on('click','dk-dots',e=>{const p=e.features?.[0]?.properties;if(!p)return;if(p.place){const found=callbacks.current.places.find(x=>x.id===p.id);if(found)callbacks.current.onPlace?.(found)}else callbacks.current.onCity?.(p.city)});
 m.on('click','dk-city-labels',e=>{const c=e.features?.[0]?.properties?.city;if(c)callbacks.current.onCity?.(c)});
 m.on('click','dk-labels',e=>{const id=e.features?.[0]?.properties?.id;const p=callbacks.current.places.find(p=>p.id===id);if(p)callbacks.current.onPlace?.(p)});
 for(const layer of ['dk-dots','dk-labels','dk-city-labels']){m.on('mouseenter',layer,()=>m.getCanvas().style.cursor='pointer');m.on('mouseleave',layer,()=>m.getCanvas().style.cursor='')};setReady(true)});
 m.on('error',()=>{if(live&&!m.isStyleLoaded())setFailed(true)});
 const resize=new ResizeObserver(()=>m.resize());resize.observe(host.current);return()=>{live=false;resize.disconnect();setReady(false);m.remove();map.current=null}},[]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;const groups=[...new Set(places.map(p=>p.city))].filter(c=>centers[c]);if(city&&centers[city]&&!groups.includes(city))groups.push(city);
 const pointFeatures:any[]=[],areas:any[]=[]; for(const c of groups){const ps=places.filter(p=>p.city===c),chosen=ps.filter(p=>selected.has(p.id)).length,[x,y]=centers[c];const active=chosen>0;const dx=c==='Tokyo'?.23:.10,dy=c==='Tokyo'?.13:.08;
 const perimeter=Array.from({length:49},(_,i)=>{const a=i/48*Math.PI*2;return [x+dx*Math.cos(a),y+dy*Math.sin(a)]});
 areas.push({type:'Feature',properties:{active},geometry:{type:'Polygon',coordinates:[perimeter]}});
 pointFeatures.push({type:'Feature',properties:{city:c,place:false,selected:active,label:`${c}\n${ps.length} saved`},geometry:{type:'Point',coordinates:[x,y]}});
 }
 // Known places remain visible across cities; changing city only changes the camera.
 for(const p of places){if(p.longitude==null||p.latitude==null)continue;pointFeatures.push({type:'Feature',properties:{id:p.id,city:p.city,place:true,selected:selected.has(p.id),label:p.name},geometry:{type:'Point',coordinates:[p.longitude,p.latitude]}})}
 (m.getSource('dk-points') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:pointFeatures});(m.getSource('dk-areas') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:areas});
 // Saved-place grouping is not a travel sequence. Never draw a route from its order.
 (m.getSource('dk-route') as maplibregl.GeoJSONSource).setData(empty);
 },[ready,places,selected,city,route]);
 useEffect(()=>{if(!ready||!map.current)return;map.current.easeTo({center:city&&centers[city]?centers[city]:[137.5,35.8],zoom:city&&centers[city]?9.2:5.8,duration:400})},[city,ready]);
 useEffect(()=>{const m=map.current;if(!m||!ready||!palette)return;
 const tones={journey:{land:'#f7f5ef',water:'#b8dce3',accent:'#cb5745'},stone:{land:'#eeeae3',water:'#c8d1cc',accent:'#80624c'},sage:{land:'#e9ede3',water:'#bdcfc7',accent:'#557052'},sand:{land:'#f2e7d5',water:'#cad6ca',accent:'#a05a37'},original:{land:'#fafafa',water:'#cdd0d2',accent:'#2463eb'}};
 const tone=tones[palette];
 const paint=(id:string,key:string,value:unknown)=>{const cacheKey=id+'/'+key;if(!originalPaint.current.has(cacheKey))originalPaint.current.set(cacheKey,m.getPaintProperty(id,key)??null);m.setPaintProperty(id,key,palette==='original'?originalPaint.current.get(cacheKey):value)};
 for(const layer of m.getStyle().layers){if(layer.type==='background')paint(layer.id,'background-color',tone.land);else if(layer.type==='fill'&&'source-layer' in layer&&layer['source-layer']==='water')paint(layer.id,'fill-color',tone.water);else if(palette==='journey'&&layer.type==='fill'&&'source-layer' in layer&&layer['source-layer']==='park')paint(layer.id,'fill-color','#d4e4c3')}
 paint('dk-area-fill','fill-color',['case',['get','active'],tone.accent,'#94a3b8']);paint('dk-area-edge','line-color',['case',['get','active'],tone.accent,'#97a5b7']);paint('dk-dots','circle-color',['case',['get','selected'],tone.accent,'#ffffff']);paint('dk-city-labels','text-color',['case',['get','selected'],tone.accent,'#263b59']);
 },[ready,palette]);
 const shown=places.filter(p=>!city||p.city===city),unknown=shown.filter(p=>p.latitude==null||p.longitude==null).length;
 return <div className={'dk-map '+className}><div ref={host} className="dk-map-canvas"/>{failed&&!ready&&<div className="dk-map-error">Map unavailable. You can still browse and select places.</div>}{showInformation&&<details className="dk-map-key"><summary><span className="dk-key-dot"/>Map information</summary><p>Dashed shapes are illustrative planning areas, not city boundaries. Their geographic size stays fixed as you zoom.</p><p>{unknown} places in this view still need exact coordinates. City counts include them.</p>{route&&<p>Connection lines illustrate city order, not transport paths or travel estimates.</p>}</details>}</div>
}
