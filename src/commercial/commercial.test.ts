import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderProposalPdf, type PdfPayload } from '../../supabase/functions/_shared/proposal-pdf'

const fixture: PdfPayload = {
  settings: { company_name: 'Cortexia', professional_email: null,
    professional_phone: null, postal_address: null, legal_mentions: null, logo_storage_path: null },
  proposal: { proposal_number: 'MAQUETTE-NON-EMISE', created_at: '2026-10-12T12:00:00Z',
    expires_at: '2026-11-12T12:00:00Z', offer_version: 1,
    offer_snapshot: { name: 'Site web personnalisé', description: 'Prestation de contrôle.',
      benefits: ['Clarté de la présence numérique'], included_services: ['Conception et mise en page'],
      exclusions: ['Hébergement non inclus'], payment_terms: 'À définir avec le client.' },
    client_snapshot: { company_name: 'Entreprise de démonstration', contact_name: 'Contact fictif' },
    service_description: 'Création d’un site adapté aux besoins de cette entreprise de démonstration.',
    base_price_xof: 49000, discount_xof: 0, amount_xof: 49000,
    payment_plan: 'half_on_delivery', special_terms: null, delivery_days: 20, status: 'draft' },
}

describe('PDF commercial A4', () => {
  it('génère un document A4 lisible par un lecteur PDF', async () => {
    const bytes = await renderProposalPdf(fixture, undefined, true)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
    expect(Math.round(doc.getPage(0).getHeight())).toBe(842)
    if (process.env.CORTEXIA_PDF_QA === '1') {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir('output/pdf', { recursive: true })
      await writeFile('output/pdf/cortexia-proposition-controle.pdf', bytes)
    }
  })
  it('pagine les listes longues sans perdre les sections', async () => {
    const long = structuredClone(fixture)
    long.proposal.offer_snapshot.included_services = Array.from({ length: 55 }, (_, index) => `Prestation de contrôle ${index + 1} : une description détaillée pour vérifier les sauts de page et les accents.`)
    const bytes = await renderProposalPdf(long, undefined, true)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    if (process.env.CORTEXIA_PDF_QA === '1') {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir('tmp/pdfs', { recursive: true })
      await writeFile('tmp/pdfs/cortexia-pagination-controle.pdf', bytes)
    }
  })
  it('reproduit les mêmes octets pour la même proposition', async () => {
    const first = await renderProposalPdf(fixture)
    const second = await renderProposalPdf(fixture)
    expect(first).toEqual(second)
  })
})
