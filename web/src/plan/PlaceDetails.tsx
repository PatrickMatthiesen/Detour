import {useEffect,useRef,useState} from "react";
import {X,Plus,Check,ExternalLink,Camera} from "lucide-react";
import type {Place} from "../types";
import {photoFor,PlacePhoto} from "../mockups/design-kit";
import "./PlaceDetails.css";

// Only lift explicitly labelled paragraphs; keep all other source prose intact.
function detailContent(place:Place) {
 const fields = new Map<string,string[]>();
 const notes:string[]=[];
 for(const paragraph of (place.notes||"").split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean)) {
  const match=/^(Best time|Estimated duration|Reservation|Needs research|Location):\s*([\s\S]+)$/i.exec(paragraph);
  if(!match){notes.push(paragraph);continue;}
  const key=match[1].toLowerCase();
  fields.set(key,[...(fields.get(key)||[]),match[2].trim()]);
 }
 const value=(key:string)=>fields.get(key)?.join("; ");
 const combine=(...values:(string|null|undefined)[])=>[...new Set(values.filter((v):v is string=>!!v?.trim()).map(v=>v.trim()))].join(" · ");
 const estimate=place.durationText||value("estimated duration");
 const facts:[string,string][]=[];
 const duration=combine(estimate,place.durationMinutes ? `${place.durationMinutes} min in plan` : null);
 if(duration)facts.push(["Visit",duration]);
 const reservation=place.reservation||value("reservation");
 if(reservation)facts.push(["Reservations",reservation]);
 if(place.openingHours)facts.push(["Opening hours",place.openingHours]);
 if(place.priority)facts.push(["Priority",{required:"Must visit",high:"High",nice:"Nice to visit",none:"None"}[place.priority]]);
 if(place.status)facts.push(["Status",place.status]);
 if(place.selected!=null)facts.push(["Chosen for trip",place.selected?"Yes":"No"]);
 if(place.latitude!=null||place.longitude!=null)facts.push(["Coordinates",`Latitude: ${place.latitude??"Unknown"}; longitude: ${place.longitude??"Unknown"}`]);
 if(value("best time"))facts.push(["When to go",value("best time")!]);
 const location=value("location");
 if(location && location!==place.name)facts.push(["Location",location]);
 const research=value("needs research");
 const needsResearch=place.needsResearch??/^(yes|true)$/i.test(research||"");
 if(research&&!/^(yes|true|no|false)$/i.test(research))notes.push(`Needs research: ${research}`);
 return {facts,notes,needsResearch};
}

function PhotoViewer({place,onClose}:{place:Place;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const {photo,caption,credit,sourceUrl}=photoFor(place);
 const [failedUrl,setFailedUrl]=useState<string|null>(null);
 const failed=Boolean(photo?.url&&failedUrl===photo.url);
 useEffect(()=>{dialog.current?.showModal()},[]);
 return <dialog ref={dialog} className="place-photo-viewer" aria-label={`Photo of ${place.name}`} onCancel={e=>{e.stopPropagation();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <button type="button" className="photo-viewer-close" aria-label="Close photo" onClick={onClose}><X size={22}/></button>
  {photo&&!failed?<img src={photo.url} alt={caption} onError={()=>setFailedUrl(photo.url)}/>:<div className="photo-viewer-fallback"><Camera size={32}/><span>Photo unavailable</span></div>}
  <div className="photo-viewer-caption"><span>{caption||place.name}</span>{sourceUrl?<a href={sourceUrl} target="_blank" rel="noreferrer">{credit} <ExternalLink size={13}/></a>:credit?<span>{credit}</span>:null}</div>
 </dialog>;
}

export interface PlaceDetailsProps {
 place:Place;
 scheduled?:boolean;
 onAdd?:()=>void;
 onEdit?:()=>void;
 onClose:()=>void;
 embedded?:boolean;
 onToggleTrip?:()=>void;
}

export default function PlaceDetails({place,scheduled=false,onAdd,onEdit,onClose,embedded=false,onToggleTrip}:PlaceDetailsProps){
 const dialog=useRef<HTMLDialogElement>(null);
 const [photoOpen,setPhotoOpen]=useState(false);
 useEffect(()=>{if(!embedded)dialog.current?.showModal()},[embedded]);
 const {facts,notes,needsResearch}=detailContent(place);
 const links=[["Source",place.sourceUrl],["Google Maps",place.googleMapsUrl],["Instagram",place.instagramUrl]].filter(([,url])=>{try{return !!url&&["http:","https:"].includes(new URL(url).protocol)}catch{return false}});
 const hasPhoto=!!photoFor(place).photo?.url;
 const content=<>
  <div className="place-details-body">
   {embedded && (place.latitude == null || place.longitude == null) && <p className="place-location-missing">This place does not have a map pin yet.</p>}
   <div className={`place-details-intro${hasPhoto ? " has-photo" : ""}`}>
    {hasPhoto&&<div className="place-photo-trigger"><PlacePhoto place={place} className="place-details-photo"/><button type="button" className="place-photo-open" aria-label={`Enlarge photo of ${place.name}`} onClick={()=>setPhotoOpen(true)}/></div>}
    <div>{place.description&&<p>{place.description}</p>}{needsResearch&&<span className="place-details-research">Needs checking</span>}</div>
   </div>
   {!!facts.length&&<dl className="place-details-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
   {!!notes.length&&<section className="place-details-notes"><h3>Planning notes</h3>{notes.map((note,index)=><p key={index}>{note}</p>)}</section>}
   {!!links.length&&<nav aria-label="Place sources">{links.map(([label,url])=><a key={label} href={url!} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>)}</nav>}
  </div>
  {photoOpen&&<PhotoViewer place={place} onClose={()=>setPhotoOpen(false)}/>}
 </>;
 if(embedded) return <section className="place-details place-details-embedded" aria-labelledby="place-details-title">
  <header>
   <button type="button" className="place-details-back" aria-label="Back to places" onClick={onClose}><span aria-hidden="true">←</span> Back to places</button>
   {onEdit&&<button type="button" className="place-details-edit" onClick={onEdit}>Edit place</button>}
  </header>
  <div className="place-details-embedded-heading"><h2 id="place-details-title">{place.name}</h2><p className="place-details-location">{[place.city,place.area,place.category].filter(Boolean).join(" · ")}</p></div>
  {content}
  {onToggleTrip&&<footer className="place-details-trip-actions">{place.selected?<><span className="place-details-trip-status"><Check size={16}/> Added to trip</span><button type="button" onClick={onToggleTrip}>Remove from trip</button></>:<button type="button" className="place-details-add" onClick={onToggleTrip}><Plus size={16}/> Add to trip</button>}</footer>}
 </section>;
 return <dialog ref={dialog} className="place-details" onCancel={e=>{e.stopPropagation();onClose()}} aria-labelledby="place-details-title">
  <header><div><h2 id="place-details-title">{place.name}</h2><p className="place-details-location">{[place.city,place.area,place.category].filter(Boolean).join(" · ")}</p></div><button aria-label="Close place details" onClick={onClose}><X size={20}/></button></header>
  {content}
  <footer><button onClick={onClose}>Close</button>{onEdit&&<button className="place-details-add" onClick={onEdit}>Edit place</button>}{onAdd&&<button className="place-details-add" disabled={scheduled} onClick={onAdd}>{scheduled?<Check size={16}/>:<Plus size={16}/>} {scheduled?"On this day":"Add to this day"}</button>}</footer>
 </dialog>;
}
