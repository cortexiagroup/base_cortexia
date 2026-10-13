import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface PdfProposal {
  proposal_number: string
  created_at: string
  expires_at: string
  offer_version: number
  offer_snapshot: Record<string, unknown>
  client_snapshot: Record<string, unknown>
  service_description: string
  base_price_xof: number
  discount_xof: number
  amount_xof: number
  payment_plan: 'full_upfront' | 'half_on_delivery'
  special_terms: string | null
  delivery_days: number | null
  status: string
}
export interface PdfSettings {
  company_name: string
  professional_email: string | null
  professional_phone: string | null
  postal_address: string | null
  legal_mentions: string | null
  logo_storage_path: string | null
}
export interface PdfPayload { proposal: PdfProposal; settings: PdfSettings }

const BLUE = rgb(0.14, 0.35, 0.88)
const NAVY = rgb(0.06, 0.14, 0.29)
const INK = rgb(0.10, 0.18, 0.30)
const MUTED = rgb(0.43, 0.50, 0.60)
const PALE = rgb(0.94, 0.97, 1)
const LINE = rgb(0.84, 0.89, 0.95)
const money = (amount: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount).replace(/[\u00a0\u202f]/g, ' ')} FCFA`
const date = (value: string) => new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeZone: 'Africa/Lome' }).format(new Date(value))
function text(value: unknown): string { return value == null ? '' : String(value).trim() }
function safe(font: PDFFont, value: string): string {
  return Array.from(value).map(char => { try { font.encodeText(char); return char } catch { return '?' } }).join('')
}
function list(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : [] }
function wrap(font: PDFFont, value: string, size: number, available: number): string[] {
  const words = safe(font, value).replace(/\s+/g, ' ').split(' ')
  let current = ''
  const lines: string[] = []
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= available) { current = candidate; continue }
    if (current) { lines.push(current); current = '' }
    if (font.widthOfTextAtSize(word, size) <= available) { current = word; continue }
    let chunk = ''
    for (const char of word) {
      if (font.widthOfTextAtSize(chunk + char, size) > available && chunk) { lines.push(chunk); chunk = '' }
      chunk += char
    }
    current = chunk
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

export async function renderProposalPdf(payload: PdfPayload, logoBytes?: Uint8Array, preview = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${preview ? 'Aperçu - ' : ''}Proposition ${payload.proposal.proposal_number}`)
  doc.setAuthor(payload.settings.company_name || 'Cortexia')
  doc.setSubject('Proposition commerciale')
  doc.setCreationDate(new Date(payload.proposal.created_at))
  doc.setModificationDate(new Date(payload.proposal.created_at))
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const width = PageSizes.A4[0]
  const height = PageSizes.A4[1]
  const margin = 47
  const contentWidth = width - 2 * margin
  let page: PDFPage = doc.addPage(PageSizes.A4)
  let y = height - 194
  let sectionNumber = 0
  const company = text(payload.settings.company_name) || 'Cortexia'

  async function newPage(first = false) {
    if (!first) page = doc.addPage(PageSizes.A4)
    page.drawRectangle({ x: 0, y: 0, width: 9, height, color: BLUE })
    y = height - 67
    if (first) {
      page.drawRectangle({ x: 9, y: height - 174, width: width - 9, height: 174, color: NAVY })
      page.drawRectangle({ x: 9, y: height - 178, width: width - 9, height: 4, color: BLUE })
      page.drawEllipse({ x: width - 29, y: height - 20, xScale: 123, yScale: 123, color: BLUE, opacity: 0.22 })
      page.drawEllipse({ x: width - 10, y: height - 9, xScale: 68, yScale: 68, color: rgb(0.43, 0.64, 1), opacity: 0.14 })
      const logoLeft = Boolean(logoBytes?.length)
      if (logoBytes?.length) {
        try {
          const image = logoBytes[0] === 0x89 ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
          const fit = image.scaleToFit(35, 35)
          page.drawRectangle({ x: margin, y: height - 83, width: 47, height: 47, color: rgb(1, 1, 1) })
          page.drawImage(image, { x: margin + (47 - fit.width) / 2, y: height - 83 + (47 - fit.height) / 2, width: fit.width, height: fit.height })
        } catch { /* Official identity remains the configured company name if the image is unusable. */ }
      }
      page.drawText(safe(bold, company).slice(0, 35), { x: margin + (logoLeft ? 59 : 0), y: height - 56, size: 17, font: bold, color: rgb(1, 1, 1) })
      const coords = [payload.settings.postal_address, payload.settings.professional_phone, payload.settings.professional_email].filter(Boolean).join('  |  ')
      if (coords) page.drawText(safe(regular, coords).slice(0, 97), { x: margin + (logoLeft ? 59 : 0), y: height - 76, size: 8, font: regular, color: rgb(0.75, 0.84, 0.96) })
      page.drawText('CORTEXIA  /  DOCUMENT COMMERCIAL', { x: margin, y: height - 109, size: 8, font: bold, color: rgb(0.60, 0.76, 1) })
      page.drawText('Proposition', { x: margin - 1, y: height - 144, size: 27, font: bold, color: rgb(1, 1, 1) })
      page.drawText(safe(bold, payload.proposal.proposal_number), { x: margin + 220, y: height - 139, size: 12, font: bold, color: rgb(1, 1, 1) })
      page.drawText(safe(regular, `Émise le ${date(payload.proposal.created_at)}  /  Valable jusqu'au ${date(payload.proposal.expires_at)}`), { x: margin, y: height - 161, size: 8.5, font: regular, color: rgb(0.82, 0.88, 0.98) })
      y = height - 202
    } else {
      page.drawRectangle({ x: 9, y: height - 61, width: width - 9, height: 61, color: NAVY })
      page.drawText(safe(bold, company).slice(0, 36), { x: margin, y: height - 39, size: 13, font: bold, color: rgb(1, 1, 1) })
      page.drawText(safe(regular, payload.proposal.proposal_number), { x: width - margin - 118, y: height - 38, size: 9, font: regular, color: rgb(0.75, 0.84, 0.96) })
      y = height - 83
    }
  }
  function ensure(space: number) { return y - space >= 68 }
  async function line(value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10
    const face = opts.font ?? regular
    for (const item of wrap(face, value, size, contentWidth - (opts.indent ?? 0))) {
      if (!ensure(size + 7)) await newPage()
      page.drawText(item, { x: margin + (opts.indent ?? 0), y, size, font: face, color: opts.color ?? INK })
      y -= size + 5
    }
    y -= opts.gap ?? 0
  }
  async function section(title: string) {
    if (!ensure(49)) await newPage()
    y -= 7
    sectionNumber += 1
    page.drawRectangle({ x: margin, y: y - 11, width: 19, height: 19, color: BLUE })
    page.drawText(String(sectionNumber).padStart(2, '0'), { x: margin + 3.5, y: y - 5, size: 7, font: bold, color: rgb(1, 1, 1) })
    const label = safe(bold, title.toUpperCase())
    page.drawText(label, { x: margin + 29, y: y - 5, size: 9.5, font: bold, color: NAVY })
    const labelEnd = margin + 29 + bold.widthOfTextAtSize(label, 9.5) + 12
    if (labelEnd < width - margin) page.drawLine({ start: { x: labelEnd, y: y - 3 }, end: { x: width - margin, y: y - 3 }, thickness: 0.7, color: LINE })
    y -= 27
  }
  async function bullets(items: string[]) {
    if (!items.length) { await line('Non précisé dans cette version de l’offre.', { color: MUTED, size: 9 }); return }
    for (const item of items) { await line(`•  ${item}`, { indent: 8, size: 9.5, gap: 1 }) }
  }

  await newPage(true)
  const client = payload.proposal.client_snapshot
  const clientName = wrap(bold, text(client.company_name) || 'Entreprise non renseignée', 12, contentWidth - 32)
  const contact = [text(client.contact_name), text(client.contact_title)].filter(Boolean).join(' - ')
  const contactLines = contact ? wrap(regular, contact, 8.5, contentWidth - 32) : []
  const coords = [text(client.address), text(client.city), text(client.contact_email || client.email), text(client.contact_phone || client.phone)].filter(Boolean).join('  |  ')
  const coordLines = coords ? wrap(regular, coords, 7.5, contentWidth - 32) : []
  const cardHeight = Math.max(75, 38 + clientName.length * 15 + contactLines.length * 12 + coordLines.length * 11)
  if (!ensure(cardHeight + 20)) await newPage()
  page.drawRectangle({ x: margin, y: y - cardHeight, width: contentWidth, height: cardHeight, color: PALE })
  page.drawRectangle({ x: margin, y: y - cardHeight, width: 3, height: cardHeight, color: BLUE })
  page.drawText('PRÉPARÉ POUR', { x: margin + 16, y: y - 19, size: 8, font: bold, color: BLUE })
  let cardY = y - 39
  for (const value of clientName) { page.drawText(value, { x: margin + 16, y: cardY, size: 12, font: bold, color: NAVY }); cardY -= 15 }
  for (const value of contactLines) { page.drawText(value, { x: margin + 16, y: cardY, size: 8.5, font: regular, color: INK }); cardY -= 12 }
  for (const value of coordLines) { page.drawText(value, { x: margin + 16, y: cardY, size: 7.5, font: regular, color: MUTED }); cardY -= 11 }
  y -= cardHeight + 9

  const offer = payload.proposal.offer_snapshot
  await section('Prestation proposée')
  await line(`${text(offer.name)}  -  version ${payload.proposal.offer_version}`, { font: bold, size: 12, gap: 4 })
  await line(payload.proposal.service_description, { gap: 5 })
  if (text(offer.description)) await line(text(offer.description), { color: MUTED })
  await section('Bénéfices')
  await bullets(list(offer.benefits))
  await section('Prestations incluses')
  await bullets(list(offer.included_services))
  await section('Exclusions')
  await bullets(list(offer.exclusions))
  await section('Délai et conditions')
  if (payload.proposal.delivery_days != null) await line(`Délai indicatif : ${payload.proposal.delivery_days} jour(s).`)
  if (text(offer.payment_terms)) await line(`Conditions de l'offre : ${text(offer.payment_terms)}`)
  await line(payload.proposal.payment_plan === 'full_upfront'
    ? 'Échéancier : 100 % exigibles à la commande, avant le démarrage.'
    : 'Échéancier : 50 % à la commande, 50 % à l’étape contractuelle de livraison.', { gap: 4 })
  if (payload.proposal.special_terms) await line(`Conditions particulières approuvées : ${payload.proposal.special_terms}`)

  await section('Tarification')
  if (!ensure(125)) await newPage()
  page.drawRectangle({ x: margin, y: y - 104, width: contentWidth, height: 104, color: PALE })
  const priceRows: [string, string, number][] = [
    ['Prix de la prestation', money(payload.proposal.base_price_xof), y - 19],
    ['Remise approuvée', `- ${money(payload.proposal.discount_xof)}`, y - 43],
  ]
  for (const [label, amount, rowY] of priceRows) {
    page.drawText(safe(regular, label), { x: margin + 16, y: rowY, size: 9.5, font: regular, color: INK })
    const printed = safe(bold, amount)
    page.drawText(printed, { x: margin + contentWidth - 16 - bold.widthOfTextAtSize(printed, 9.5), y: rowY, size: 9.5, font: bold, color: INK })
  }
  page.drawRectangle({ x: margin, y: y - 104, width: contentWidth, height: 39, color: NAVY })
  page.drawRectangle({ x: margin, y: y - 104, width: 5, height: 39, color: BLUE })
  page.drawText('MONTANT DE LA PROPOSITION', { x: margin + 16, y: y - 90, size: 9.2, font: bold, color: rgb(1, 1, 1) })
  const finalAmount = safe(bold, money(payload.proposal.amount_xof))
  page.drawText(finalAmount, { x: margin + contentWidth - 16 - bold.widthOfTextAtSize(finalAmount, 13), y: y - 91, size: 13, font: bold, color: rgb(1, 1, 1) })
  y -= 116
  if (preview) await line('APERÇU NON ÉMIS - ce document n’atteste ni envoi ni acceptation.', { size: 8, font: bold, color: BLUE })
  else await line('Proposition émise. Acceptation et paiement suivis séparément.', { size: 8, color: MUTED })

  const pages = doc.getPages()
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 50 }, end: { x: width - margin, y: 50 }, thickness: 0.8, color: LINE })
    const footer = [company, payload.settings.legal_mentions].filter(Boolean).join('  |  ')
    item.drawText(safe(regular, footer).slice(0, 112), { x: margin, y: 32, size: 7, font: regular, color: MUTED })
    const number = `${index + 1} / ${pages.length}`
    item.drawText(number, { x: width - margin - regular.widthOfTextAtSize(number, 8), y: 32, size: 8, font: regular, color: MUTED })
  })
  return doc.save()
}
