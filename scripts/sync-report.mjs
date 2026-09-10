import fs from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const reportId = 'takaful-suhar-report';

if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(path){
  const r = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await r.text();
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0,500)}`);
  return JSON.parse(text);
}

const reportRows = await get(`reports?select=id,month_name,year,total_words,initiatives_note,last_updated&id=eq.${encodeURIComponent(reportId)}&limit=1`);
const report = reportRows[0];
if(!report) throw new Error(`Report ${reportId} not found`);

const [categories, highlights, initiativeImages, sections] = await Promise.all([
  get(`categories?select=id,title,amount,count_text,detail_text,detail_image_url,detail_image_path,sort_order&report_id=eq.${encodeURIComponent(reportId)}&order=sort_order.asc`),
  get(`highlight_stories?select=id,title,text&report_id=eq.${encodeURIComponent(reportId)}&limit=1`),
  get(`initiative_images?select=id,image_url,image_path,sort_order&report_id=eq.${encodeURIComponent(reportId)}&order=sort_order.asc`),
  get(`partner_sections?select=id,subtitle,sort_order&report_id=eq.${encodeURIComponent(reportId)}&order=sort_order.asc`)
]);

const highlight = highlights[0] || null;
const highlightImages = highlight
  ? await get(`highlight_images?select=id,image_url,image_path,sort_order&highlight_id=eq.${encodeURIComponent(highlight.id)}&order=sort_order.asc`)
  : [];

const sectionIds = sections.map(s => s.id);
let logos = [];
if(sectionIds.length){
  const inList = sectionIds.join(',');
  logos = await get(`partner_logos?select=id,partner_section_id,image_url,image_path,sort_order&partner_section_id=in.(${encodeURIComponent(inList)})&order=sort_order.asc`);
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  report: {
    monthName: report.month_name || '',
    year: String(report.year || ''),
    totalWords: report.total_words || '',
    initiativesNote: report.initiatives_note || '',
    lastUpdated: report.last_updated || null
  },
  highlight: {
    id: highlight?.id || null,
    title: highlight?.title || '',
    text: highlight?.text || '',
    images: highlightImages.map(x => ({id:x.id,url:x.image_url,path:x.image_path}))
  },
  categories: categories.map(c => ({
    id: String(c.id),
    title: c.title || '',
    amount: Number(c.amount) || 0,
    countText: c.count_text || '',
    detailText: c.detail_text || '',
    detailImage: c.detail_image_url || '',
    detailImagePath: c.detail_image_path || '',
    sortOrder: Number(c.sort_order) || 0
  })),
  initiativeImages: initiativeImages.map(x => ({id:x.id,url:x.image_url,path:x.image_path})),
  partnerSections: sections.map(s => ({
    id: String(s.id),
    subtitle: s.subtitle || '',
    logos: logos
      .filter(l => String(l.partner_section_id) === String(s.id))
      .map(l => ({id:l.id,url:l.image_url,path:l.image_path}))
  }))
};

await fs.mkdir('data', {recursive:true});
await fs.writeFile('data/report.json', JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`Wrote data/report.json: ${payload.categories.length} categories, ${payload.highlight.images.length} highlight images, ${payload.initiativeImages.length} initiative images, ${payload.partnerSections.length} partner sections.`);
