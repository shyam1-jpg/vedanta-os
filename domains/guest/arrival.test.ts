import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrivalPolicy} from './arrival.ts';
const stay={status:'CONVERTED',booking_status:'CONFIRMED',arrival:'2026-10-15',departure:'2026-10-18'};
test('unconfirmed and cancelled bookings cannot register arrival',()=>{
  for(const booking_status of ['ENQUIRY','PROVISIONAL','CANCELLED','COMPLETED',null]) assert.equal(arrivalPolicy({...stay,booking_status},'2026-10-15',true).can_arrive,false);
  assert.equal(arrivalPolicy({...stay,status:'DECLINED'},'2026-10-15',true).can_confirm,false);
});
test('pre-arrival opens exactly fourteen days before',()=>{assert.equal(arrivalPolicy(stay,'2026-09-30',false).can_confirm,false);assert.equal(arrivalPolicy(stay,'2026-10-01',false).can_confirm,true);});
test('reviewing details does not allow an early arrival notification',()=>{assert.equal(arrivalPolicy(stay,'2026-10-14',true).can_arrive,false);});
test('arrival requires details and is allowed on arrival or late arrival days',()=>{assert.equal(arrivalPolicy(stay,'2026-10-15',false).can_arrive,false);assert.equal(arrivalPolicy(stay,'2026-10-15',true).can_arrive,true);assert.equal(arrivalPolicy(stay,'2026-10-16',true).can_arrive,true);});
test('overnight departure day and expired stays cannot register',()=>{for(const today of ['2026-10-18','2026-10-19']){const s=arrivalPolicy(stay,today,true);assert.equal(s.can_arrive,false);assert.equal(s.can_confirm,false);}});
test('day retreats can report arrival on their only day',()=>{assert.equal(arrivalPolicy({...stay,departure:stay.arrival},stay.arrival,true).can_arrive,true);});
