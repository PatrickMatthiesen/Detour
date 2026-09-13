import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { Stay, TripSnapshot } from "../types";
import { shortDate } from "../mockups/design-kit";
import { editStayRoute, reorderStayRoute, reviewStayRoute, shiftDate } from "./stay-editing";
import { centers, cityMapCenter } from "./city-location";
import "./StayEditor.css";

type Props = { snapshot: TripSnapshot; initialId?: string; onClose:()=>void; onSave:(stays:Stay[])=>void };
export default function StayEditor({snapshot,initialId,onClose,onSave}:Props) {
  const [base] = useState(snapshot);
  const ordered = useMemo(()=>[...base.stays].sort((a,b)=>a.checkIn.localeCompare(b.checkIn)),[base]);
  const [editing,setEditing] = useState<Stay|null>(()=>ordered.find(s=>s.id===initialId) || ordered[0] || null);
  const [shiftLater,setShiftLater] = useState(false);
  const [proposed,setProposed] = useState<Stay[]|null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const stale = JSON.stringify(base)!==JSON.stringify(snapshot);
  const review = useMemo(()=>proposed ? reviewStayRoute(base,proposed) : null,[base,proposed]);
  const cities = [...new Set([...Object.keys(centers),...base.places.map(p=>p.city),...ordered.map(s=>s.city)])].filter(city=>!!cityMapCenter(city,base.places)).sort();
  useEffect(()=>{dialog.current?.showModal();},[]);
  const choose = (stay:Stay)=>{setEditing({...stay});setShiftLater(false);setProposed(null);};
  const add = ()=>{
    const start = ordered.at(-1)?.checkOut || base.trip.arrival?.date || base.trip.startDate;
    choose({id:crypto.randomUUID(),city:"",checkIn:start<base.trip.endDate ? start : base.trip.startDate,checkOut:start<base.trip.endDate ? shiftDate(start,1) : shiftDate(base.trip.startDate,1),status:"planned"});
  };
  const existing = ordered.some(s=>s.id===editing?.id);
  const preview = ()=>{
    if (!editing || !form.current?.reportValidity()) return;
    setProposed(editStayRoute(ordered,{...editing,city:editing.city.trim()},shiftLater));
  };
  return <dialog ref={dialog} className="stay-editor" aria-labelledby="stay-editor-heading" onCancel={onClose}>
    <header><h2 id="stay-editor-heading">{proposed ? "Review route change" : "City stays"}</h2><button type="button" className="stay-icon" aria-label="Close stay editor" onClick={onClose}><X size={20}/></button></header>
    {stale && <p className="stay-error" role="alert">Your trip changed while this editor was open. Close and reopen it to use the latest plan.</p>}
    {review ? <div className="stay-review">
      <h3>Changes</h3><ul>{review.changes.map((text,i)=><li key={i}>{text}</li>)}</ul>
      {!review.changes.length && <p>No changes to save.</p>}
      {!!review.errors.length && <section className="stay-error" aria-label="Problems to fix"><h3>Fix these issues</h3><ul>{review.errors.map((text,i)=><li key={i}>{text}</li>)}</ul></section>}
      {!!review.warnings.length && <section className="stay-impact"><h3>Things to review</h3><ul>{review.warnings.map((text,i)=><li key={i}>{text}</li>)}</ul></section>}
      <p className="stay-help">Bookings, travel legs and activities keep their current dates. This saves the city stays only.</p>
    </div> : <div className="stay-editor-body">
      <aside aria-label="Route order"><div className="stay-route-list">{ordered.map((stay,index)=><div className={`stay-route-row${editing?.id===stay.id ? " is-active" : ""}`} key={stay.id}>
        <button className="stay-route-select" type="button" onClick={()=>choose(stay)}><strong>{stay.city}</strong><span>{shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}</span></button>
        <div className="stay-order-buttons"><button className="stay-icon" type="button" disabled={index===0} aria-label={`Move ${stay.city} ${shortDate(stay.checkIn)} earlier`} onClick={()=>setProposed(reorderStayRoute(ordered,stay.id,-1))}><ArrowUp size={15}/></button><button className="stay-icon" type="button" disabled={index===ordered.length-1} aria-label={`Move ${stay.city} ${shortDate(stay.checkIn)} later`} onClick={()=>setProposed(reorderStayRoute(ordered,stay.id,1))}><ArrowDown size={15}/></button></div>
      </div>)}</div><button className="stay-add" type="button" onClick={add}><Plus size={16}/> Add stay</button></aside>
      {editing ? <form ref={form} onSubmit={e=>{e.preventDefault();preview();}} className="stay-fields">
        <h3>{existing ? "Edit stay" : "New stay"}</h3>
        <label>City or city area<input required aria-describedby="stay-city-help" list="stay-city-options" value={editing.city} onChange={e=>setEditing({...editing,city:e.target.value})}/></label><datalist id="stay-city-options">{cities.map(city=><option key={city} value={city}/>)}</datalist>
        <p id="stay-city-help" className="stay-help">Choose one location for this stay. Put day trips and other destinations in the label or notes.</p>
        <div className="stay-dates"><label>Arrival<input required type="date" min={base.trip.startDate} max={base.trip.endDate} value={editing.checkIn} onInput={e=>setEditing({...editing,checkIn:e.currentTarget.value})}/></label><label>Departure<input required type="date" min={base.trip.startDate} max={base.trip.endDate} value={editing.checkOut} onInput={e=>setEditing({...editing,checkOut:e.currentTarget.value})}/></label></div>
        <label><span>Label <span className="stay-help">(optional)</span></span><input value={editing.name || ""} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
        {existing && <label className="stay-shift"><input type="checkbox" checked={shiftLater} onChange={e=>setShiftLater(e.target.checked)}/><span>Shift later stays by the departure-date change</span></label>}
        {existing && <button type="button" className="stay-remove" onClick={()=>setProposed(ordered.filter(s=>s.id!==editing.id))}>Remove this stay</button>}
        <p className="stay-help">Moving a stay earlier or later swaps it with its neighbour and keeps both stay lengths.</p>
      </form> : <p className="stay-help">Add a city to start planning your route.</p>}
    </div>}
    <footer><button type="button" onClick={()=>proposed ? setProposed(null) : onClose()}>{proposed ? "Back to editing" : "Cancel"}</button>{proposed ? <button type="button" className="stay-primary" disabled={stale || !!review?.errors.length || !review?.changes.length} onClick={()=>onSave(proposed)}>Save changes</button> : <button type="button" className="stay-primary" disabled={stale || !editing} onClick={preview}>Preview change</button>}</footer>
  </dialog>;
}
