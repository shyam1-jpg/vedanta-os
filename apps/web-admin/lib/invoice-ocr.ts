"use client";
import type {Worker} from "tesseract.js";
/** English OCR; bounded work, cancellable, entirely inside this browser. */
export async function scanInvoice(file: File, progress: (message:string)=>void, signal:AbortSignal): Promise<string> {
  if(file.size>4_000_000)throw new Error("Choose a file smaller than 4 MB.");
  if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))throw new Error("Use a PDF, JPEG, PNG or WebP file.");
  let worker:Worker|undefined; let pdf:{destroy:()=>Promise<void>}|undefined;
  const stopped=()=>{if(signal.aborted)throw new Error("Scan cancelled. You can still enter the details manually.");};
  let rejectStop:(error:Error)=>void=()=>{};
  const stopPromise=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const abort=()=>{void worker?.terminate();void pdf?.destroy();rejectStop(new Error("Scan cancelled. You can still enter the details manually."));};
  signal.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>{void worker?.terminate();void pdf?.destroy();rejectStop(new Error("Scan timed out. Try a clearer or shorter document, or enter details manually."));},180_000);
  let ended=false;
  const recognise=async(canvas:HTMLCanvasElement)=>{
    stopped();
    if(!worker){
      progress("Loading the private document scanner…");
      const {createWorker}=await import('tesseract.js');
      const created=await createWorker('eng',1,{workerPath:'/invoice-ocr/worker.min.js',corePath:'/invoice-ocr/core',langPath:'/invoice-ocr',workerBlobURL:false,logger:m=>{if(m.status==='recognizing text'&&!ended)progress(`Reading text · ${Math.round(m.progress*100)}%`);}});
      if(ended||signal.aborted){await created.terminate();stopped();throw new Error("Scan timed out.");}
      worker=created;await worker.setParameters({preserve_interword_spaces:'1'});
    }
    return (await worker.recognize(canvas,{}, {text:true})).data.text;
  };
  const work=async()=>{
    stopped();
    if(file.type==='application/pdf'){
      progress("Reading PDF pages…");
      const lib=await import('pdfjs-dist');lib.GlobalWorkerOptions.workerSrc='/invoice-ocr/pdf.worker.min.mjs';
      const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/invoice-ocr/cmaps/',cMapPacked:true,standardFontDataUrl:'/invoice-ocr/standard_fonts/',wasmUrl:'/invoice-ocr/wasm/',maxImageSize:12_000_000});
      pdf=task;
      const doc=await task.promise;stopped();
      if(doc.numPages>10)throw new Error("Use a PDF with up to 10 pages, or split it before uploading.");
      const pages:string[]=[];
      for(let i=1;i<=doc.numPages;i++){
        stopped();if(ended)throw new Error("Scan ended.");progress(`Reading PDF page ${i} of ${doc.numPages}…`);
        const page=await doc.getPage(i);const content=await page.getTextContent();
        // Preserve visual rows and column spacing for invoice line extraction.
        const rows=new Map<number,{x:number;text:string}[]>();
        for(const item of content.items){if(!('str' in item))continue;const y=Math.round(item.transform[5]/3)*3;const row=rows.get(y)??[];row.push({x:item.transform[4],text:item.str});rows.set(y,row);}
        const text=[...rows].sort((a,b)=>b[0]-a[0]).map(([,r])=>r.sort((a,b)=>a.x-b.x).map(t=>t.text).join('  ')).join('\n');
        if(text.replace(/\s/g,'').length>=40){pages.push(text);}
        else {const base=page.getViewport({scale:1});const scale=Math.min(2,2600/Math.max(base.width,base.height));const view=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);try{await page.render({canvas,viewport:view}).promise;pages.push(await recognise(canvas));}finally{canvas.width=canvas.height=0;}}
        page.cleanup();
      }
      return pages.join('\n').slice(0,120_000);
    }
    const bitmap=await createImageBitmap(file);stopped();
    const scale=Math.min(1,2600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    try{const ctx=canvas.getContext('2d');if(!ctx)throw new Error("This browser cannot scan images.");ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return (await recognise(canvas)).slice(0,120_000);}
    finally{bitmap.close();canvas.width=canvas.height=0;}
  };
  try{return await Promise.race([work(),stopPromise]);}
  finally{ended=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);await worker?.terminate();await pdf?.destroy();}
}
