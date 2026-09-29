import type {Place} from "../types";

// Curated ordering for the places grid, plus coordinates for two signature
// places whose saved records have no pin yet.
const featured=['Gotokuji Temple','Ghibli Museum, Mitaka','Ginza Itoya','Melon Pan 802 Hachioji','Menya Musashi — Tokyo locations','Koenji — thrift and vintage neighbourhood','Pixel Lab Tokyo — Game Boy Mod Workshop','Nakano — anime, watches and nightlife'];
const knownCoordinates:Record<string,{latitude:number;longitude:number}>={
 'Gotokuji Temple':{latitude:35.64877778,longitude:139.64741667},
 'Ghibli Museum, Mitaka':{latitude:35.69623333,longitude:139.57043056},
};
export function displayPlaces(input:Place[]){const rank=(p:Place)=>{const i=featured.indexOf(p.name);return i<0?100:i}; return [...input].sort((a,b)=>rank(a)-rank(b)).map(p=>{const coordinates=knownCoordinates[p.name];return p.latitude==null&&p.longitude==null&&coordinates?{...p,...coordinates}:p})}
