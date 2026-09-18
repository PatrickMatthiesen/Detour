export function shortDate(date:string){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date.slice(0,10)+'T12:00:00Z'))}
