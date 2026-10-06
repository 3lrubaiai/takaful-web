import fs from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

async function buildReport(report) {
  const id = report.id;
  const [categories, highlights, initiativeImages, sections] = await Promise.all([
    get(`categories?select=id,title,amount,count_text,detail_text,detail_image_url,detail_image_path,sort_order&report_id=eq.${encodeURIComponent(id)}&order=sort_order.asc`),
    get(`highlight_stories?select=id,title,text&report_id=eq.${encodeURIComponent(id)}&limit=1`),
    get(`initiative_images?select=id,image_url,image_path,sort_order&report_id=eq.${encodeURIComponent(id)}&order=sort_order.asc`),
    get(`partner_sections?select=id,subtitle,sort_order&report_id=eq.${encodeURIComponent(id)}&order=sort_order.asc`)
  ]);

  const highlight = highlights[0] || null;
  const highlightImages = highlight
    ? await get(`highlight_images?select=id,image_url,image_path,sort_order&highlight_id=eq.${encodeURIComponent(highlight.id)}&order=sort_order.asc`)
    : [];

  const sectionIds = sections.map(s => String(s.id));
  let logos = [];
  if (sectionIds.length) {
    logos = await get(`partner_logos?select=id,partner_section_id,image_url,image_path,sort_order&partner_section_id=in.(${sectionIds.map(encodeURIComponent).join(',')})&order=sort_order.asc`);
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    report: {
      id: report.id,
      slug: report.slug || `${report.year}-${String(report.month_number).padStart(2, '0')}`,
      status: report.status || 'published',
      monthName: report.month_name || '',
      monthNumber: Number(report.month_number) || 0,
      year: String(report.year || ''),
      totalWords: report.total_words || '',
      initiativesNote: report.initiatives_note || '',
      lastUpdated: report.last_updated || report.updated_at || null
    },
    highlight: {
      id: highlight?.id || null,
      title: highlight?.title || '',
      text: highlight?.text || '',
      images: highlightImages.map(x => ({ id: x.id, url: x.image_url, path: x.image_path }))
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
    initiativeImages: initiativeImages.map(x => ({ id: x.id, url: x.image_url, path: x.image_path })),
    partnerSections: sections.map(s => ({
      id: String(s.id),
      subtitle: s.subtitle || '',
      logos: logos.filter(l => String(l.partner_section_id) === String(s.id))
        .map(l => ({ id: l.id, url: l.image_url, path: l.image_path }))
    }))
  };
}

const reports = await get('reports?select=id,slug,month_name,month_number,year,status,total_words,initiatives_note,last_updated,updated_at&status=eq.published&order=year.desc&order=month_number.desc');
if (!reports.length) throw new Error('No published reports found');

await fs.mkdir('data/reports', { recursive: true });
const index = [];
const payloads = [];

for (const report of reports) {
  const payload = await buildReport(report);
  const slug = payload.report.slug;
  await fs.writeFile(`data/reports/${slug}.json`, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  payloads.push(payload);
  index.push({
    id: payload.report.id,
    slug,
    monthName: payload.report.monthName,
    monthNumber: payload.report.monthNumber,
    year: payload.report.year,
    status: payload.report.status,
    lastUpdated: payload.report.lastUpdated
  });
}

await fs.writeFile('data/reports/index.json', JSON.stringify({version: 1, generatedAt: new Date().toISOString(), reports: index}, null, 2) + '\n', 'utf8');
await fs.writeFile('data/report.json', JSON.stringify(payloads[0], null, 2) + '\n', 'utf8');

console.log(`Synced ${payloads.length} published reports. Latest: ${payloads[0].report.monthName} ${payloads[0].report.year}`);
