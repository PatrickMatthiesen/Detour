import {useEffect,useMemo,useRef,useState} from "react";
import {Hotel,Ticket,Plus,X} from "lucide-react";
import type {Booking,TripSnapshot} from "../types";
import {daySummary,datesForTrip} from "./planning";
import {shortDate} from "../mockups/design-kit";
import "./BookingsPanel.css";
type Props={snapshot:TripSnapshot;onClose:()=>void;onEdit:(booking:Booking)=>void;onAdd:(date?:string,city?:string)=>void};
export default function BookingsPanel({snapshot,onClose,onEdit,onAdd}:Props){
 const dialog=useRef<HTMLDialogElement>(null);
 const [filter,setFilter]=useState("all");
 useEffect(()=>{dialog.current?.showModal()},[]);
 const gaps=useMemo(()=>{
  const dates=datesForTrip(snapshot).filter(d=>d>=(snapshot.trip.arrival?.date||snapshot.trip.startDate)&&d<(snapshot.trip.departure?.date||snapshot.trip.endDate));
  return dates.filter(d=>!daySummary(snapshot,d).accommodationCovered).map(date=>({date,city:snapshot.stays.find(s=>s.checkIn<=date&&date<s.checkOut)?.city||"City unassigned"}));
 },[snapshot]);
 const bookings=[...snapshot.bookings].filter(b=>filter==="all"||filter==="hotel"&&b.kind==="hotel"||filter==="confirmed"&&b.status==="confirmed").sort((a,b)=>(a.checkIn||a.start||a.date||"9999").localeCompare(b.checkIn||b.start||b.date||"9999"));
 const when=(b:Booking)=>{
  if(b.checkIn)return `${shortDate(b.checkIn)}${b.checkOut ? ` – ${shortDate(b.checkOut)}`:""}`;
  const value=b.start||b.date;
  if(!value)return "Date not set";
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return shortDate(value);
  const instant=Date.parse(value);if(!Number.isFinite(instant))return value;
  return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:snapshot.trip.timeZone||"Asia/Tokyo"}).format(new Date(instant));
 };
 return <dialog ref={dialog} className="booking-overview" aria-labelledby="booking-overview-title" onCancel={onClose}>
  <header><h2 id="booking-overview-title">Bookings</h2><button aria-label="Close bookings" onClick={onClose}><X size={19}/></button></header>
  <div className="booking-overview-body">
   <div className="booking-overview-tools"><div aria-label="Booking filters">{[["all","All"],["hotel","Accommodation"],["confirmed","Confirmed"]].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div><button onClick={()=>onAdd()}><Plus size={15}/> Add booking</button></div>
   <p className="booking-zone">Times in {snapshot.trip.timeZone || "Asia/Tokyo"}</p><div className="booking-overview-list">{bookings.map(b=><button key={b.id} className="booking-overview-row" onClick={()=>onEdit(b)}><span aria-hidden="true">{b.kind==="hotel"?<Hotel size={18}/>:<Ticket size={18}/>}</span><span><strong>{b.title}</strong><small>{when(b)}{b.location ? ` · ${b.location}`:""}</small></span><span className={`booking-status booking-status-${b.status}`}>{b.status}</span></button>)}{!bookings.length&&<p>No bookings in this view.</p>}</div>
   <details className="booking-gaps"><summary>{gaps.length ? `${gaps.length} nights need confirmed accommodation` : "Accommodation covers every trip night"}</summary>{!!gaps.length&&<div>{gaps.map(g=><div key={g.date}><span><strong>{shortDate(g.date)}</strong> {g.city}</span><button onClick={()=>onAdd(g.date,g.city==="City unassigned"?"":g.city)}>Add accommodation</button></div>)}</div>}</details>
  </div>
 </dialog>;
}
