import {test} from 'node:test';import assert from 'node:assert/strict';
import {extractInvoice,validateLedger,validDate,filterLedger,ledgerTotals,reconciliationWarnings,type LedgerItem} from './invoice-ledger.ts';
const text=`Supplier: Green Farm
Invoice number: GF-100
Invoice date: 05/10/2026
Purchase date: 04/10/2026
Due date: 19/10/2026
Currency: GBP
Code Description Qty Unit Price Net
L100 Red lentils 2 kg 4.50 9.00
O200 Rolled oats 3 pack 2.00 6.00
Subtotal: 15.00
VAT: 0.00
Invoice total: 15.00`;
const valid={reviewed:true,documentType:'invoice',currency:'GBP',invoiceDate:'2026-10-05',invoiceNumber:'GF-100',purchaseDate:'',dueDate:'',subtotal:'15.00',vat:'0',lines:[{code:'L100',description:'Lentils',quantity:'2',unit:'kg',unitPrice:'4.50',net:'9.00'}]};
test('extracts labelled dates, product codes and positive credit magnitudes',()=>{const r=extractInvoice(text,[]);assert.equal(r.supplierName,'Green Farm');assert.equal(r.invoiceNumber,'GF-100');assert.equal(r.purchaseDate,'2026-10-04');assert.equal(r.dueDate,'2026-10-19');assert.equal(r.total,15);assert.equal(r.vat,0);assert.equal(r.currency,'GBP');assert.equal(r.lines.length,2);assert.equal(r.lines[0].code,'L100');assert.equal(r.lines[0].net,9);assert.equal(extractInvoice(text.replace('Invoice number','Credit note number'),[]).documentType,'credit');});
test('unclear layouts and currencies stay unconfirmed',()=>{const r=extractInvoice('Green Farm\nmaybe total 123\nL100 9.00',[]);assert.equal(r.currency,'');assert.equal(r.total,null);assert.equal(r.date,null);assert.equal(r.lines.length,0);assert.equal(extractInvoice(text+'\nUSD $15.00',[]).currency,'MIXED');});
test('real dates and explicit review required',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);assert.equal(validateLedger(valid).ok,true);for(const change of [{reviewed:false},{currency:'USD'},{invoiceDate:'2026-02-30'},{dueDate:'bad'},{documentType:'refund'},{subtotal:'NaN'},{lines:[{description:'a',quantity:'-1'}]}])assert.equal(validateLedger({...valid,...change}).ok,false);});
test('blank figures stay null and malformed numeric input fails',()=>{const v=validateLedger({...valid,subtotal:'',vat:'',lines:[{code:'X',quantity:'',unitPrice:'',net:''}]});assert.equal(v.ok,true);if(v.ok){assert.equal(v.value.subtotal,null);assert.equal(v.value.lines[0].net,null);}for(const bad of [true,{},'1e3','Infinity','-3'])assert.equal(validateLedger({...valid,vat:bad}).ok,false);});
const item=(patch:Partial<LedgerItem>={}):LedgerItem=>({id:'1',date:'2026-10-05',filename:'invoice.pdf',supplierName:'Green Farm',supplierCode:'LOCAL',bookingName:null,note:null,documentType:'invoice',invoiceNumber:'GF-100',purchaseDate:'2026-10-04',dueDate:'',currency:'GBP',total:15,subtotal:15,vat:0,lines:[{code:'L100',description:'Red lentils',quantity:2,unit:'kg',unitPrice:4.5,net:9}],...patch});
test('search covers product, supplier, dates and document number; filters compose',()=>{assert.equal(filterLedger([item()],{query:'green L100'}).length,1);assert.equal(filterLedger([item()],{query:'GF-100',from:'2026-10-06'}).length,0);assert.equal(filterLedger([item()],{query:'lentils',type:'credit'}).length,0);assert.equal(filterLedger([item()],{query:'2026-10-04'}).length,1);});
test('credits subtract exactly once from gross and supplier/month totals',()=>{const t=ledgerTotals([item(),item({id:'2',documentType:'credit',total:3})]);assert.equal(t.invoices,15);assert.equal(t.credits,3);assert.equal(t.net,12);assert.equal(t.suppliers[0][1],12);assert.equal(t.months[0][1],12);assert.equal(ledgerTotals([item({documentType:'credit',total:3})]).net,-3);});
test('reconciliation flags missing/mismatched lines without inventing amounts',()=>{assert.equal(reconciliationWarnings({lines:item().lines,subtotal:9,vat:0,total:9}).length,0);assert.equal(reconciliationWarnings({lines:item().lines,subtotal:20,vat:2,total:30}).length,2);assert.equal(reconciliationWarnings({lines:[],subtotal:null,vat:null,total:null}).length,1);});
