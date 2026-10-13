import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type FinanceKind = 'receipt' | 'instructions'
export interface FinancePdfPayload {
  kind: FinanceKind
  document_number: string
  created_at: string
  snapshot: Record<string, unknown>
}
type Data = Record<string, unknown>
const BLUE = rgb(0.14, 0.35, 0.88)
const NAVY = rgb(0.06, 0.14, 0.29)
const INK = rgb(0.10, 0.18, 0.30)
const MUTED = rgb(0.42, 0.50, 0.60)
const PALE = rgb(0.94, 0.97, 1)
const WHITE = rgb(1, 1, 1)
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const value = (input: unknown): string => input == null ? '' : String(input).trim()
const amount = (input: unknown): string => `${new Intl.NumberFormat('fr-FR').format(Number(input) || 0).replace(/[\u00a0\u202f]/g, ' ')} FCFA`
const date = (input: unknown): string => input ? new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lome' }).format(new Date(String(input))) : 'Non renseignée'
const method = (input: unknown): string => ({ merchant_account: 'Mobile Money', bank_transfer: 'Virement bancaire', cash: 'Espèces' } as Record<string, string>)[String(input)] ?? value(input)
function safe(font: PDFFont, input: string): string {
  return Array.from(input).map(char => { try { font.encodeText(char); return char } catch { return '?' } }).join('')
}
function wrap(font: PDFFont, input: string, size: number, width: number): string[] {
  const words = safe(font, input).replace(/\s+/g, ' ').split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue }
    if (line) lines.push(line)
    line = word
    while (font.widthOfTextAtSize(line, size) > width) {
      let cut = line.length - 1
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--
      lines.push(line.slice(0, cut)); line = line.slice(cut)
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export async function renderFinancePdf(payload: FinancePdfPayload, logoBytes?: Uint8Array): Promise<Uint8Array> {
  if (payload.kind === 'receipt' && object(payload.snapshot.payment).status !== 'confirmed')
    throw new Error('Un reçu exige un encaissement confirmé.')
  const doc = await PDFDocument.create()
  doc.setTitle(`${payload.kind === 'receipt' ? 'Reçu de paiement' : 'Instructions de paiement'} ${payload.document_number}`)
  doc.setAuthor(value(object(payload.snapshot.company).company_name) || 'Cortexia')
  doc.setCreationDate(new Date(payload.created_at))
  doc.setModificationDate(new Date(payload.created_at))
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const [width, height] = PageSizes.A4
  const margin = 48
  const content = width - 2 * margin
  const company = object(payload.snapshot.company)
  const order = object(payload.snapshot.order)
  const offer = object(order.offer_snapshot)
  const customer = object(offer.client)
  const payment = object(payload.snapshot.payment)
  const account = object(payload.snapshot.account)
  const companyName = value(company.company_name) || 'Cortexia'
  let page: PDFPage = doc.addPage(PageSizes.A4)
  let y = height - 195

  async function addPage(first = false) {
    if (!first) page = doc.addPage(PageSizes.A4)
    page.drawRectangle({ x: 0, y: 0, width: 9, height, color: BLUE })
    if (first) {
      page.drawRectangle({ x: 9, y: height - 174, width: width - 9, height: 174, color: NAVY })
      page.drawRectangle({ x: 9, y: height - 178, width: width - 9, height: 4, color: BLUE })
      page.drawEllipse({ x: width - 21, y: height - 12, xScale: 119, yScale: 119, color: BLUE, opacity: 0.2 })
      let nameX = margin
      if (logoBytes?.length) {
        try {
          const logo = logoBytes[0] === 0x89 ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
          const fit = logo.scaleToFit(35, 35)
          page.drawRectangle({ x: margin, y: height - 82, width: 46, height: 46, color: WHITE })
          page.drawImage(logo, { x: margin + (46 - fit.width) / 2, y: height - 82 + (46 - fit.height) / 2, width: fit.width, height: fit.height })
          nameX += 58
        } catch { /* Brand text remains authoritative. */ }
      }
      page.drawText(safe(bold, companyName).slice(0, 37), { x: nameX, y: height - 55, size: 18, font: bold, color: WHITE })
      const contact = [value(company.postal_address), value(company.professional_phone), value(company.professional_email)].filter(Boolean).join('  |  ')
      if (contact) page.drawText(safe(regular, contact).slice(0, 95), { x: nameX, y: height - 75, size: 8, font: regular, color: rgb(0.77, 0.85, 0.97) })
      page.drawText('CORTEXIA  /  DOCUMENT FINANCIER', { x: margin, y: height - 108, size: 8, font: bold, color: rgb(0.60, 0.76, 1) })
      page.drawText(payload.kind === 'receipt' ? 'Reçu de paiement' : 'Instructions de paiement', {
        x: margin - 1, y: height - 143, size: payload.kind === 'receipt' ? 24 : 21,
        font: bold, color: WHITE,
      })
      page.drawText(safe(regular, `${payload.document_number}  /  ${date(payload.created_at)}`), { x: margin, y: height - 163, size: 9, font: regular, color: rgb(0.82, 0.89, 0.99) })
      y = height - 199
    } else {
      page.drawRectangle({ x: 9, y: height - 61, width: width - 9, height: 61, color: NAVY })
      page.drawText(safe(bold, companyName).slice(0, 40), { x: margin, y: height - 39, size: 13, font: bold, color: WHITE })
      y = height - 86
    }
  }
  async function ensure(space: number) { if (y - space < 72) await addPage() }
  async function line(input: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const font = options.font ?? regular
    const size = options.size ?? 10
    for (const text of wrap(font, input, size, content - (options.indent ?? 0))) {
      await ensure(size + 8)
      page.drawText(text, { x: margin + (options.indent ?? 0), y, size, font, color: options.color ?? INK })
      y -= size + 5
    }
    y -= options.gap ?? 0
  }
  async function section(title: string) {
    await ensure(48)
    y -= 7
    page.drawRectangle({ x: margin, y: y - 10, width: 18, height: 18, color: BLUE })
    page.drawText('•', { x: margin + 6, y: y - 5, size: 8, font: bold, color: WHITE })
    page.drawText(safe(bold, title.toUpperCase()), { x: margin + 29, y: y - 5, size: 9.5, font: bold, color: NAVY })
    y -= 27
  }
  async function fact(label: string, contentValue: string) {
    await line(label.toUpperCase(), { size: 7.5, font: bold, color: MUTED, gap: 1 })
    await line(contentValue || 'Non renseigné', { size: 10, gap: 7 })
  }
  await addPage(true)
  page.drawRectangle({ x: margin, y: y - 72, width: content, height: 72, color: PALE })
  page.drawRectangle({ x: margin, y: y - 72, width: 4, height: 72, color: BLUE })
  page.drawText('COMMANDE', { x: margin + 16, y: y - 19, size: 8, font: bold, color: BLUE })
  page.drawText(safe(bold, value(order.order_number)).slice(0, 40), { x: margin + 16, y: y - 39, size: 13, font: bold, color: NAVY })
  page.drawText(safe(regular, value(customer.company_name) || 'Client'), { x: margin + 16, y: y - 57, size: 9, font: regular, color: INK })
  y -= 81
  if (payload.kind === 'receipt') {
    await section('Encaissement vérifié')
    await fact('Montant reçu', amount(payment.amount_xof))
    await fact('Moyen / compte', `${method(payment.method)}${value(account.provider_name) ? ` - ${value(account.provider_name)}` : ''}`)
    await fact('Réception déclarée', date(payment.paid_at))
    await fact('Référence vérifiée', value(payment.verification_reference))
    await section('Situation à la date du reçu')
    await line(`Prestation : ${value(offer.name) || value(offer.service_description)}`, { gap: 5 })
    await line(`Montant contractuel : ${amount(order.amount_xof)}`)
    await line(`Total encaissé après ce paiement : ${amount(payload.snapshot.collected_after_xof)}`)
    await ensure(86)
    page.drawRectangle({ x: margin, y: y - 60, width: content, height: 60, color: NAVY })
    page.drawText('SOLDE RESTANT', { x: margin + 16, y: y - 37, size: 11, font: bold, color: WHITE })
    const balance = safe(bold, amount(payload.snapshot.balance_after_xof))
    page.drawText(balance, { x: margin + content - 16 - bold.widthOfTextAtSize(balance, 14), y: y - 38, size: 14, font: bold, color: WHITE })
    y -= 78
    await line('Document généré électroniquement après vérification manuelle de l’encaissement. Ce reçu n’est pas une facture fiscale.', { size: 8, color: MUTED })
  } else {
    await section('Échéance à régler')
    await line(`Montant contractuel : ${amount(order.amount_xof)}`, { gap: 4 })
    await ensure(81)
    page.drawRectangle({ x: margin, y: y - 62, width: content, height: 62, color: NAVY })
    page.drawText('MONTANT À PAYER', { x: margin + 16, y: y - 39, size: 11, font: bold, color: WHITE })
    const due = safe(bold, amount(payload.snapshot.amount_due_xof))
    page.drawText(due, { x: margin + content - 16 - bold.widthOfTextAtSize(due, 14), y: y - 39, size: 14, font: bold, color: WHITE })
    y -= 75
    await section('Comptes officiels disponibles')
    const accounts = Array.isArray(payload.snapshot.accounts) ? payload.snapshot.accounts.map(object) : []
    for (const item of accounts) {
      await ensure(70)
      await line(`${method(item.method)}${value(item.provider_name) ? ` / ${value(item.provider_name)}` : ''}`, { font: bold, size: 10, color: NAVY, gap: 2 })
      if (item.holder_name) await line(`Titulaire : ${value(item.holder_name)}`, { size: 9 })
      if (item.account_identifier) await line(`Identifiant : ${value(item.account_identifier)}`, { size: 9 })
      await line(value(item.client_instructions), { size: 9, color: MUTED, gap: 8 })
    }
    await section('Après votre paiement')
    await line('Transmettez votre référence de transaction à Cortexia. Cette fiche fournit des instructions ; elle ne confirme aucun encaissement et ne constitue pas un reçu.', { size: 9, gap: 5 })
    if (company.professional_email) await line(`Contact : ${value(company.professional_email)}`, { size: 9 })
  }
  const pages = doc.getPages()
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 51 }, end: { x: width - margin, y: 51 }, thickness: 0.8, color: PALE })
    const footer = [companyName, value(company.professional_phone), value(company.professional_email), value(company.legal_mentions)].filter(Boolean).join('  |  ')
    item.drawText(safe(regular, footer).slice(0, 112), { x: margin, y: 32, size: 7, font: regular, color: MUTED })
    const pagesText = `${index + 1} / ${pages.length}`
    item.drawText(pagesText, { x: width - margin - regular.widthOfTextAtSize(pagesText, 8), y: 32, size: 8, font: regular, color: MUTED })
  })
  return doc.save()
}
