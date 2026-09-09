import {useEffect,useRef} from "react";
import {X,Plus,TrainFront} from "lucide-react";
import type {TravelLeg} from "../types";
import {shortDate} from "../mockups/design-kit";
import "./BookingsPanel.css";
export default function JourneysPanel({legs,onEdit,onAdd,onClose}:{legs:TravelLeg[];onEdit:(leg:TravelLeg)=>void;onAdd:()=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{dialog.current?.showModal()},[]);
 return <dialog ref={dialog} className="booking-overview" aria-labelledby="journeys-title" onCancel={onClose}><header><h2 id="journeys-title">Journeys</h2><button aria-label="Close journeys" onClick={onClose}><X size={19}/></button></header><div className="booking-overview-body"><div className="booking-overview-tools"><button onClick={onAdd}><Plus size={15}/> Add journey</button></div>{[...legs].sort((a,b)=>a.date.localeCompare(b.date)).map(leg=><button className="booking-overview-row" key={leg.id} onClick={()=>onEdit(leg)}><TrainFront size={18}/><span><strong>{leg.from} → {leg.to}</strong><small>{shortDate(leg.date)} · {leg.mode||"Transport not set"} · {leg.durationMinutes ? `${leg.durationMinutes} min` : "Duration unknown"}{leg.estimated ? " · estimated" : ""}</small></span></button>)}{!legs.length&&<p>No journeys planned yet.</p>}</div></dialog>
}
