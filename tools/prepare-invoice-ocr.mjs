// Self-host OCR assets: uploaded documents never go to an OCR vendor.
import {mkdir,copyFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dest=resolve(root,'apps/web-admin/public/invoice-ocr');
await mkdir(resolve(dest,'core'),{recursive:true});
await copyFile(resolve(root,'node_modules/tesseract.js/dist/worker.min.js'),resolve(dest,'worker.min.js'));
for(const name of await readdir(resolve(root,'node_modules/tesseract.js-core'))){
 if(name.endsWith('.wasm')||name.endsWith('.wasm.js'))await copyFile(resolve(root,'node_modules/tesseract.js-core',name),resolve(dest,'core',name));
}
await copyFile(resolve(root,'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),resolve(dest,'eng.traineddata.gz'));
await copyFile(resolve(root,'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),resolve(dest,'pdf.worker.min.mjs'));
for(const folder of ['cmaps','standard_fonts','wasm']){
 await mkdir(resolve(dest,folder),{recursive:true});
 for(const name of await readdir(resolve(root,'node_modules/pdfjs-dist',folder)))await copyFile(resolve(root,'node_modules/pdfjs-dist',folder,name),resolve(dest,folder,name));
}
console.log('Prepared local invoice OCR assets.');
