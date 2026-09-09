import { Bell, Check, ListChecks, Luggage, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Task, TripSnapshot } from '../types';
import PackingView from './PackingView';
import { taskGroup, taskStatus } from './checklist';
import './PreparePage.css';

type Props = {snapshot: TripSnapshot; update: (fn:(s:TripSnapshot)=>TripSnapshot)=>void};
const dateLabel = (value: string) => new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
export default function PreparePage({snapshot,update}:Props) {
  const [view,setView] = useState<'checklist'|'packing'>('checklist');
  const [filter,setFilter] = useState('open');
  const [editing,setEditing] = useState<Task|null>(null);
  const [now,setNow] = useState(()=>new Date());
  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(id)},[]);
  const completed=snapshot.tasks.filter(t=>t.completed).length;
  const attention=snapshot.tasks.filter(t=>['overdue','today','reminder'].includes(taskStatus(t,now))).length;
  const visible=snapshot.tasks.filter(t=>filter==='all'||filter==='open'&&!t.completed||filter==='attention'&&['overdue','today','reminder'].includes(taskStatus(t,now)));
  const save=(task:Task)=>{update(s=>({...s,tasks:s.tasks.some(t=>t.id===task.id)?s.tasks.map(t=>t.id===task.id?task:t):[...s.tasks,task]}));setEditing(null)};
  return <main className="prepare-page">
    <div className="prepare-heading"><h1>Prepare</h1><nav aria-label="Preparation views"><button aria-pressed={view==='checklist'} onClick={()=>setView('checklist')}><ListChecks size={18}/>Checklist</button><button aria-pressed={view==='packing'} onClick={()=>setView('packing')}><Luggage size={18}/>Packing</button></nav></div>
    {view==='packing'?<PackingView snapshot={snapshot} update={update}/>:<>
      <div className="prepare-toolbar"><div className="prepare-filters" aria-label="Checklist filters">{[['open','To do'],['attention',`Due & reminders${attention?` · ${attention}`:''}`],['all','All']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div><span className="prepare-progress">{completed} of {snapshot.tasks.length} done</span></div>
      <div className="prepare-checklist">{(['before','during'] as const).map(group=>{
        const tasks=visible.filter(t=>taskGroup(t,snapshot.trip.startDate)===group).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
        return <section key={group}><div className="prepare-section-heading"><h2>{group==='before'?'Before departure':'During the trip'}</h2><button className="prepare-section-add" aria-label={group==='before'?'Add task before departure':'Add task during the trip'} onClick={()=>setEditing({id:crypto.randomUUID(),title:'',scope:group,completed:false})}><Plus size={16}/>Add task</button></div>{tasks.length?tasks.map(task=>{const status=taskStatus(task,now);return <div key={task.id} className={`prepare-task ${task.completed?'is-done':''}`}>
          <input type="checkbox" checked={task.completed} aria-label={`Complete ${task.title}`} onChange={()=>update(s=>({...s,tasks:s.tasks.map(t=>t.id===task.id?{...t,completed:!t.completed}:t)}))}/>
          <button className="prepare-task-title" onClick={()=>setEditing(task)}>{task.title}</button>
          <span className={`prepare-task-status status-${status}`}>{status==='done'?<Check size={15}/>:status==='reminder'?<><Bell size={14}/>Reminder</>:status==='overdue'?`Overdue · ${dateLabel(task.dueDate!)}`:status==='today'?'Due today':task.dueDate?dateLabel(task.dueDate):null}</span>
          {task.reminderAt && status!=='reminder' && !task.completed && <Bell size={14} aria-label="Reminder set"/>}
        </div>}):<p className="prepare-empty">{filter==='attention'?'Nothing due right now.':filter==='open'&&snapshot.tasks.some(t=>taskGroup(t,snapshot.trip.startDate)===group)?'All done here.':'No tasks yet.'}</p>}</section>})}</div>
      <p className="prepare-reminder-note"><Bell size={14}/>Reminders appear here while you use Detour. Dates and reminder times use your device’s time zone.</p>
    </>}
    {editing&&<TaskEditor task={editing} departure={snapshot.trip.startDate} existing={snapshot.tasks.some(t=>t.id===editing.id)} close={()=>setEditing(null)} save={save} remove={()=>{update(s=>({...s,tasks:s.tasks.filter(t=>t.id!==editing.id)}));setEditing(null)}}/>}
  </main>;
}
function TaskEditor({task,departure,existing,close,save,remove}:{task:Task;departure:string;existing:boolean;close:()=>void;save:(t:Task)=>void;remove:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [title,setTitle]=useState(task.title);
  const [scope,setScope]=useState(taskGroup(task,departure));
  const [due,setDue]=useState(task.dueDate?.slice(0,10)||'');
  const initialReminder=()=>{if(!task.reminderAt)return '';const d=new Date(task.reminderAt);if(Number.isNaN(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
  const [reminder,setReminder]=useState(initialReminder);
  const [reminderEdited,setReminderEdited]=useState(false);
  const [confirm,setConfirm]=useState(false);
  useEffect(()=>{ref.current?.showModal()},[]);
  return <dialog ref={ref} className="prepare-editor" onCancel={close} onClose={close}><form onSubmit={e=>{e.preventDefault();if(title.trim())save({...task,title:title.trim(),scope:scope===taskGroup(task,departure)?task.scope:scope,dueDate:due||null,reminderAt:reminderEdited?(reminder?new Date(reminder).toISOString():null):task.reminderAt})}}>
    <header><h2>{existing?'Edit task':'Add task'}</h2><button type="button" aria-label="Close task" onClick={close}><X size={20}/></button></header>
    <div className="prepare-editor-fields"><label>Task<input required autoFocus value={title} onChange={e=>setTitle(e.target.value)}/></label><div className="prepare-editor-grid"><label>When<select value={scope} onChange={e=>setScope(e.target.value as 'before'|'during')}><option value="before">Before departure</option><option value="during">During the trip</option></select></label><label>Due date<input type="date" value={due} onInput={e=>setDue(e.currentTarget.value)}/></label></div><label>Remind me <input type="datetime-local" value={reminder} onInput={e=>{setReminder(e.currentTarget.value);setReminderEdited(true)}}/></label><small>Optional · shown in Detour, in your device’s time zone.</small></div>
    <footer>{existing&&<button type="button" className="prepare-delete" onClick={()=>confirm?remove():setConfirm(true)}>{confirm?'Confirm delete':'Delete task'}</button>}<button type="button" onClick={close}>Cancel</button><button className="prepare-add" type="submit">Save task</button></footer>
  </form></dialog>;
}
