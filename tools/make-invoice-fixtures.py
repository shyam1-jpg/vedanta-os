"""Synthetic OCR QA only. No customer invoices or credentials."""
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from PIL import Image, ImageDraw, ImageFont
out=Path(__file__).resolve().parent.parent/'tmp'/'invoice-qa'
out.mkdir(parents=True,exist_ok=True)
rows=['SYNTHETIC TEST INVOICE - NOT A REAL PURCHASE','Supplier: Green Farm','Invoice number: GF-100','Invoice date: 05/10/2026','Purchase date: 04/10/2026','Due date: 19/10/2026','Currency: GBP','','Code  Description       Qty Unit Price   Net','L100  Red lentils         2  kg    4.50  9.00','O200  Rolled oats         3  pack  2.00  6.00','','Subtotal: 15.00','VAT: 0.00','Invoice total: 15.00']
font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',28)
im=Image.new('RGB',(1400,1100),'white');draw=ImageDraw.Draw(im)
for i,line in enumerate(rows):draw.text((50,50+i*58),line,font=font,fill='black')
im.save(out/'synthetic-invoice.png')
pdf=Canvas(str(out/'synthetic-text-invoice.pdf'),pagesize=(700,550));pdf.setFont('Courier',14)
for i,line in enumerate(rows):pdf.drawString(25,520-i*29,line)
pdf.save()
pdf=Canvas(str(out/'synthetic-scanned-invoice.pdf'),pagesize=(700,550));pdf.drawInlineImage(im,0,0,700,550);pdf.save()
credit=rows.copy();credit[0]='SYNTHETIC CREDIT NOTE - NOT A REAL CREDIT';credit[2]='Credit note number: CN-100';credit[8]='Code Description Qty Unit Price Net';credit[9]='L100 Red lentils 1 kg 4.50 4.50';credit[10]='';credit[12]='Subtotal: 4.50';credit[14]='Invoice total: 4.50'
pdf=Canvas(str(out/'synthetic-credit.pdf'),pagesize=(700,550));pdf.setFont('Courier',14)
for i,line in enumerate(credit):pdf.drawString(25,520-i*29,line)
pdf.save()
print(out)
