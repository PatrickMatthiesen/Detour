import {describe,it,expect} from "vitest";
import {validateBooking} from "./BookingEditor";
import type {Booking} from "../types";
const booking:Booking={id:"a",title:"Reservation",kind:"hotel",status:"confirmed",checkIn:"2026-10-02",checkOut:"2026-10-03"};
describe("booking validation",()=>{
 it("requires real hotel dates and at least one night",()=>{expect(validateBooking(booking)).toEqual([]);expect(validateBooking({...booking,checkOut:booking.checkIn})).toContain("Hotel check-out must be after check-in.");expect(validateBooking({...booking,checkIn:"2026-02-30"})).not.toEqual([])});
 it("compares instants rather than flight wall-clock times",()=>{expect(validateBooking({...booking,kind:"flight",start:"2026-10-02T12:00:00+09:00",end:"2026-10-02T07:00:00+02:00"})).toEqual([]);expect(validateBooking({...booking,kind:"flight",start:"2026-10-02T12:00:00+09:00",end:"2026-10-02T03:00:00+02:00"})).toContain("End must be at or after Start.")});
 it("rejects unsafe links and preserves custom kinds and statuses",()=>{expect(validateBooking({...booking,url:"javascript:alert(1)"})).not.toEqual([]);expect(validateBooking({...booking,kind:"event",status:"awaiting payment",url:"https://example.com/ticket"})).toEqual([])});
 it("rejects impossible times and accepts date-only tickets",()=>{expect(validateBooking({...booking,kind:"ticket",start:"2026-10-02T29:00+09:00"})).not.toEqual([]);expect(validateBooking({...booking,kind:"ticket",date:"2026-10-02"})).toEqual([])});
});
